/**
 * E.1 编码规则 CodeRuleService —— 直连 erp_db 真实数据。
 *
 * CodeRuleService 仅依赖 db：
 *   · getDefaultRule 在 code_rule 为空时回退到默认规则 DTO（真实回退行为）；
 *   · saveRule 写入后 getDefaultRule 可查回，并验证 ROLLBACK 后开发库无痕。
 */
import { describe, it, expect } from 'vitest';
import { CodeRuleService } from '@server/modules/system/code-rule/code-rule.service';
import { createErpClient, withErpIsolatedTransaction } from './utils/erp-db';

const RULE_NAME = `E1-rule-${Date.now()}`;

describe('E.1 编码规则 CodeRuleService（直连 erp_db）', () => {
  it('getDefaultRule：code_rule 为空时回退到默认规则 DTO', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      const svc = new CodeRuleService(db as any);
      const rule = await svc.getDefaultRule();
      expect(rule.isDefault).toBe(true);
      expect(Array.isArray(rule.segments)).toBe(true);
      expect(rule.segments.length).toBeGreaterThan(0);
    });
  });

  it('saveRule 写入后 getDefaultRule 可查回，ROLLBACK 后开发库无该规则', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      const svc = new CodeRuleService(db as any);
      const saved = await svc.saveRule({
        name: RULE_NAME,
        segments: [{ type: 'const', value: 'E1' }],
        isDefault: true,
      });
      expect(saved.id).toBeTruthy();
      const def = await svc.getDefaultRule();
      expect(def.name).toBe(RULE_NAME);
    });

    // 事务外复核：规则不应持久化
    const client = createErpClient();
    try {
      const r = await client<{ c: number }>`
        select count(*)::int as c from code_rule where name=${RULE_NAME}
      `;
      expect(Number(r[0]?.c ?? 0)).toBe(0);
    } finally {
      await client.end();
    }
  });
});
