/* 多级分销修复验证（事务内执行，结束统一 ROLLBACK，不落库）
 * ------------------------------------------------------------------
 * 验证三件事：
 *   A. 根节点建档不再崩溃 —— dealer.service.ts 原 `parent?.treePath || `/${parent!.id}``
 *      在无上级时对 undefined 取属性，必抛 TypeError。
 *   B. 上级被挂下级时自动补「供应商身份」 —— 防止 39 节点缺身份的漂移重演。
 *   C. 镜像链路真正打通 —— 上级有供应商身份后，销售单 book 应成功生成下游采购单
 *      （修复前 12 张单全部 mirror_status='skipped'，镜像产出为 0）。
 *
 * 用法：node verify-multilevel-fix.cjs
 */
const path = require('path');
const fs = require('fs');
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, and, isNull, sql } = require('drizzle-orm');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}
loadEnv();

const schema = require('./dist/server/database/schema');
const { dealer, supplier, salesOrder, salesOrderItem, garmentPurchaseOrder, sku } = schema;
const { DealerService } = require('./dist/server/modules/base/dealer/dealer.service');
const { SalesOrderService } = require('./dist/server/modules/sales/order/sales-order.service');
const { NumberGeneratorService } = require('./dist/server/modules/system/code-rule/number-generator.service');
const { GarmentPurchaseOrderService } = require('./dist/server/modules/purchase/garment-order/garment-purchase-order.service');
const { GarmentPurchaseReturnService } = require('./dist/server/modules/purchase/garment-return/garment-purchase-return.service');
const { DistributionMirrorService } = require('./dist/server/modules/distribution/distribution-mirror.service');

const client = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const db = drizzle(client, { schema });

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
};

async function main() {
  console.log('=== 多级分销修复验证（事务内，结束回滚）===\n');

  const result = {};
  // 故意回滚哨兵：事务内跑完所有验证后抛出，保证不污染生产数据
  const SENTINEL = '__ROLLBACK_INTENTIONAL__';

  try {
    await db.transaction(async (tx) => {
      const dealerSvc = new DealerService(tx);
      const ng = new NumberGeneratorService();
      const garmentOrder = new GarmentPurchaseOrderService(tx, ng);
      const garmentReturn = new GarmentPurchaseReturnService(tx, ng);
      const mirror = new DistributionMirrorService(tx, garmentOrder, garmentReturn);
      const salesSvc = new SalesOrderService(tx, ng, mirror);

      // ---------- A. 根节点建档（无上级） ----------
      console.log('[A] 根节点建档：修复前会因 `parent!.id` 崩溃');
      let root;
      try {
        root = await dealerSvc.create({
          code: 'VRF-ROOT-01',
          name: '验证·根节点(无上级)',
          status: 'active',
        });
        // create 的返回值是精简投影（不含 treePath），需回查真实落库值
        const [rootRow] = await tx.select().from(dealer).where(eq(dealer.id, root.id));
        result.A = !!rootRow && rootRow.treePath === `/${root.id}`;
        check('根节点创建成功且 treePath 正确', result.A, `treePath=${rootRow && rootRow.treePath}`);
      } catch (e) {
        result.A = false;
        check('根节点创建成功', false, `${e.constructor.name}: ${e.message}`);
      }

      // ---------- B. 挂下级 → 上级自动获得供应商身份 ----------
      console.log('\n[B] 给根节点挂下级：应自动为上级补「供应商身份」');
      if (root) {
        const child = await dealerSvc.create({
          code: 'VRF-CHILD-01',
          name: '验证·子节点',
          parentId: root.id,
          status: 'active',
        });
        const [childRow] = await tx.select().from(dealer).where(eq(dealer.id, child.id));
        const [rRow] = await tx.select().from(dealer).where(eq(dealer.id, root.id));
        check('子节点 treePath 继承上级', childRow.treePath === `${rRow.treePath}/${child.id}`,
          `child=${childRow.treePath} parent=${rRow.treePath}`);

        const sup = await tx.select().from(supplier)
          .where(and(eq(supplier.partnerId, root.id), isNull(supplier.deletedAt)));
        check('上级自动生成供应商身份', sup.length > 0, sup[0] ? `code=${sup[0].code}` : '未生成');
        check('供应商身份名称与上级一致', sup[0] && sup[0].name === rRow.name,
          sup[0] ? `supplier.name=${sup[0].name}` : 'n/a');

        // 幂等：再次触发不应重复创建
        await dealerSvc.create({ code: 'VRF-CHILD-02', name: '验证·子节点2', parentId: root.id, status: 'active' });
        const sup2 = await tx.select().from(supplier)
          .where(and(eq(supplier.partnerId, root.id), isNull(supplier.deletedAt)));
        check('幂等：重复挂下级不产生重复身份', sup2.length === 1, `共 ${sup2.length} 条`);
      }

      // ---------- C. 真实链路：销售单 → 镜像采购单 ----------
      console.log('\n[C] 真实数据镜像：选取修复前应 skipped 的下级经销商');
      // 找一个「有上级、且上级已有供应商身份」的经销商作为收货方
      const rows = await tx.execute(sql`
        SELECT d.id AS dealer_id, d.name AS dealer_name, d.level,
               pd.id AS parent_dealer_id, pd.name AS parent_name,
               s.id AS parent_supplier_id, s.code AS parent_supplier_code
        FROM dealer d
        JOIN dealer pd ON pd.id = d.parent_id
        JOIN supplier s ON s.partner_id = pd.id AND s._deleted_at IS NULL
        WHERE d.status='active'
        ORDER BY d.level DESC
        LIMIT 1
      `);
      const target = rows[0];
      if (!target) { check('找到可验证的分销节点', false, '无符合条件节点'); }
      else {
        console.log(`  收货方: ${target.dealer_name} (level ${target.level})`);
        console.log(`  其上级: ${target.parent_name} (供应商身份 ${target.parent_supplier_code})`);

        const [sk] = await tx.select().from(sku).limit(1);
        if (!sk) { check('存在可用 SKU', false); }
        else {
          const so = await salesSvc.create({
            dealerId: target.dealer_id,
            orderDate: new Date().toISOString().slice(0, 10),
            items: [{ skuId: sk.id, quantity: 5, price: 100 }],
            remark: '验证：多级分销镜像',
          });
          await salesSvc.audit(so.id);
          await salesSvc.book(so.id);

          const [after] = await tx.select().from(salesOrder).where(eq(salesOrder.id, so.id));
          check('销售单记账后 mirror_status=success', after.mirrorStatus === 'success',
            `mirrorStatus=${after.mirrorStatus}${after.mirrorError ? ' err=' + after.mirrorError : ''}`);

          const pos = after.mirrorOrderId
            ? await tx.select().from(garmentPurchaseOrder).where(eq(garmentPurchaseOrder.id, after.mirrorOrderId))
            : [];
          check('已生成下游采购单', pos.length > 0, pos[0] ? `采购单号=${pos[0].orderNo}` : '未生成');
          if (pos[0]) {
            check('采购单上家=上级供应商身份', pos[0].supplierName === target.parent_name,
              `supplierName=${pos[0].supplierName}`);
            check('采购单归属=下级经销商', pos[0].downstreamOrgId === target.dealer_id,
              `downstream=${pos[0].downstreamOrgId}`);
            check('采购单初始为待接收', pos[0].status === 'wait_confirm', `status=${pos[0].status}`);
          }
        }
      }

      // ---------- D. 反向镜像：下级采购单 → 上级销售单 ----------
      console.log('\n[D] 反向镜像：经销商向自己的上级发起采购单');
      const [dSku] = await tx.select().from(sku).limit(1);
      if (target && dSku) {
        const today = new Date().toISOString().slice(0, 10);
        const po = await garmentOrder.create({
          supplierId: target.parent_supplier_id,
          supplierName: target.parent_name,
          orderDate: today,
          remark: '验证：反向镜像',
          skus: [{
            skuId: dSku.id,
            styleId: dSku.styleId,
            styleNo: dSku.styleNo,
            color: dSku.color,
            size: dSku.size,
            quantity: 3,
            price: 80,
          }],
        });
        // 打上归属标记：真实场景中经销商身份登录时会写入该字段
        await tx.update(garmentPurchaseOrder)
          .set({ downstreamOrgId: target.dealer_id })
          .where(eq(garmentPurchaseOrder.id, po.id));

        await mirror.mirrorFromPurchaseOrder(po.id);

        const generated = await tx.select().from(salesOrder)
          .where(eq(salesOrder.sourceDocId, po.id));
        check('生成上级销售单', generated.length === 1,
          generated[0] ? `销售单号=${generated[0].orderNo}` : '未生成');
        if (generated[0]) {
          check('销售单收货方=发起采购的下级经销商',
            generated[0].dealerId === target.dealer_id);
          check('销售单为草稿(待上级审核)', generated[0].status === 'draft',
            `status=${generated[0].status}`);
        }

        const [poAfter] = await tx.select().from(garmentPurchaseOrder)
          .where(eq(garmentPurchaseOrder.id, po.id));
        check('采购单已回填 sourceDocId（防二次镜像的闭环）',
          poAfter.sourceDocId === (generated[0] && generated[0].id),
          `sourceDocId=${poAfter.sourceDocId}`);

        // ---------- E. 防循环 ----------
        console.log('\n[E] 防循环：反向产生的销售单再走正向镜像，必须被幂等拦截');
        if (generated[0]) {
          const so = generated[0];
          await tx.update(salesOrder).set({ status: 'audited' }).where(eq(salesOrder.id, so.id));
          await mirror.mirrorFromSalesOrder(so.id);
          const dupPos = await tx.select().from(garmentPurchaseOrder)
            .where(eq(garmentPurchaseOrder.sourceDocId, so.id));
          check('未重复生成下游采购单', dupPos.length === 1, `命中 ${dupPos.length} 张`);
          const [soAfter] = await tx.select().from(salesOrder).where(eq(salesOrder.id, so.id));
          check('正向镜像识别为已镜像(非新生成)', soAfter.mirrorStatus === 'success',
            `mirrorStatus=${soAfter.mirrorStatus}`);
        }
      }

      throw new Error(SENTINEL);
    });
  } catch (e) {
    if (e.message !== SENTINEL) {
      console.log('\n未预期异常:', e.message);
      console.log(e.stack);
      fail++;
    } else {
      console.log('\n（已按预期回滚，未写入任何数据）');
    }
  }

  console.log(`\n=== 汇总: ${pass} 通过 / ${fail} 失败 ===`);
  await client.end();
  process.exit(fail > 0 ? 1 : 0);
}

main();
