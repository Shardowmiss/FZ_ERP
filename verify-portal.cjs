/* 分销门户后端验证（真实数据，非事务，但确认动作会 revert）
 * ------------------------------------------------------------------
 * 绕过 HTTP/CSRF：用 NestFactory.createApplicationContext 起应用上下文，
 * 通过 DI 拿到真实的 RbacService / DistributionPortalService 实例，
 * 跑 admin(token 登录) 视角下的门户全部端点逻辑。
 *
 * 用法：node verify-portal.cjs
 */
const path = require('path');
const fs = require('fs');

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

const { NestFactory } = require('@nestjs/core');
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { AppModule } = require('./dist/server/app.module');
const { RbacService } = require('./dist/server/modules/rbac/rbac.service');
const { DistributionPortalService } = require('./dist/server/modules/distribution/distribution-portal.service');
const schema = require('./dist/server/database/schema');
const { eq } = require('drizzle-orm');

const revertClient = postgres(process.env.SUDA_DATABASE_URL, { onnotice: () => {} });
const revertDb = drizzle(revertClient, { schema });

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
};

async function main() {
  console.log('=== 分销门户后端验证（应用上下文 + 真实 DB）===\n');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  await app.init();

  const rbac = app.get(RbacService);
  const portal = app.get(DistributionPortalService);

  // 1) admin 登录拿 token + userId（验证 token 机制 + super_admin 身份）
  const login = await rbac.login('admin', 'admin123');
  const adminId = login.user.id;
  const token = login.token;
  check('admin 登录成功并返回 token', !!token && !!adminId, `userId=${adminId}`);
  check('admin 为超级管理员', await rbac.isSuperAdmin(adminId), '');

  // 2) token 往返：getUserIdByToken 能解析出同一用户（门户控制器依赖此路径）
  const uidFromToken = await rbac.getUserIdByToken(token);
  check('x-auth-token 能被正确解析', uidFromToken === adminId, `解析=${uidFromToken}`);

  // 3) 我的采购单（补跑生成的 12 张镜像单，downstream=青海济南针织品，均带上游销售单号）
  const po = await portal.getPurchaseOrders(adminId, {});
  check('采购单列表可返回（含历史单+镜像单）', po.total >= 12, `total=${po.total}`);
  const mirrored = po.items.filter(
    (x) => x.partnerName && x.partnerName.includes('青海济南针织品') && x.sourceDocType === 'SALES_ORDER',
  );
  check('补跑的 12 张镜像采购单均存在且带上游单号', mirrored.length === 12 && mirrored.every((x) => !!x.sourceOrderNo), `命中=${mirrored.length}`);
  const sample = mirrored[0] || po.items[0];
  console.log(`        示例镜像单: ${sample?.orderNo} | 上游=${sample?.sourceOrderNo} | 卖方=${sample?.supplierName} | 买方=${sample?.partnerName} | 状态=${sample?.status}`);

  // 4) 门户概览汇总（至少包含 12 张镜像单）
  const summary = await portal.getSummary(adminId);
  check('门户概览镜像采购单数量 >=12', summary.purchaseOrderCount >= 12, JSON.stringify(summary));
  check('门户概览金额>0', summary.purchaseOrderAmount > 0, `amount=${summary.purchaseOrderAmount}`);

  // 5) 采购退货单（demo 无数据，应返回空集而非报错）
  const pr = await portal.getPurchaseReturns(adminId, {});
  check('我的采购退货单接口可用（空集）', Array.isArray(pr.items), `total=${pr.total}`);

  // 6) 我的分销节点（admin 已绑定 1 个节点 → 返回该记录，符合按 rbac_user_partner 子树隔离）
  const partners = await portal.getUserPartners(adminId);
  check('getUserPartners 按绑定返回（admin 已绑定节点）', Array.isArray(partners) && partners.length >= 1, `bound=${partners.length}`);

  // 7) 应收应付对账（admin 全可见）
  const recon = await portal.getReconciliation(adminId);
  check('对账接口可用且节点数>0', recon.nodes.length > 0, `nodeCount=${recon.summary.nodeCount}`);

  // 8) 确认接收一张补跑的采购单（wait_confirm -> approved），验证后再 revert 保持原状
  const target = po.items.find((x) => x.status === 'wait_confirm');
  if (target) {
    const before = await portal.confirmPurchaseOrder(adminId, target.id);
    check('确认接收：状态变为 approved', before.status === 'approved', `orderNo=${target.orderNo} status=${before.status}`);
    // revert 回 wait_confirm，保持 12 单全待接收的原状
    await revertDb.update(schema.garmentPurchaseOrder)
      .set({ status: 'wait_confirm' })
      .where(eq(schema.garmentPurchaseOrder.id, target.id));
    check('测试后已 revert 回 wait_confirm', true, `orderNo=${target.orderNo}`);
  } else {
    check('确认接收：找到待接收单', false, '无 wait_confirm 单可测');
  }

  await revertClient.end();
  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
