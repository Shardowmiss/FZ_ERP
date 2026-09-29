import { describe, it, expect } from 'vitest';
import { styleAttribute, style, colorGroup, sizeGroup } from '@server/database/schema';
import { StyleAttributeService } from '@server/modules/base/style-attribute/style-attribute.service';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import { withIsolatedTransaction } from './utils/db';

/**
 * 验证「修改品牌名称」被款号引用时，返回具体原因而非笼统的「保存失败」。
 */
describe('品牌主数据改名被引用校验', () => {
  it('品牌被款号引用时改名应被拒绝，并给出具体原因', async () => {
    await withIsolatedTransaction(async ({ db }) => {
      const cg = await db
        .insert(colorGroup)
        .values({ code: `CG_${Date.now()}_${Math.random()}`, name: '测试色组' })
        .returning();
      const sg = await db
        .insert(sizeGroup)
        .values({ code: `SG_${Date.now()}_${Math.random()}`, name: '测试尺组' })
        .returning();
      const brand = await db
        .insert(styleAttribute)
        .values({ attrType: 'brand', attrCode: `B_${Date.now()}`, attrName: '耐克', status: 'active' })
        .returning();
      await db.insert(style).values({
        styleNo: `S_${Date.now()}_${Math.random()}`,
        name: '款A',
        colorGroupId: cg[0].id,
        sizeGroupId: sg[0].id,
        brand: '耐克',
      });

      const svc = new StyleAttributeService(db as any);
      let thrown: unknown;
      try {
        await svc.update(brand[0].id, { attrName: '耐克改名' });
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(BusinessException);
      const msg = (thrown as BusinessException).message;
      expect(msg).toContain('耐克');
      expect(msg).toContain('款号');
      expect(msg).toContain('不允许修改');
    });
  });

  it('品牌未被任何款号引用时改名应成功', async () => {
    await withIsolatedTransaction(async ({ db }) => {
      const cg = await db
        .insert(colorGroup)
        .values({ code: `CG2_${Date.now()}_${Math.random()}`, name: '测试色组' })
        .returning();
      const sg = await db
        .insert(sizeGroup)
        .values({ code: `SG2_${Date.now()}_${Math.random()}`, name: '测试尺组' })
        .returning();
      const brand = await db
        .insert(styleAttribute)
        .values({ attrType: 'brand', attrCode: `B2_${Date.now()}`, attrName: '阿迪', status: 'active' })
        .returning();

      const svc = new StyleAttributeService(db as any);
      const updated = await svc.update(brand[0].id, { attrName: '阿迪达斯' });
      expect(updated.attrName).toBe('阿迪达斯');
    });
  });
});
