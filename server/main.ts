import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import helmet from 'helmet';
import { join } from 'path';
import { existsSync } from 'fs';
import { __express as hbsExpressEngine } from 'hbs';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { PosUpstreamCsrfBypassMiddleware } from './middleware/pos-upstream-csrf-bypass';
import { requestLogMiddleware } from './middleware/request-log.middleware';

async function bootstrap() {
  // 云端部署兜底：未配置平台基础域名时给占位值，避免 lark-apaas PlatformModule 在
  // 依赖注入阶段即抛 “平台模式需要基础域名” 并中止引导（端口无人监听 → 外网“拒绝连接”）。
  // 仅影响非飞书/豆包原生集成场景的平台内部 HTTP 客户端，对本 ERP 业务无副作用。
  process.env.FORCE_AUTHN_INNERAPI_DOMAIN ??= 'https://placeholder.local';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: process.env.NODE_ENV !== 'development',
  });
  // CSRF 豁免：仅 /api/pos-receiver/* 且携带有效 X-Erp-Upstream-Token 时放行（须在 configureApp 之前注册，
  // 使平台 CsrfMiddleware 之前即注入一致的 CSRF 凭据；真实鉴权仍由 UpstreamTokenGuard 完成）。
  app.use((req, res, next) => new PosUpstreamCsrfBypassMiddleware().use(req, res, next));
  // 请求上下文与访问日志（Wave 4-A② / P2-c）：必须早于平台 CSRF / 鉴权，
  // 使 401/403/500 等被拒或失败的响应同样带 requestId，链路不被截断。
  app.use(requestLogMiddleware);
  await configureApp(app, { 
    disableSwagger: true,
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
