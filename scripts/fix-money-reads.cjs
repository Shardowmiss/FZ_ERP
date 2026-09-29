// 读侧货币列转换：Number(row.X) / Number(r.X) -> fromCents(row.X)
// 仅对 MONEY 集合生效，排除 count/qty/attachRate/memberSaleRatio/orders/sales 等非货币列。
const fs = require('fs');
const path = require('path');

const MONEY = new Set([
  'amount', 'avgTicket', 'balance', 'cashActual', 'cashDiff', 'cashExpected',
  'change', 'changeAmount', 'closingCash', 'costPrice', 'discountAmount',
  'discountValue', 'lineAmount', 'minAmount', 'netAmount', 'netSales',
  'openingCash', 'payAmount', 'price', 'refundAmount', 'refundPrice',
  'saleAmount', 'salesAmount', 'storedValue', 'tagPrice', 'threshold',
  'totalAmount', 'totalDiscount', 'totalRefund', 'totalSales', 'totalSpent',
  'unitPrice',
]);

const root = path.resolve(__dirname, '../server/modules');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.service.ts')) files.push(p);
  }
})(root);

let total = 0;
for (const f of files) {
  let src = fs.readFileSync(f, 'utf8');
  let changed = false;
  for (const field of MONEY) {
    const re = new RegExp(`Number\\(\\s*(row|r)\\.${field}\\s*\\)`, 'g');
    const m = src.match(re);
    if (m) {
      src = src.replace(re, `fromCents($1.${field})`);
      changed = true;
      total += m.length;
    }
  }
  if (changed) {
    if (!/fromCents/.test(src)) {
      const moneyImportRe = /import\s*\{([^}]*)\}\s*from\s*'@server\/database\/money'/;
      if (moneyImportRe.test(src)) {
        src = src.replace(moneyImportRe, (full, names) => {
          const list = names.split(',').map((s) => s.trim()).filter(Boolean);
          if (!list.includes('fromCents')) list.push('fromCents');
          return `import { ${list.join(', ')} } from '@server/database/money'`;
        });
      } else {
        const idx = src.indexOf('\n');
        src = src.slice(0, idx + 1) +
          "import { fromCents } from '@server/database/money';\n" + src.slice(idx + 1);
      }
    }
    fs.writeFileSync(f, src, 'utf8');
    console.log(`updated ${path.relative(root, f)}`);
  }
}
console.log(`TOTAL fromCents replacements = ${total}`);
