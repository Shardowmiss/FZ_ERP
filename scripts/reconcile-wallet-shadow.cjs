// S3 shadow 期双跑对账脚本
// ---------------------------------------------------------------------------
// 背景：S3 让 ERP 成为会员钱包唯一账本方，POS 侧通过 pos_wallet_event 出箱上行。
//       上线初期走 shadow 模式（POS 本地照旧改余额 + 同时上报 ERP）。本脚本在
//       shadow 期内定期运行，比对两端账本，确认「POS 产出的每一笔都正确落到 ERP」，
//       无差异后再切 POS_WALLET_UPSTREAM=strict。
//
// 比对维度：
//   ① event_key 连接 —— 抓「已产未达 / 值不一致 / 孤儿」
//   ② 按 erp_member_id 汇总增量 —— 抓「余额漂移」（POS 已推送增量 vs ERP 已入账增量）
//
// 用法：
//   node scripts/reconcile-wallet-shadow.cjs                 # 全量比对，输出可读报告
//   node scripts/reconcile-wallet-shadow.cjs --since=2026-10-01   # 只看该日之后的增量
//   node scripts/reconcile-wallet-shadow.cjs --json         # 机器可读输出（接监控）
//   node scripts/reconcile-wallet-shadow.cjs --selftest     # 不连库，验证核心逻辑
//
// 退出码：0 = 无致命差异；1 = 存在致命差异（已产未达 / 值不一致），可接 CI / 告警。
//
// ⚠ 只读脚本：只 SELECT，不写任何数据。
const pg = require('postgres');

const POS_URL = process.env.POS_DATABASE_URL || 'postgres://erp:erp@localhost:5434/pos_db';
const ERP_URL = process.env.ERP_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';

// ---------- 核心逻辑（纯函数，便于 --selftest） ----------

// 按 event_key 连接两端，分类差异
function reconcile(posRows, erpRows) {
  const erpByKey = new Map();
  for (const r of erpRows) erpByKey.set(r.event_key, r);
  const posByKey = new Map();
  for (const r of posRows) posByKey.set(r.event_key, r);

  const missing = []; // POS 标记 sent 但 ERP 无 → 推送失败 / 401 被拒（致命）
  const pending = []; // POS pending/failed 但 ERP 无 → 预期积压（待补推）
  const skipped = []; // POS skipped（缺锚点）ERP 无 → 预期
  const valueMismatch = []; // 双方都有但 change_value / kind 不一致（致命）
  const orphan = []; // ERP 有 POS 无 → 异常（ERP 只应接收 POS 上行）

  for (const p of posRows) {
    const e = erpByKey.get(p.event_key);
    if (!e) {
      if (p.status === 'sent') missing.push(p);
      else if (p.status === 'skipped') skipped.push(p);
      else pending.push(p); // pending | failed
      continue;
    }
    if (String(e.change_value) !== String(p.change_value) || e.kind !== p.kind) {
      valueMismatch.push({ pos: p, erp: e });
    }
  }
  for (const e of erpRows) {
    if (!posByKey.has(e.event_key)) orphan.push(e);
  }
  return { missing, pending, skipped, valueMismatch, orphan };
}

// 按 erp_member_id 汇总增量，抓余额漂移
// posRows 用 erp_member_id 定位 ERP 会员；erpRows 用 member_id（=ERP 主键）
function balanceDrift(posRows, erpRows) {
  const posDelta = new Map();
  for (const p of posRows) {
    if (!p.erp_member_id || p.status !== 'sent') continue;
    const k = p.erp_member_id;
    if (!posDelta.has(k)) posDelta.set(k, { points: 0, stored_value: 0 });
    const d = posDelta.get(k);
    if (p.kind === 'points') d.points += Number(p.change_value);
    else if (p.kind === 'stored_value') d.stored_value += Number(p.change_value);
  }
  const erpDelta = new Map();
  for (const e of erpRows) {
    const k = e.member_id;
    if (!erpDelta.has(k)) erpDelta.set(k, { points: 0, stored_value: 0 });
    const d = erpDelta.get(k);
    if (e.kind === 'points') d.points += Number(e.change_value);
    else if (e.kind === 'stored_value') d.stored_value += Number(e.change_value);
  }
  const drift = [];
  // 只对「两端都出现」的会员比对：纯隔离「值变换算 bug」。
  // 仅 POS 侧有（ERP 缺失）的会员由 reconcile().missing 覆盖，避免同一笔差异在两处重复报。
  for (const [k, pd] of posDelta) {
    const ed = erpDelta.get(k);
    if (!ed) continue;
    if (pd.points !== ed.points || pd.stored_value !== ed.stored_value) {
      drift.push({ erpMemberId: k, pos: pd, erp: ed });
    }
  }
  return drift;
}

// ---------- 数据加载（只读） ----------

async function loadPos(sql, since) {
  const where = since ? sql`WHERE _created_at >= ${since}::timestamptz` : sql``;
  return sql`
    SELECT event_key, member_id, erp_member_id, kind, change_value,
           source_type, source_no, store_id, status
    FROM pos_wallet_event
    ${where}
    ORDER BY event_key
  `;
}

async function loadErp(sql, since) {
  const where = since ? sql`WHERE _created_at >= ${since}::timestamptz` : sql``;
  return sql`
    SELECT event_key, member_id, kind, change_value, source_type, source_no,
           store_code, status
    FROM member_wallet_event
    ${where}
    ORDER BY event_key
  `;
}

// ---------- 报告 ----------

function renderReport(rec, drift, counts) {
  const lines = [];
  lines.push('=== S3 shadow 对账报告 ===');
  lines.push(`POS 出箱行数: ${counts.pos}    ERP 账本行数: ${counts.erp}`);
  lines.push('');
  lines.push(`[致命] 已产未达 (POS sent 但 ERP 无):   ${rec.missing.length}`);
  lines.push(`[警告] 待补推积压 (POS pending/failed): ${rec.pending.length}`);
  lines.push(`[信息] 缺锚点跳过 (POS skipped):        ${rec.skipped.length}`);
  lines.push(`[致命] 值不一致 (同 key 不同值):        ${rec.valueMismatch.length}`);
  lines.push(`[异常] ERP 孤儿 (ERP 有 POS 无):        ${rec.orphan.length}`);
  lines.push(`[致命] 余额漂移 (按会员增量不等):       ${drift.length}`);
  lines.push('');

  if (rec.missing.length) {
    lines.push('--- 已产未达（需立即排查推送链路）---');
    for (const m of rec.missing.slice(0, 20)) {
      lines.push(`  ${m.event_key}  kind=${m.kind} delta=${m.change_value} store=${m.store_id}`);
    }
    if (rec.missing.length > 20) lines.push(`  ... 其余 ${rec.missing.length - 20} 条`);
  }
  if (rec.valueMismatch.length) {
    lines.push('--- 值不一致 ---');
    for (const v of rec.valueMismatch.slice(0, 20)) {
      lines.push(`  ${v.pos.event_key}  POS(${v.pos.kind}/${v.pos.change_value}) vs ERP(${v.erp.kind}/${v.erp.change_value})`);
    }
  }
  if (drift.length) {
    lines.push('--- 余额漂移 ---');
    for (const d of drift.slice(0, 20)) {
      lines.push(`  erpMember=${d.erpMemberId}  POS(pts=${d.pos.points},sv=${d.pos.stored_value}) ERP(pts=${d.erp.points},sv=${d.erp.stored_value})`);
    }
  }
  if (rec.pending.length) {
    lines.push(`--- 待补推积压 (前 10) ---`);
    for (const p of rec.pending.slice(0, 10)) {
      lines.push(`  ${p.event_key}  status=${p.status} attempt`);
    }
  }
  return lines.join('\n');
}

// ---------- 入口 ----------

async function main() {
  const asJson = process.argv.includes('--json');
  const sinceArg = process.argv.find((a) => a.startsWith('--since='));
  const since = sinceArg ? sinceArg.slice('--since='.length) : null;
  const selfTest = process.argv.includes('--selftest');

  if (selfTest) return runSelfTest();

  const posSql = pg(POS_URL, { max: 1, onnotice: () => {} });
  const erpSql = pg(ERP_URL, { max: 1, onnotice: () => {} });
  try {
    const [posRows, erpRows] = await Promise.all([loadPos(posSql, since), loadErp(erpSql, since)]);
    const rec = reconcile(posRows, erpRows);
    const drift = balanceDrift(posRows, erpRows);
    const counts = { pos: posRows.length, erp: erpRows.length };

    if (asJson) {
      console.log(JSON.stringify({ counts, rec, drift }, null, 2));
    } else {
      console.log(renderReport(rec, drift, counts));
    }

    const fatal = rec.missing.length > 0 || rec.valueMismatch.length > 0 || drift.length > 0;
    process.exitCode = fatal ? 1 : 0;
  } finally {
    await Promise.all([posSql.end({ timeout: 5 }), erpSql.end({ timeout: 5 })]);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('SELFTEST FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

function runSelfTest() {
  console.log('running --selftest (no DB)...');
  // 场景：两笔正常（POS sent 且 ERP 有对应），一笔已产未达，一笔值不一致，一笔积压，一笔缺锚点跳过，一笔 ERP 孤儿
  const pos = [
    { event_key: 'sale:A:points', member_id: 'p1', erp_member_id: 'e1', kind: 'points', change_value: 10, source_type: 'sale', source_no: 'A', store_id: 'S1', status: 'sent' },
    { event_key: 'sale:B:stored_value', member_id: 'p2', erp_member_id: 'e2', kind: 'stored_value', change_value: -500, source_type: 'sale', source_no: 'B', store_id: 'S1', status: 'sent' },
    { event_key: 'sale:C:points', member_id: 'p3', erp_member_id: 'e3', kind: 'points', change_value: 7, source_type: 'sale', source_no: 'C', store_id: 'S1', status: 'sent' }, // 已产未达
    { event_key: 'sale:D:points', member_id: 'p4', erp_member_id: 'e4', kind: 'points', change_value: 5, source_type: 'sale', source_no: 'D', store_id: 'S1', status: 'pending' }, // 积压
    { event_key: 'sale:E:points', member_id: 'p5', erp_member_id: null, kind: 'points', change_value: 3, source_type: 'sale', source_no: 'E', store_id: 'S1', status: 'skipped' }, // 缺锚点
    { event_key: 'sale:F:points', member_id: 'p6', erp_member_id: 'e6', kind: 'points', change_value: 9, source_type: 'sale', source_no: 'F', store_id: 'S1', status: 'sent' }, // ERP 里值不一致
  ];
  const erp = [
    { event_key: 'sale:A:points', member_id: 'e1', kind: 'points', change_value: 10, source_type: 'sale', source_no: 'A', store_code: 'S1', status: 'applied' },
    { event_key: 'sale:B:stored_value', member_id: 'e2', kind: 'stored_value', change_value: -500, source_type: 'sale', source_no: 'B', store_code: 'S1', status: 'applied' },
    { event_key: 'sale:F:points', member_id: 'e6', kind: 'points', change_value: 99, source_type: 'sale', source_no: 'F', store_code: 'S1', status: 'applied' }, // 值不一致
    { event_key: 'sale:Z:points', member_id: 'e9', kind: 'points', change_value: 1, source_type: 'sale', source_no: 'Z', store_code: 'S1', status: 'applied' }, // 孤儿
  ];

  const rec = reconcile(pos, erp);
  assert(rec.missing.length === 1 && rec.missing[0].event_key === 'sale:C:points', 'missing 应只含 sale:C');
  assert(rec.pending.length === 1 && rec.pending[0].event_key === 'sale:D:points', 'pending 应只含 sale:D');
  assert(rec.skipped.length === 1 && rec.skipped[0].event_key === 'sale:E:points', 'skipped 应只含 sale:E');
  assert(rec.valueMismatch.length === 1 && rec.valueMismatch[0].pos.event_key === 'sale:F:points', 'valueMismatch 应只含 sale:F');
  assert(rec.orphan.length === 1 && rec.orphan[0].event_key === 'sale:Z:points', 'orphan 应只含 sale:Z');

  const drift = balanceDrift(pos, erp);
  // e1: POS +10 / ERP +10 → 平衡；e6: POS +9 / ERP +99 → 漂移
  assert(drift.length === 1 && drift[0].erpMemberId === 'e6', 'balanceDrift 应只标 e6');
  assert(drift[0].pos.points === 9 && drift[0].erp.points === 99, 'drift 数值应正确');

  console.log('SELFTEST PASS: reconcile + balanceDrift 逻辑正确');
  process.exitCode = 0;
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
