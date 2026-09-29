import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/**
 * POS → ERP 上行接收端的机器对机器鉴权守卫。
 *
 * 背景：该接收端是 server-to-server 接口（由 POS RealErpAdapter 主动推送），
 * 并非用户态接口。路由 `@Public()`（跳过用户态鉴权）+ 本守卫（校验共享密钥头
 * `X-Erp-Upstream-Token` 是否等于环境变量 `ERP_UPSTREAM_TOKEN`）。
 * 未配置令牌或令牌不符一律 401（fail closed），不削弱任何用户态安全。
 *
 * POS 侧：RealErpAdapter.pushToErp 从 `process.env.ERP_UPSTREAM_TOKEN` 取密钥并随请求
 * 发送该头。两端须部署同一密钥。
 *
 * P0-2 加固（2026-09-28）：
 *  - 令牌比较改用 `crypto.timingSafeEqual`，防止时序侧信道泄露；
 *  - 新增可选来源 IP 白名单 `ERP_RECEIVER_ALLOWED_IPS`（逗号分隔，支持精确 IP 与 CIDR，
 *    如 `10.0.0.0/8,127.0.0.1`）；未配置则不限制来源（仍强制令牌），配置后仅放行名单内来源；
 *  - 全程 fail closed：未配置令牌 / 令牌不符 / 来源不在白名单 → 401。
 */
@Injectable()
export class UpstreamTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ERP_UPSTREAM_TOKEN;
    // 未配置令牌则拒绝开放（fail closed）：避免接收端被匿名访问
    if (!expected) {
      throw new UnauthorizedException(
        'ERP 上行接收端未配置上游令牌（ERP_UPSTREAM_TOKEN）',
      );
    }
    const req = context.switchToHttp().getRequest<Request>();

    // P0-2：来源 IP 白名单（可选）。注意 req.ip 依赖 trust proxy 设置；
    // 本地未设 trust proxy 时 req.ip 为 ::1 / 127.0.0.1，生产网关需启用 trust proxy。
    if (!isIpAllowed(req, process.env.ERP_RECEIVER_ALLOWED_IPS)) {
      throw new UnauthorizedException('上行请求来源不在允许名单内');
    }

    const provided =
      (req.headers['x-erp-upstream-token'] as string | undefined) ?? '';
    if (!timingSafeEqualStr(expected, provided)) {
      throw new UnauthorizedException('上行令牌无效');
    }
    return true;
  }
}

/** 时序安全字符串比较：长度不同直接 false，避免抛错导致的时序差异。 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a ?? '', 'utf8');
  const bb = Buffer.from(b ?? '', 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** 规范化 IP：IPv4-mapped IPv6 → IPv4，::1 → 127.0.0.1。 */
function normalizeIp(ip: string): string {
  if (!ip) return ip;
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

/** IPv4 字符串转 32 位无符号整数；非法返回 null。 */
function ipToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return (
    (((parts[0] << 24) >>> 0) +
      (parts[1] << 16) +
      (parts[2] << 8) +
      parts[3]) >>>
    0
  );
}

/** 判断 ip 是否落在 cidr（如 10.0.0.0/8）；无 / 后缀按 /32 精确匹配。 */
function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
  const ipInt = ipToInt(normalizeIp(ip));
  const baseInt = ipToInt(base);
  if (ipInt === null || baseInt === null || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** 来源 IP 是否在白名单内；白名单为空（未配置）则放行所有来源（仍强制令牌）。 */
function isIpAllowed(req: Request, allowedCsv?: string): boolean {
  if (!allowedCsv || !allowedCsv.trim()) return true;
  const ip = normalizeIp(
    (req.ip || (req.socket as { remoteAddress?: string })?.remoteAddress || '')
      .toString(),
  );
  const rules = allowedCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return rules.some((r) =>
    r.includes('/') ? ipInCidr(ip, r) : normalizeIp(r) === ip,
  );
}
