import type { NextFunction, Request, Response } from 'express';
import { randomBytes } from 'crypto';

/**
 * 生产级 SPA 模板占位符替换（本地裸连 node 部署时必需）。
 *
 * 背景：lark-apaas 的 `index.html` 模板含构建期 mustache 占位符
 *   {{appId}} / {{basename}} / {{csrfToken}} / {{{__platform__}}}
 * 这些占位符本应由平台网关（或 vefaas）在响应时替换。本地直接 `node dist/server/main.js`
 * 裸连时无人替换，且 `npm run build:client` 会重新产出带占位符的模板覆盖掉手工本地化结果，
 * 导致：
 *   - `window.appId` / `window.__BASENAME__` 变空/错 → 前端 API base 错乱、Slardar 上报 appId 为空；
 *   - `window.csrfToken` 变空（POS 在本地缺 app 上下文时尤为明显），而下发的
 *     `Set-Cookie: suda-csrf-token` 却是非空令牌 → 「头/cookie 双提交」不一致被平台
 *     CsrfMiddleware 拒（403），本地无法登录。
 *
 * 本中间件在 HTML 真正下发前统一替换这些占位符，使本地部署在「不依赖平台网关、不被
 * build:client 覆盖」的前提下也能正常渲染并登录。
 *
 * 实现要点：
 * - 包裹 `res.end`（而非 `res.send`）。平台 `configureApp` 最终通过 `res.end` 下发 SPA，
 *   仅包裹 `res.send` 会被其绕过；包裹 `res.end` 可拦截任意发送路径，且须早于 `configureApp`
 *   注册使其成为最内层，保证本中间件在 `configureApp` 注入之后「最后」改写 body，从而生效。
 * - 改写后字节数变化，刷新 `Content-Length` 防止客户端按旧长度截断。
 * - 仅对 text/html 响应生效；平台网关下由平台保证一致，本中间件无副作用。
 */
export interface SpaTemplateOptions {
  /** window.appId / __platform__.appId */
  appId: string;
  /** __platform__.appName（标题类展示，不影响鉴权） */
  appName: string;
  /** 前端 API base，通常 '/client/' */
  basename: string;
  /**
   * 浏览器页签标题。平台默认把入口渲染成「妙搭应用」，本地/私有化部署需覆盖为自有品牌名。
   * 不传则不改写 title。
   */
  title?: string;
  /**
   * 是否移除平台水印 —— 右下角「妙搭生成」悬浮徽标（`data-custom-element="*-watermark"`）。
   * 默认 true（自有品牌部署不应出现平台徽标）。
   */
  removeWatermark?: boolean;
}

const SUD_CSRF_COOKIE = 'suda-csrf-token';

export function spaTemplateMiddleware(opts: SpaTemplateOptions) {
  return function (_req: Request, res: Response, next: NextFunction) {
    const originalEnd = res.end.bind(res);
    (res as unknown as { end: (chunk?: unknown, ...args: unknown[]) => unknown }).end = function (
      chunk?: unknown,
      ...args: unknown[]
    ) {
      const ct = res.getHeader('Content-Type');
      const isHtml =
        (typeof chunk === 'string' || Buffer.isBuffer(chunk)) &&
        typeof ct === 'string' &&
        ct.toLowerCase().includes('text/html');
      if (isHtml) {
        // SPA 入口(index.html)引用带内容 hash 的 assets；浏览器一旦缓存旧版入口，
        // 旧 hash 资源被重建清除后会落到 catch-all 被兜底成 text/html → module 解析失败 → 白屏。
        // 入口的 Cache-Control: no-cache 已在 main.ts 请求初期统一设置（早于任何响应写出），
        // 此处仅做占位符替换。
        const html = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : (chunk as string);
        const out = transformHtml(html, res, opts, _req);
        chunk = out;
        // 重写后字节数变化，刷新 Content-Length 防止客户端按旧长度截断
        res.set('Content-Length', String(Buffer.byteLength(out, 'utf8')));
      }
      return originalEnd(chunk, ...args);
    } as Response['end'];
    next();
  };
}

function transformHtml(html: string, res: Response, opts: SpaTemplateOptions, req: Request): string {
  // 1) 解析/生成 csrf token，保证与前端「头/cookie 双提交」一致
  const token = resolveCsrfToken(req, res);

  // 2) 平台上下文 JSON（覆盖 __platform__ 中的 appId/appName/basename/csrfToken）
  const platform = {
    csrfToken: token,
    userId: '',
    appId: opts.appId,
    appName: opts.appName,
    tenantId: '',
    environment: 'local',
    basename: opts.basename,
  };
  const platformJson = JSON.stringify(platform);

  let out = html;
  // 3) 替换仍残留的 mustache 占位符（build:client 后未替换形态）
  out = out.replace(/\{\{\{__platform__\}\}\}/g, platformJson);
  out = out.replace(/\{\{appId\}\}/g, opts.appId);
  out = out.replace(/\{\{basename\}\}/g, opts.basename);
  out = out.replace(/\{\{csrfToken\}\}/g, token);

  // 4) 兜底替换已被 HBS 渲染成空/本地的 window.* 全局变量
  out = out.replace(/window\.appId\s*=\s*"[^"]*"/, `window.appId = "${opts.appId}"`);
  out = out.replace(/window\.__BASENAME__\s*=\s*"[^"]*"/, `window.__BASENAME__ = "${opts.basename}"`);
  out = out.replace(/window\.csrfToken\s*=\s*"[^"]*"/, `window.csrfToken = "${token}"`);
  out = out.replace(
    /window\.__platform__\s*=\s*JSON\.parse\('[^']*'\)/,
    `window.__platform__ = JSON.parse('${platformJson}')`,
  );

  // 5) 品牌化：页签标题 + 去除平台水印
  //    水印由平台组件在 SPA 挂载后（甚至 Portal 到 body）异步插入，故同时给 CSS 兜底
  //    （对后续插入的元素天然生效）与 MutationObserver 移除（应对 inline style / 层级更高者）。
  out = applyBranding(out, opts);
  return out;
}

/**
 * 品牌化改写：
 * - 覆盖 `<title>`（平台默认渲染为「妙搭应用」），并用观察者钉死 SPA 运行期的动态改写；
 * - 隐藏并移除右下角「妙搭生成」水印（`data-custom-element="*-watermark[-mobile]"`）。
 */
function applyBranding(html: string, opts: SpaTemplateOptions): string {
  const wantTitle = !!opts.title;
  const wantNoWatermark = opts.removeWatermark !== false;
  if (!wantTitle && !wantNoWatermark) return html;

  const parts: string[] = [];
  if (wantNoWatermark) {
    parts.push(
      `<style data-spa-branding="1">` +
        `[data-custom-element$="-watermark"],[data-custom-element$="-watermark-mobile"]` +
        `{display:none!important;visibility:hidden!important;pointer-events:none!important}` +
        `</style>`,
    );
  }
  if (wantTitle || wantNoWatermark) {
    const titleLiteral = JSON.stringify(opts.title ?? '');
    parts.push(
      `<script data-spa-branding="1">` +
        `(function(){` +
        (wantTitle
          ? `var T=${titleLiteral};` +
            `function setTitle(){if(document.title!==T){document.title=T;}}` +
            `setTitle();`
          : '') +
        (wantNoWatermark
          ? `var SEL='[data-custom-element$="-watermark"],[data-custom-element$="-watermark-mobile"]';` +
            `function kill(){var n=document.querySelectorAll(SEL);for(var i=0;i<n.length;i++){var e=n[i];if(e.parentNode){e.parentNode.removeChild(e);}}}`
          : '') +
        `var mo=window.MutationObserver;if(mo){` +
        `var cb=function(){` +
        (wantTitle ? `setTitle();` : '') +
        (wantNoWatermark ? `kill();` : '') +
        `};` +
        `new mo(cb).observe(document.documentElement,{childList:true,subtree:true,characterData:true});` +
        `document.addEventListener('DOMContentLoaded',cb);}` +
        `})();` +
        `</script>`,
    );
  }

  let out = html;
  if (wantTitle) {
    if (/<title>[\s\S]*?<\/title>/i.test(out)) {
      out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(opts.title as string)}</title>`);
    } else {
      // 无 title 标签时补一个，保证页签不落回默认
      out = out.replace(/<head[^>]*>/i, (m) => `${m}<title>${escapeHtml(opts.title as string)}</title>`);
    }
  }
  const inject = parts.join('');
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${inject}</head>`);
  } else {
    out = inject + out;
  }
  return out;
}

/** 标题里的 & < > 需转义，避免破坏 HTML 结构 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 解析/生成 csrf token，保证与前端「头/cookie 双提交」一致。
 *
 * - https（生产/平台网关）：平台下发的 `suda-csrf-token` 带 `Secure`，浏览器会在
 *   https 下回传，直接用平台令牌即可，本函数无副作用。
 * - http（本地裸连 node）：`Secure` cookie 浏览器在 http 下**不会回传**，导致
 *   「头/cookie 双提交」永远不匹配 → 全接口 403 "csrf token not found in cookie"。
 *   故本地强制自签一张**非 Secure** 的 `suda-csrf-token` cookie（HttpOnly/SameSite=Lax），
 *   并以其值注入 `window.csrfToken`，使前端可正常补发 `x-suda-csrf-token` 头完成双提交。
 */
function resolveCsrfToken(req: Request, res: Response): string {
  const setCookie = res.getHeader('Set-Cookie');
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const isHttps =
    req.secure || String(req.headers['x-forwarded-proto'] || '').toLowerCase().startsWith('https');

  if (isHttps) {
    // 生产/平台：优先用平台下发的令牌（Secure cookie 可正常回传）
    for (const c of cookies) {
      if (typeof c === 'string') {
        const m = c.match(new RegExp(SUD_CSRF_COOKIE + '=([^;]+)'));
        if (m) return decodeURIComponent(m[1]);
      }
    }
  }

  // 本地 http：自签非 Secure 本地令牌，覆盖平台下发的 Secure 令牌
  const token = 'local-csrf-' + randomBytes(12).toString('hex');
  const localCookie = `${SUD_CSRF_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
  const others = cookies.filter(
    (c) => typeof c === 'string' && !c.startsWith(SUD_CSRF_COOKIE),
  );
  res.setHeader('Set-Cookie', others.length ? [...others, localCookie] : localCookie);
  return token;
}
