/**
 * P1 · member 品牌级全局下的 PII 脱敏 · 黑盒验证（真实 DB）
 *
 * 三层验证：
 *   Part A 静态守卫：member.service.ts 必须 import maskMemberPii 并在 list/create/update 三处应用
 *   Part B 单元级：maskPhone / maskMemberPii 行为（超管不脱敏、受限脱敏）
 *   Part C 集成验证：驱动 MemberService.list（真实 DB 种子），
 *           受限作用域下手机号/生日脱敏，超管作用域原样返回
 *
 * 运行：node sim-member-pii.cjs   （需 dev/postgres 在 localhost:5434）
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');
const { randomUUID } = require('crypto');
const { drizzle } = require('drizzle-orm/postgres-js');

const { MemberService } = require('./dist/server/modules/member/member.service.js');
const { RequestContext } = require('./dist/server/common/context/request-context.js');
const { maskPhone, maskMemberPii, isRestrictedScope } = require('./dist/server/common/data-scope/pii.js');
const S = require('./dist/server/database/schema.js');

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const client = postgres(CONN, { max: 1 });
const db = drizzle(client, { schema: S });

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const MEMBER_FILE = 'server/modules/member/member.service.ts';

async function seedMember() {
  const id = randomUUID();
  const no = 'M' + id.replace(/-/g, '').slice(0, 12);
  await client`INSERT INTO member (id, member_no, name, phone, birthday, gender, level, status)
    VALUES (${id}, ${no}, ${'测试会员'}, ${'13812345678'}, ${'1990-05-20'}, ${'male'}, ${'normal'}, ${'active'})`;
  return id;
}
async function cleanupMember(id) {
  if (id) await client`DELETE FROM member WHERE id = ${id}`;
}

async function run() {
  // ---------- Part A 静态守卫 ----------
  console.log('\n[Part A] 静态守卫：member.service.ts 必须 import maskMemberPii 并在 list/create/update 应用');
  const txt = fs.readFileSync(path.join(__dirname, MEMBER_FILE), 'utf8');
  const hasImport = /from '@server\/common\/data-scope\/pii'/.test(txt) && /maskMemberPii/.test(txt);
  assert('import + 引用齐全', hasImport, { hasImport });
  assert('list 应用脱敏 (.map maskMemberPii)', /\.map\(\(r\) => maskMemberPii\(r\)\)/.test(txt));
  assert('create 应用脱敏 (maskMemberPii(row', /maskMemberPii\(row as unknown as Member\)/.test(txt));
  assert('update 应用脱敏 (maskMemberPii(row', (txt.match(/maskMemberPii\(row as unknown as Member\)/g) || []).length >= 2);

  // ---------- Part B 单元级 ----------
  console.log('\n[Part B] 单元级：maskPhone / maskMemberPii');
  assert('maskPhone 正常号脱敏', maskPhone('13812345678') === '138****5678', maskPhone('13812345678'));
  assert('maskPhone null 原样', maskPhone(null) === null);
  assert('maskPhone 短号兜底', maskPhone('123') === '****');
  assert('isRestrictedScope 超管=false', isRestrictedScope() === false);
  // 受限作用域下 maskMemberPii 脱敏
  const row = { phone: '13812345678', birthday: '1990-05-20' };
  const masked = RequestContext.run({ dealerScope: { type: 'dealer', dealerIds: [randomUUID()] } }, () => maskMemberPii(row));
  assert('受限作用域脱敏 phone', masked.phone === '138****5678', masked.phone);
  assert('受限作用域脱敏 birthday', masked.birthday === '****-**-**', masked.birthday);
  // 超管作用域下不脱敏
  const plain = RequestContext.run({ dealerScope: { type: 'all', dealerIds: [] } }, () => maskMemberPii(row));
  assert('超管作用域不脱敏 phone', plain.phone === '13812345678', plain.phone);
  assert('超管作用域不脱敏 birthday', plain.birthday === '1990-05-20', plain.birthday);

  // ---------- Part C 集成验证 ----------
  console.log('\n[Part C] 集成验证：MemberService.list 受限 vs 超管');
  const svc = new MemberService(db, {});
  const mid = await seedMember();

  // 超管作用域：原样返回
  const allRes = await RequestContext.run({ dealerScope: { type: 'all', dealerIds: [] } }, () => svc.list({}));
  const allRow = allRes.list.find((m) => m.id === mid);
  assert('超管 list 含种子会员', !!allRow);
  assert('超管 list 手机号未脱敏', allRow && allRow.phone === '13812345678', allRow && allRow.phone);
  assert('超管 list 生日未脱敏', allRow && allRow.birthday === '1990-05-20', allRow && allRow.birthday);

  // 受限作用域：脱敏
  const resRes = await RequestContext.run({ dealerScope: { type: 'dealer', dealerIds: [randomUUID()] } }, () => svc.list({}));
  const resRow = resRes.list.find((m) => m.id === mid);
  assert('受限 list 含种子会员', !!resRow);
  assert('受限 list 手机号已脱敏', resRow && resRow.phone === '138****5678', resRow && resRow.phone);
  assert('受限 list 生日已脱敏', resRow && resRow.birthday === '****-**-**', resRow && resRow.birthday);

  await cleanupMember(mid);

  console.log(`\n========== 结果：通过 ${pass}，失败 ${fail} ==========`);
  await client.end({ timeout: 2 });
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error('运行异常:', e); process.exit(1); });
