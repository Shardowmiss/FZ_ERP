import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import helmet from 'helmet';
import express from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { __express as hbsExpressEngine } from 'hbs';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { PosUpstreamCsrfBypassMiddleware } from './middleware/pos-upstream-csrf-bypass';
import { requestLogMiddleware } from './middleware/request-log.middleware';
import { spaTemplateMiddleware } from './middleware/spa-template.middleware';
import { validateSecrets } from './common/crypto/secret-validation';

async function bootstrap() {
  // 云端部署兜底：未配置平台基础域名时给占位值，避免 lark-apaas PlatformModule 在
  // 依赖注入阶段即抛 “平台模式需要基础域名” 并中止引导（端口无人监听 → 外网“拒绝连接”）。
  // 仅影响非飞书/豆包原生集成场景的平台内部 HTTP 客户端，对本 ERP 业务无副作用。
  process.env.FORCE_AUTHN_INNERAPI_DOMAIN ??= 'https://placeholder.local';

  // P0-2 启动期密钥校验：生产缺失/弱 FIELD_ENC_KEY 等必要密钥即中止启动（fail-fast）。
  validateSecrets();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: process.env.NODE_ENV !== 'development',
  });
  // CSRF 豁免：仅 /api/pos-receiver/* 且携带有效 X-Erp-Upstream-Token 时放行（须在 configureApp 之前注册，
  // 使平台 CsrfMiddleware 之前即注入一致的 CSRF 凭据；真实鉴权仍由 UpstreamTokenGuard 完成）。
  app.use((req, res, next) => new PosUpstreamCsrfBypassMiddleware().use(req, res, next));
  // 请求上下文与访问日志（Wave 4-A② / P2-c）：必须早于平台 CSRF / 鉴权，
  // 使 401/403/500 等被拒或失败的响应同样带 requestId，链路不被截断。
  app.use(requestLogMiddleware);
  // 本地裸连 node 的 SPA 静态资源服务：平台 configureApp 仅以 catch-all（@Render index）下发 SPA，
  // 并不在本地 node 上真实服务 /client/assets/*（生产靠网关/CDN）。裸连时这些请求会落到 catch-all
  // 被兜底成 index.html（Content-Type=text/html、体积=index.html），浏览器把 HTML 当 JS module 执行 → 白屏。
  // 故在 configureApp 之前显式挂载 express.static(dist/client)，以 CLIENT_BASE_PATH 为前缀、关闭 index：
  // 真资源先被命中带正确 MIME；非资源路径（含 /client/ 与 SPA 深链）继续走平台 catch-all 渲染 index.html。
  // 兼容两种构建产物布局（均相对 server 入口推导，不受 cwd 影响）。
  // 必须以「含 assets 子目录」为准——build.sh 会在 dist/dist/client 留下仅含 index.html 的残缺目录，
  // 若优先命中它，express.static 找不到真实 JS/CSS → 全走 catch-all 兜底成 index.html → 白屏。
  const erpDistDir = join(__dirname, '..');
  const erpClientCandidates = [join(erpDistDir, 'client'), join(erpDistDir, 'dist', 'client')];
  const erpClientDir =
    erpClientCandidates.find((p) => existsSync(join(p, 'index.html')) && existsSync(join(p, 'assets'))) ||
    erpClientCandidates.find((p) => existsSync(p)) ||
    erpClientCandidates[1];
  const erpClientBase = process.env.CLIENT_BASE_PATH || '';
  app.use(erpClientBase, express.static(erpClientDir, { index: false, fallthrough: true }));
  // 防呆重定向：SPA 挂在 CLIENT_BASE_PATH（/client）之下，裸根路径 / 会命中平台 catch-all 之外的
  // 404 JSON（Cannot GET /）。GET / 一律 302 到 SPA 入口，避免「打开 localhost:3000 看到裸 404/空白」。
  if (erpClientBase) {
    app.use((req, res, next) => {
      if (req.method === 'GET' && (req.path === '/' || req.path === '')) {
        return res.redirect(erpClientBase.endsWith('/') ? erpClientBase : `${erpClientBase}/`);
      }
      next();
    });
  }
  // 本地裸连 node 的 SPA 模板占位符替换：早于 configureApp 注册，使视图引擎渲染后的
  // 最终 HTML 在 send 前被替换为本地值（appId/basename/csrfToken/__platform__），
  // 不受 build:client 覆盖影响，本地可正常渲染并登录（平台网关下无副作用）。
  app.use(spaTemplateMiddleware({ appId: 'erp-local-dev', appName: 'ERP本地', basename: '/client/' }));
  await configureApp(app, { 
    disableSwagger: true,
  });
  // SPA 入口(text/html)响应头加固：平台在渲染 SPA 时会在最终发送前重置自定义响应头
  // （请求初期 / res.end 内层设的 Cache-Control 均被清空），故在此 configureApp **之后**注册，
  // 成为最外层 res.end / res.writeHead 包裹，于真正序列化响应头前强制写入 Cache-Control: no-cache，
  // 杜绝「旧 index.html 被浏览器缓存 → 引用已被重建清除的旧 hash 资源 → 兜底成 HTML → 白屏」复发
  // （assets 走自身 ETag/协商缓存，不受此 no-cache 影响）。
  app.use((_req, res, next) => {
    const origEnd = res.end.bind(res);
    const origWriteHead = res.writeHead.bind(res);
    const forceNoCache = () => {
      const ct = res.getHeader('Content-Type');
      if (typeof ct === 'string' && ct.toLowerCase().includes('text/html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    };
    res.writeHead = function (...args: unknown[]) {
      forceNoCache();
      return (origWriteHead as (...a: unknown[]) => unknown)(...args);
    } as typeof res.writeHead;
    res.end = function (chunk?: unknown, ...args: unknown[]) {
      forceNoCache();
      return (origEnd as (c?: unknown, ...a: unknown[]) => unknown)(chunk, ...args);
    } as typeof res.end;
    next();
  });
  // 安全加固：统一注入防护响应头（X-Content-Type-Options、X-Frame-Options、CSP、HSTS 等）。
  // 该 ERP 使用 express 视图引擎渲染 HBS 页面，关闭 CSP default-src 的 strict 限制以免破坏既有内联脚本/样式。
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
    }),
  );
  // 全局输入校验：对声明了 class-validator DTO 的端点做类型校验与转换（400 拦截非法入参），
  // 配合 GlobalExceptionFilter 归一为 fieldErrors。未声明 DTO 的 body:any 端点不受影响。
  // 注意：采用 whitelist:false（不剥离、不拒绝前端可能额外携带的字段），仅校验已声明字段，
  // 避免误伤既有前端请求；剥离/拒绝策略交由各端点按需通过 @UsePipes 覆写。
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      forbidNonWhitelisted: false,
    }),
  );
  const logger = new Logger('Bootstrap');
  // 云平台部署必须监听 0.0.0.0（默认 localhost 会导致外网代理 '连接被拒绝'）；
  // 端口优先读 SERVER_PORT，兼容平台注入的 PORT 环境变量，兜底 3000。
  const host = process.env.SERVER_HOST || '0.0.0.0';
  const port = Number(process.env.SERVER_PORT || process.env.PORT || '3000');

  // 注册视图引擎, 渲染 client 目录下的 html 文件
  // 兼容两种构建产物布局（均相对 server 入口推导根目录，不受 cwd 影响）：
  //   - build.sh：HTML 被移到 dist/dist/client
  //   - build:prod / vite：产物在 dist/client
  const distDir = join(__dirname, '..');
  const viewsCandidates = [
    join(distDir, 'dist', 'client'),
    join(distDir, 'client'),
  ];
  const viewsDir = viewsCandidates.find((p) => existsSync(p)) || viewsCandidates[1];
  app.setBaseViewsDir(viewsDir);
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);

  await app.listen(port, host);
  logger.log(`Server running on ${host}:${port}`);
  logger.log(`API endpoints ready at http://${host}:${port}/api`);
}

bootstrap();
