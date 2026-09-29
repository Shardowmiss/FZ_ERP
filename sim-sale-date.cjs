/**
 * P2-b′：POS → ERP 上行「业务成交日」保真的真实验证（真 PG，真 service 路径）。
 *
 * 被验证的缺陷：normalizeSales 过去用 `saleDate: ... ?? TODAY()` 兜底。
 * "POS 没传日期就用同步当天顶替"——离线开单隔几天再同步，这批零售单在 ERP 里
 * 就全变成同步当天，而我们刚在 Wave 3 给报表加了强制时间窗，这类脏数据会直接
 * 把时间窗口径毒化。且顶替值长得像正常数据，**事后无法区分**、无法回补。
 *
 * 验证三件事：
 *   1. 缺失 saleDate 的 payload 必须被拒（不落库、不顶替）；
 *   2. 带成交日的 payload 必须原样落库成交日（不是同步当天）；
 *   3. 端到端走 controller 同款链路（normalizeSales → receiveSales）后，
 *      retail_order.sale_date === 传入成交日。
 *
 * 为什么必须跑真库：这类缺陷"看起来能跑"——单测不落库就永远发现不了。
 */
const DBS = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const postgres = require('postgres');

const { normalizeSales } = require('./dist/server/modules/pos-receiver/normalize');
const { PosReceiverService } = require('./dist/server/modules/pos-receiver/pos-receiver.service');

// service 注入的是 DRIZZLE_DATABASE（drizzle 实例），直接塞裸 postgres 客户端会
// 报 `this.db.select is not a function`——这正是"看代码以为对、跑起来才炸"的那类坑。
const { drizzle } = require('drizzle-orm/postgres-js');

const log = (...a) => console.log(...a);
let failures = 0;
function check(name, ok, extra = '') {
  log('  %s  %s %s', ok ? 'PASS' : 'FAIL', name, extra);
  if (!ok) failures += 1;
}

const sql = postgres(DBS, { onnotice: () => {} });

const MARK = 'SD';
const MARKSTORE = `${MARK}_ST`;
const MARKSKU = `${MARK}_SKU`;

const TODAY = localDay(0);
/** 本地日历日（东八区），不能用 toISOString——那是 UTC，凌晨会差一天 */
function localDay(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** 一个明确的"过去成交日"，用来证伪"被顶替成同步当天" */
const PAST = localDay(-3);

function tryIt(fn) {
  try {
    return { ok: true, v: fn() };
  } catch (e) {
    return { ok: false, e };
  }
}

async function main() {
  log('=== P2-b′ 上行业务成交日保真（真库端到端）===');
  log('  今天=%s｜模拟成交日=%s（3 天前）', TODAY, PAST);

  // ---------- A) normalizeSales 单函数层 ----------
  log('\n--- A) normalizeSales：缺失/非法 saleDate ---');
  const missing = tryIt(() => normalizeSales({ storeCode: MARKSTORE, orderNo: `NO_${Date.now()}`, items: [] }));
  check('缺失 saleDate 不再静默顶替为同步当天，而是抛错', !missing.ok,
    missing.ok ? '(竟然没报错！仍会写脏数据)' : `BadRequest: ${String(missing.e.message).slice(0, 46)}`);
  check('错误信息指向业务日期（可定位、可提示 POS）',
    !missing.ok && /saleDate/.test(String(missing.e.message)),
    missing.ok ? '' : String(missing.e.message).slice(0, 46));
  check('抛的是 400（能被上层转成 POS 侧 syncStatus=failed 并可重试）',
    !missing.ok && missing.e.status === 400,
    missing.ok ? '' : `status=${missing.e.status}`);

  const bad = tryIt(() => normalizeSales({ storeCode: MARKSTORE, orderNo: 'X', saleDate: '2026/09/01', items: [] }));
  check('非法日期格式被拒（不被 new Date() 吞掉），返回 2026-09-01 之外的拒绝',
    !bad.ok, bad.ok ? '(非法格式被接受了！会是脏数据)' : `BadRequest: ${String(bad.e.message).slice(0, 46)}`);

  const okNorm = tryIt(() => normalizeSales({ storeCode: MARKSTORE, orderNo: `NO_OK${Date.now()}`, saleDate: PAST, items: [] }));
  check('带 saleDate 时原样透传（不改写、不截断成别的值）',
    okNorm.ok && okNorm.v.saleDate === PAST, okNorm.ok ? `saleDate=${okNorm.v.saleDate}` : String(okNorm.e.message));

  const isoNorm = tryIt(() => normalizeSales({ storeCode: MARKSTORE, orderNo: 'NO_ISO', saleDate: `${PAST}T15:30:00.000Z`, items: [] }));
  check('容忍 ISO 时间戳串，截断到日',
    isoNorm.ok && isoNorm.v.saleDate === PAST, isoNorm.ok ? `saleDate=${isoNorm.v.saleDate}` : String(isoNorm.e.message));

  // ---------- B) 端到端落库 ----------
  log('\n--- B) 端到端：POS payload → ERP retail_order.sale_date ---');
  await seedMaster();

  const svc = new PosReceiverService(drizzle(sql));
  const posDocNo = `${MARK}POS${Date.now()}`;
  const payload = {
    storeCode: MARKSTORE,
    orderNo: posDocNo,
    saleDate: PAST,
    totalAmount: 299,
    discountAmount: 0,
    receivableAmount: 299,
    receivedAmount: 299,
    changeAmount: 0,
    cashierName: '模拟收银',
    remark: 'P2-b′ 上行保真验证',
    items: [{ skuCode: MARKSKU, styleNo: MARKSKU, quantity: 1, tagPrice: 299, dealPrice: 299, lineAmount: 299 }],
  };

  const t0 = Date.now();
  const res = await svc.receiveSales(normalizeSales(payload));
  check('上行被接收（没被新增的强校验误挡）', !!res && !!res.erpNo, `erpNo=${res && res.erpNo} (${Date.now() - t0}ms)`);
  check('本次不是幂等命中（确实新建了单据）', !!res && res.duplicated === false, JSON.stringify(res || {}));

  const [row] = await sql`
    select sale_date::text as sale_date, retail_no, store_name, cashier_name,
           total_amount::text as total_amount, item_count, status
    from retail_order where retail_no = ${res.erpNo}
  `;
  check('retail_order.sale_date === 传入的成交日', !!row && row.sale_date === PAST,
    `sale_date=${row ? row.sale_date : '(无行)'} 期望=${PAST}`);
  check('sale_date !== 今天（证明没有退化成 TODAY() 兜底）', !!row && row.sale_date !== TODAY, `today=${TODAY}`);

  const [itm] = await sql`
    select sku_code, quantity::text as qty, deal_price::text as deal_price, line_amount::text as line_amount
    from retail_order_item where retail_id = (select id from retail_order where retail_no = ${res.erpNo})
  `;
  check('明细行也正确落库（sku_code 非空）', !!itm && itm.sku_code === MARKSKU, JSON.stringify(itm || {}));

  // ---------- C) 缺失场景：必须"落库 0 行" ----------
  log('\n--- C) 缺失 saleDate 的 payload 不能产生任何单据 ---');
  const before = await countRows();
  // 按 controller 的真实写法：normalizeSales 是**同步**的，异常在进 service 之前就抛出，
  // 因此不可能产生"半落库/脏日期"的中间态。写成 async 箭头函数反而会把同步 throw
  // 吞成 rejected promise，让异常从 tryIt 漏出去——这是本脚本踩到的第 3 个坑。
  let chainErr = null;
  try {
    await svc.receiveSales(normalizeSales({
      storeCode: MARKSTORE,
      orderNo: `${MARK}BAD${Date.now()}`,
      items: [],
    }));
  } catch (e) {
    chainErr = e;
  }
  const after = await countRows();
  check('整条链路拒绝（异常向外抛出，不是静默吞掉）', !!chainErr,
    chainErr ? `status=${chainErr.status} ${String(chainErr.message).slice(0, 40)}` : '(竟然放行！脏数据已入库)');
  check('retail_order 行数未增加（拒绝发生在落库之前）', after === before, `before=${before} after=${after}`);

  const [logLeft] = await sql`select count(*)::int as c from pos_receive_log where pos_doc_no like ${MARK + 'BAD%'}`;
  check('幂等日志无 pending 残留（没有留下"半张单据"）', logLeft.c === 0, `pos_receive_log=${logLeft.c}`);

  await cleanup(res.erpNo);
}

async function countRows() {
  const [r] = await sql`select count(*)::int as c from retail_order`;
  return r.c;
}

/**
 * 造一条可用的主数据链。
 * 门店走 pos_store_map（映射 POS 编码→ERP 门店），这是 resolveStore 的**第一优先级**
 * 分支，也是真实环境配置 POS 门店映射的方式；直接改 store.code 会污染主数据。
 * style 复用库里已有的（重建代价高，且与本验证无关）。
 */
async function seedMaster() {
  const [s] = await sql`select id, name from store where code like 'ST-D01%' order by code limit 1`;
  if (!s) throw new Error('找不到可复用的 ERP 门店');
  await sql`
    insert into pos_store_map (store_code, store_id, store_name)
    values (${MARKSTORE}, ${s.id}, ${s.name})
    on conflict (store_code) do update set store_id = excluded.store_id, store_name = excluded.store_name
  `;

  await sql`
    insert into sku (sku_code, style_id, style_no, color, size)
    values (${MARKSKU}, (select id from style order by style_no limit 1), ${MARKSKU}, '黑色', '均码')
    on conflict (sku_code) do nothing
  `;
  const [cnt] = await sql`select count(*)::int as c from sku where sku_code = ${MARKSKU}`;
  if (!cnt.c) throw new Error('造 sku 失败：既没插入也没查到');
  log('  主数据就绪：pos_store_map[%s→%s] sku=%s', MARKSTORE, s.name, MARKSKU);
}

async function cleanup(erpNo) {
  await sql`delete from retail_order_item where retail_id in (select id from retail_order where retail_no = ${erpNo})`;
  await sql`delete from retail_order where retail_no = ${erpNo}`;
  await sql`delete from pos_receive_log where pos_doc_no like ${MARK + 'POS%'}`;
  await sql`delete from pos_store_map where store_code = ${MARKSTORE}`;
  const [left] = await sql`select
      (select count(*)::int from retail_order where retail_no = ${erpNo}) as o,
      (select count(*)::int from pos_receive_log where pos_doc_no like ${MARK + 'POS%'}) as l,
      (select count(*)::int from pos_store_map where store_code = ${MARKSTORE}) as m`;
  check('脏数据清理干净', left.o === 0 && left.l === 0 && left.m === 0,
    `retail_order=${left.o} pos_receive_log=${left.l} pos_store_map=${left.m}`);
}

main()
  .then(() => {
    log('\n===== %s =====', failures === 0 ? 'SALE_DATE_PASS' : `SALE_DATE_FAIL(${failures})`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error('\n!! 脚本异常：', e && e.stack ? e.stack : e);
    process.exit(2);
  });
