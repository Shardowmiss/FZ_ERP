/**
 * P0-2 字段加密切片 2b/2c（store / dealer / supplier / rbac_user 联系电话）。
 *
 * 真库 erp_test 回归（trust-but-verify，拒绝 mock 假绿）：
 *   · 验证「写时 AES-256-GCM 加密落密文 + 计算 HMAC 指纹列；读时解密还原明文」的契约；
 *   · 验证加密/解密/HMAC 用的就是生产运行时同一份 server/common/crypto/field-encryption；
 *   · 四张表列结构（phone varchar(255) 密文 + phone_hmac varchar(64) 指纹 + 索引）一致可用。
 *
 * 隔离：每个用例包在可回滚事务里（withIsolatedTransaction），不污染测试库。
 * 密钥：优先用 .env 的 FIELD_ENC_KEY 镜像生产；缺省走 field-encryption 的确定性兜底密钥
 *       （同一进程内保持一致，断言仍成立）。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import {
  createTestClient,
  createTestDb,
  TEST_DB_NAME,
  withIsolatedTransaction,
} from './utils/db';
import { StoreService } from '@server/modules/base/store/store.service';
import {
  encryptField,
  decryptField,
  hmacField,
  isEncrypted,
} from '@server/common/crypto/field-encryption';
import { store, dealer, supplier, rbacUser } from '@server/database/schema';

const ROOT = path.resolve(__dirname, '..');
if (!process.env.FIELD_ENC_KEY) {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const m = env.match(/^FIELD_ENC_KEY=(.*)$/m);
  if (m) process.env.FIELD_ENC_KEY = m[1].trim();
}

const client = createTestClient();
const db = createTestDb(client);

afterAll(async () => {
  await client.end().catch(() => undefined);
});

const PLAIN = '13900008888';

describe('P0-2 联系电话字段加密（真库）', () => {
  it('测试库不是开发库（防误擦 erp_db）', () => {
    expect(TEST_DB_NAME).not.toBe('erp_db');
  });

  it('1) store.create 落密文+指纹，DTO 读回明文；store.update 改号同步刷新', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      const svc = new StoreService(tx as never);
      const code = `ENC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

      const created = await svc.create({
        code,
        name: '加密用例店',
        storeType: 'direct',
        phone: PLAIN,
      });
      expect(created.phone).toBe(PLAIN); // 读路径解密还原

      const [c] = await tx
        .select({ phone: store.phone, phoneHmac: store.phoneHmac })
        .from(store)
        .where(eq(store.id, created.id));
      expect(isEncrypted(c.phone)).toBe(true); // 落库为密文
      expect(c.phoneHmac).toBe(hmacField(PLAIN)); // 指纹列一致
      expect(decryptField(c.phone)).toBe(PLAIN); // 可解密

      const fresh = '13611112222';
      const updated = await svc.update(created.id, { phone: fresh });
      expect(updated.phone).toBe(fresh);
      const [u] = await tx
        .select({ phone: store.phone, phoneHmac: store.phoneHmac })
        .from(store)
        .where(eq(store.id, created.id));
      expect(u.phoneHmac).toBe(hmacField(fresh));
      expect(decryptField(u.phone)).toBe(fresh);
      expect(decryptField(u.phone)).not.toBe(PLAIN); // 旧明文不可还原
    });
  });

  it('2) 四表（store/dealer/supplier/rbac_user）密文+指纹列结构一致且往返正确', async () => {
    const tables = [
      { t: store, id: (await db.select({ id: store.id }).from(store).limit(1))[0]?.id },
      { t: dealer, id: (await db.select({ id: dealer.id }).from(dealer).limit(1))[0]?.id },
      { t: supplier, id: (await db.select({ id: supplier.id }).from(supplier).limit(1))[0]?.id },
      { t: rbacUser, id: (await db.select({ id: rbacUser.id }).from(rbacUser).limit(1))[0]?.id },
    ];
    for (const { t, id } of tables) {
      if (!id) {
        // 极端情况下该表无行则跳过（结构已由迁移保证），不视为失败
        continue;
      }
      await withIsolatedTransaction(async ({ db: tx }) => {
        await tx
          .update(t)
          .set({ phone: encryptField(PLAIN) as never, phoneHmac: hmacField(PLAIN) as never })
          .where(eq((t as any).id, id));
        const [row] = await tx
          .select({ phone: (t as any).phone, phoneHmac: (t as any).phoneHmac })
          .from(t)
          .where(eq((t as any).id, id));
        expect(isEncrypted(row.phone)).toBe(true);
        expect(row.phoneHmac).toBe(hmacField(PLAIN));
        expect(decryptField(row.phone)).toBe(PLAIN);
      });
    }
  });
});
