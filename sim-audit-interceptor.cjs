/**
 * 审计拦截器端到端验证（真实 DB）。
 * 直接驱动编译后的 AuditInterceptor + OperationLogService，
 * 验证：写操作自动落库、字段提取(userId/module/objectId)、GET 不记录、error 路径、不阻塞。
 */
const URL = process.env.SUDA_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { of } = require('rxjs');

const { OperationLogService } = require('./dist/server/modules/system/operation-log/operation-log.service');
const { AuditInterceptor } = require('./dist/server/common/interceptors/audit.interceptor');

const sql = postgres(URL);
const db = drizzle(sql);
const opLog = new OperationLogService(db);
const interceptor = new AuditInterceptor(opLog, { get: () => undefined });

let failures = 0;
const log = (...a) => console.log(...a);

function mkCtx(method, url, body, statusCode = 200, user = { id: 'u_audit_test' }) {
  const req = { method, url, user, headers: { 'user-agent': 'sim-agent' }, ip: '10.0.0.1' };
  const res = { statusCode };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => () => {},
  };
}

async function run() {
  // 1) success mutation → 应记录 create + 提取 objectId
  await new Promise((resolve) => {
    const next = { handle: () => of({ id: 'obj_audit_1', orderNo: 'SO202609220001' }) };
    interceptor.intercept(mkCtx('POST', '/api/sales/orders'), next).subscribe({ complete: resolve });
  });

  // 2) GET 不应记录
  await new Promise((resolve) => {
    const next = { handle: () => of({ items: [] }) };
    interceptor.intercept(mkCtx('GET', '/api/sales/orders'), next).subscribe({ complete: resolve });
  });

  // 3) error mutation → 记录 _error
  await new Promise((resolve) => {
    const { throwError } = require('rxjs');
    const next = { handle: () => throwError(() => ({ status: 400, message: 'bad request' })) };
    interceptor.intercept(mkCtx('PUT', '/api/sales/orders/x'), next).subscribe({
      error: resolve,
      complete: resolve,
    });
  });

  await new Promise((r) => setTimeout(r, 400)); // 等异步 fire 落库

  const rows = await sql`
    select module, operation_type, object_id, user_id, summary
    from system_operation_log
    where user_id = 'u_audit_test' or object_id = 'obj_audit_1'
    order by operation_time desc limit 10`;

  const byId = rows.find((r) => r.object_id === 'obj_audit_1');
  const errRow = rows.find((r) => (r.operation_type || '').endsWith('_error'));

  log('[1] success 落库?=', !!byId, byId ? JSON.stringify(byId) : '');
  if (!byId) failures += 1;
  if (byId && byId.module !== 'sales') { failures += 1; log('  module 期望 sales 实际', byId.module); }
  if (byId && byId.user_id !== 'u_audit_test') { failures += 1; log('  user_id 期望 u_audit_test'); }

  log('[2] GET 未产生业务记录?=', !rows.find((r) => r.summary && r.summary.startsWith('GET')));

  log('[3] error 落库?=', !!errRow, errRow ? JSON.stringify(errRow) : '');
  if (!errRow) failures += 1;

  log(failures === 0 ? 'AUDIT_INTERCEPTOR_PASS' : `AUDIT_INTERCEPTOR_FAIL(count=${failures})`);
  await sql.end();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(2); });
