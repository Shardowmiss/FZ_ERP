import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';
import type { Response } from 'express';

/**
 * 应用层自签 CSRF 令牌（D.1 增强）。
 *
 * 背景：平台 `@lark-apaas/fullstack-nestjs-core` 的 CsrfMiddleware 是「double-submit cookie」
 * （cookie `suda-csrf-token` 值回放为 header），令牌本身无签名、可被同源读取后重放。
 * 本模块在其之上叠加一层「服务端 HMAC 签名」的 CSRF 令牌，密钥仅服务端持有，
 * 攻击者无法伪造，且配合 double-submit 防止跨站携带。
 *
 * 机制：
 *  - 登录 / 已登录会话（GET /api/auth/me）下发 `erp-csrf` cookie（非 HttpOnly，便于前端回放）。
 *  - 前端拦截器读取该 cookie 并作为 `x-erp-csrf` header 回放（double-submit）。
 *  - ErpCsrfGuard 校验：cookie === header 且 HMAC 签名有效且未过期。
 *  - 密钥来自 ERP_CSRF_SIGNING_SECRET；生产环境缺失直接启动失败，杜绝弱密钥。
 */

export const ERP_CSRF_COOKIE_NAME = 'erp-csrf';
export const ERP_CSRF_HEADER_NAME = 'x-erp-csrf';
export const ERP_CSRF_TTL_SECONDS = 12 * 60 * 60; // 12 小时

const SECRET_ENV = 'ERP_CSRF_SIGNING_SECRET';
let cachedSecret: string | null = null;

function getSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env[SECRET_ENV];
  if (fromEnv && fromEnv.length >= 16) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  // 生产环境必须显式配置强密钥；缺失即拒绝签发（登录/me 会返回清晰 500），
  // 避免落到可被预测的兜底密钥。
  if (process.env.NODE_ENV === 'production') {
    throw new InternalServerErrorException(
      `[erp-csrf] 生产环境必须配置 ${SECRET_ENV}（>=16 位随机串），已拒绝使用兜底密钥。`,
    );
  }
  // 本地开发兜底：每进程一次性随机密钥（重启即失效），仅方便本地联调。
  cachedSecret = randomBytes(32).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    `[erp-csrf] 未配置 ${SECRET_ENV}，已使用本次进程随机密钥（重启失效），仅限本地开发。`,
  );
  return cachedSecret;
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const norm = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(norm, 'base64');
}

interface ErpCsrfPayload {
  exp: number; // 秒级过期时间戳
  jti: string; // 随机 nonce，防止重放/碰撞
}

export function signErpCsrfToken(ttlSeconds: number = ERP_CSRF_TTL_SECONDS): string {
  const payload: ErpCsrfPayload = {
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    jti: randomBytes(8).toString('hex'),
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(createHmac('sha256', getSecret()).update(payloadB64).digest());
  return `${payloadB64}.${sig}`;
}

export type ErpCsrfVerifyReason = 'malformed' | 'bad_signature' | 'expired';

export interface ErpCsrfVerifyResult {
  ok: boolean;
  reason?: ErpCsrfVerifyReason;
}

export function verifyErpCsrfToken(token: string | undefined | null): ErpCsrfVerifyResult {
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, reason: 'malformed' };
  }
  const [payloadB64, sig] = parts;
  const expectedSig = b64url(createHmac('sha256', getSecret()).update(payloadB64).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  // 时序安全比较，防侧信道；长度不同直接 false。
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let payload: ErpCsrfPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

/** 在登录 / 已登录会话端点向浏览器下发自签 CSRF cookie。 */
export function setErpCsrfCookie(res: Response): void {
  const token = signErpCsrfToken();
  res.cookie(ERP_CSRF_COOKIE_NAME, token, {
    httpOnly: false, // 必须非 HttpOnly：前端 JS 需读取并回放为 header（double-submit）
    sameSite: 'lax', // 防止跨站请求携带
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ERP_CSRF_TTL_SECONDS * 1000,
  });
}

/** 登出时清除自签 CSRF cookie。 */
export function clearErpCsrfCookie(res: Response): void {
  res.clearCookie(ERP_CSRF_COOKIE_NAME, { path: '/' });
}
