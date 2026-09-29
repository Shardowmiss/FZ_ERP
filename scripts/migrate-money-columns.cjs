// 一次性脚本：将货币 numeric 列改为 bigint(分)。比率列（attach_rate / member_sale_ratio）保留 numeric。
// 仅做 `numeric("col")` -> `bigint("col", { mode: 'number' })` 替换，保留后续 .notNull()/.default() 修饰。
const fs = require('fs');
const path = require('path');

const schemaPath = path.resolve(__dirname, '../server/database/schema.ts');
let src = fs.readFileSync(schemaPath, 'utf8');

// 比率列：保留 numeric（非货币）
const SKIP = new Set(['attach_rate', 'member_sale_ratio']);

// 安全校验：仅允许出现在已知货币列集合中的名字被替换（避免误伤）
const MONEY = new Set([
  'price', 'total_amount', 'sale_amount', 'refund_amount', 'net_amount',
  'total_sales', 'total_refund', 'total_discount', 'net_sales', 'avg_ticket',
  'opening_cash', 'closing_cash', 'cash_expected', 'cash_actual', 'cash_diff',
  'refund_price', 'line_amount', 'amount', 'change_amount', 'change', 'balance',
  'tag_price', 'unit_price', 'discount_amount', 'pay_amount', 'threshold',
  'discount_value', 'min_amount', 'stored_value', 'total_spent', 'cost_price',
]);

const re = /numeric\("([^"]+)"\)/g;
let count = 0;
let skipped = 0;
src = src.replace(re, (full, name) => {
  if (SKIP.has(name)) {
    skipped += 1;
    return full;
  }
  if (!MONEY.has(name)) {
    // 不在货币白名单也不在跳过集合：保护式报错
    throw new Error(`未授权 numeric 列 "${name}"，请人工确认是否为货币列`);
  }
  count += 1;
  return `bigint("${name}", { mode: 'number' })`;
});

// 第二遍：bigint 列的字符串默认值 '0' 改为数字 0（numeric 用字符串默认，bigint 用数字默认）
src = src.split('\n').map((line) => {
  if (line.includes('bigint(') && line.includes(".default('0')")) {
    return line.replace(".default('0')", '.default(0)');
  }
  return line;
}).join('\n');

fs.writeFileSync(schemaPath, src, 'utf8');
console.log(`replaced=${count} skipped=${skipped}`);

// 复检：剩余 numeric 应仅剩比率列两个
const remain = src.match(/numeric\("([^"]+)"\)/g) || [];
console.log('remaining numeric:', remain);
