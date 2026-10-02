import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import { join } from 'path';
import { existsSync } from 'fs';
import { __express as hbsExpressEngine } from 'hbs';
import helmet from 'helmet';
import express from 'express';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { requestLogMiddleware } from './middleware/request-log.middleware';
import { spaTemplateMiddleware } from './middleware/spa-template.middleware';

async function bootstrap() {
  // 本地/云端兜底：未配置平台基础域名时给占位值，避免 lark-apaas PlatformModule 在
  // 依赖注入阶段即抛 “平台模式需要基础域名” 并中止引导（端口无人监听 → 外网“拒绝连接”）。
  process.env.FORCE_AUTHN_INNERAPI_DOMAIN ??= 'https://placeholder.local';

  // P1-6：生产环境必须配置 POS_AUTH_SECRET，否则令牌无法验签、等于无鉴权。
  // 启动即失败（fail-fast），避免「上线后所有写接口裸奔」。
  if (process.env.NODE_ENV === 'production' && !process.env.POS_AUTH_SECRET) {
    throw new Error(
      '[P1-6] 生产环境必须设置环境变量 POS_AUTH_SECRET，否则 POS 鉴权形同虚设。',
    );
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: process.env.NODE_ENV !== 'development',
  });
  // 本地裸连 node 的 SPA 静态资源服务：平台 configureApp 仅以 catch-all（@Render index）下发 SPA，
  // 并不在本地 node 上真实服务 /client/assets/*（生产靠网关/CDN）。裸连时这些请求会落到 catch-all
  // 被兜底成 index.html（Content-Type=text/html、体积=index.html），浏览器把 HTML 当 JS module 执行 → 白屏。
  // 故在 configureApp 之前显式挂载 express.static(dist/client)，以 CLIENT_BASE_PATH 为前缀、关闭 index：
  // 真资源先被命中带正确 MIME；非资源路径（含 /client/ 与 SPA 深链）继续走平台 catch-all 渲染 index.html。
  const posClientDir = join(process.cwd(), 'dist', 'client');
  const posClientBase = process.env.CLIENT_BASE_PATH || '';
  if (existsSync(posClientDir)) {
    app.use(posClientBase, express.static(posClientDir, { index: false, fallthrough: true }));
  }
  // 防呆重定向：SPA 挂在 CLIENT_BASE_PATH（/client）之下，裸根路径 / 会命中平台 catch-all 之外的
  // 404 JSON（Cannot GET /）。GET / 一律 302 到 SPA 入口，避免「打开 localhost:3001 看到裸 404/空白」。
  if (posClientBase) {
    app.use((req, res, next) => {
      if (req.method === 'GET' && (req.path === '/' || req.path === '')) {
        return res.redirect(posClientBase.endsWith('/') ? posClientBase : `${posClientBase}/`);
      }
      next();
    });
  }
  // 本地裸连 node 的 SPA 模板占位符替换：早于 configureApp 注册，使视图引擎渲染后的
  // 最终 HTML 在 send 前被替换为本地值（appId/basename/csrfToken/__platform__），
  // 不受 build:client 覆盖影响，本地可正常渲染并登录（平台网关下无副作用）。
  // 取代原先仅改 window.csrfToken 的 pos-local-csrf 中间件，覆盖全部占位符。
  app.use(spaTemplateMiddleware({ appId: 'pos-local-dev', appName: 'POS本地', basename: '/client/' }));
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
  // P0-5：基础安全头（防点击劫持/MIME 嗅探/窃听 referrer 等）。
  // CSP 放宽以兼容 SPA 内联脚本；如需更强防护，后续可收紧为 nonce 方案。
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
  // 请求上下文与访问日志（Wave 4-A② / P2-c）：早于业务路由注册，
  // 使被守卫拒掉（401/403）与异常（500）的响应同样带有可检索的 requestId。
  app.use(requestLogMiddleware);
  // P1-7：全局输入校验。
  // - transform:true 让带装饰器的 class DTO 自动按类型转型；
  // - whitelist:true 剥离 class DTO 上未声明的字段（防客户端注入多余/越权字段）；
  //   未迁移为 class 的 interface 型 DTO 因无装饰器元数据，whitelist 对其不生效，故逐步迁移是安全的。
  // - forbidNonWhitelisted:false 仅剥离、不直接 400，避免误伤离线端发来的附加字段（如 entityData）。
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );
  const logger = new Logger('Bootstrap');
  // 云平台部署必须监听 0.0.0.0（默认 localhost 会导致外网代理 '连接被拒绝'）；
  // 端口优先读 SERVER_PORT，兼容平台注入的 PORT 环境变量，兜底 3000。
  const host = process.env.SERVER_HOST || '0.0.0.0';
  const port = Number(process.env.SERVER_PORT || process.env.PORT || '3000');

  // 注册视图引擎, 渲染 client 目录下的 html 文件
  app.setBaseViewsDir(join(process.cwd(), 'dist/client'));
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);

  await app.listen(port, host);
  logger.log(`Server running on ${host}:${port}`);
  logger.log(`API endpoints ready at http://${host}:${port}/api`);
}

bootstrap();
