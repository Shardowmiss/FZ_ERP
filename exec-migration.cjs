/** 在 dev 库执行单个迁移 SQL 文件（整文件作为单条脚本）。 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const file = process.argv[2];
if (!file) { console.error('usage: node exec-migration.cjs <sql-file>'); process.exit(1); }
const sqlPath = path.isAbsolute(file) ? file : path.join(__dirname, file);
const content = fs.readFileSync(sqlPath, 'utf8');

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const sql = postgres(CONN, { max: 1 });

(async () => {
  console.log(`执行迁移: ${sqlPath}`);
  await sql.unsafe(content);
  console.log('迁移执行成功（无报错）。');
  await sql.end();
})().catch((e) => {
  console.error('迁移执行失败：', String(e.message).split('\n')[0]);
  console.error(e);
  process.exit(1);
});
