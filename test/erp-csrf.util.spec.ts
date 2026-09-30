import { describe, it, expect, beforeAll } from 'vitest';
import {
  signErpCsrfToken,
  verifyErpCsrfToken,
} from '@server/common/security/erp-csrf.util';

beforeAll(() => {
  process.env.ERP_CSRF_SIGNING_SECRET = 'test-secret-at-least-16-bytes!!';
});

describe('erp-csrf.util（D.1 自签令牌）', () => {
  it('sign → verify 通过', () => {
    const t = signErpCsrfToken();
    expect(verifyErpCsrfToken(t).ok).toBe(true);
  });

  it('令牌结构为 payload.sig 两段', () => {
    const t = signErpCsrfToken();
    expect(t.split('.')).toHaveLength(2);
  });

  it('篡改签名段 → 失败(bad_signature)', () => {
    const t = signErpCsrfToken();
    const [p] = t.split('.');
    const forged = `${p}.${'a'.repeat(43)}`;
    const r = verifyErpCsrfToken(forged);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_signature');
  });

  it('格式错误 → 失败(malformed)', () => {
    expect(verifyErpCsrfToken('not-a-token').reason).toBe('malformed');
    expect(verifyErpCsrfToken('').reason).toBe('malformed');
    expect(verifyErpCsrfToken(null).reason).toBe('malformed');
    expect(verifyErpCsrfToken(undefined).reason).toBe('malformed');
  });

  it('过期令牌（负 TTL）→ 失败(expired)', () => {
    const t = signErpCsrfToken(-10);
    const r = verifyErpCsrfToken(t);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired');
  });
});
