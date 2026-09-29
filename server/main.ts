import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import { join } from 'path';
import { __express as hbsExpressEngine } from 'hbs';
import helmet from 'helmet';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { requestLogMiddleware } from './middleware/request-log.middleware';

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
  await configureApp(app, { 
    disableSwagger: true,
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
