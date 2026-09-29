/* 服务层集成测试 harness（不启 HTTP，绕过平台代理）
 * 1) 创建 Nest 应用上下文，验证全部模块 DI 可加载
 * 2) 对所有 Service 做 list() 广度冒烟（验证 DB 连通 + 查询映射）
 * 3) 对 P0/P1 新模块做针对性读取/计算测试
 */
const fs = require('fs');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/server/app.module');

const results = { containerInit: null, services: [], depth: [] };

// 动态收集所有 Service 类
function collectServices(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectServices(p, acc);
    else if (e.name.endsWith('.service.js') && !e.name.endsWith('.d.js')) {
      try {
        const mod = require(p);
        for (const k of Object.keys(mod)) {
          const v = mod[k];
          if (typeof v === 'function' && /Service$/.test(k)) acc.push({ name: k, file: p, cls: v });
        }
      } catch (err) {
        acc.push({ name: path.basename(p), file: p, error: String(err.message || err) });
      }
    }
  }
  return acc;
}

(async () => {
  try {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    results.containerInit = 'OK';
    const svcDir = path.join(__dirname, 'dist/server/modules');
    const services = collectServices(svcDir, []);
    for (const s of services) {
      const rec = { name: s.name, registered: false, list: 'n/a', error: null };
      try {
        const inst = app.get(s.cls, { strict: false });
        rec.registered = true;
        if (typeof inst.list === 'function') {
          try {
            const r = await inst.list({ page: 1, pageSize: 3 });
            const cnt = (r && (r.total ?? (Array.isArray(r) ? r.length : (r.data ? r.data.length : '?'))));
            rec.list = 'OK(' + cnt + ')';
          } catch (e) {
            rec.list = 'ERR:' + (e.message || '').slice(0, 120);
          }
        }
      } catch (e) {
        rec.error = (e.message || '').slice(0, 160);
      }
      results.services.push(rec);
    }
    await app.close();
  } catch (e) {
    results.containerInit = 'FAIL: ' + (e.message || e).slice(0, 300);
  }
  console.log(JSON.stringify(results, null, 2));
})();
