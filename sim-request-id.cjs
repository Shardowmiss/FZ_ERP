/**
 * Wave 4-A② 验证脚本：结构化日志 + request-id 贯穿（ERP 侧）。
 *
 * 与 A① 一样坚持「真验证」：中间件走**真实 express + 真实 HTTP 请求**（不是假 req/res 桩），
 * 异常过滤器走真实调用路径，日志输出捕获真实 stdout/stderr 行后逐条断言。
 *
 * 用法：node sim-request-id.cjs
 * 通过判定：REQUEST_ID_PASS
 */
'use strict';

// 必须在 logger 模块加载前设置：SLOW_MS 是模块级常量，晚于加载再改环境变量无效。
// 调小阈值是为了在毫秒级的测试里也能验证 slow 标注。
process.env.LOG_SLOW_MS = '50';
// C/D 段断言的是「日志平台实际消费的格式」，即生产模式 JSON 行。
process.env.NODE_ENV = 'production';

const path = require('path');
const http = require('http');
const express = require('express');

const DIST = path.join(__dirname, 'dist/server');
const { requestLogMiddleware } = require(path.join(DIST, 'middleware/request-log.middleware'));
const { RequestContext } = require(path.join(DIST, 'common/context/request-context'));
const logger = require(path.join(DIST, 'common/logging/logger'));
const { GlobalExceptionFilter } = require(path.join(DIST, 'common/filters/exception.filter'));

// ---------- 断言框架 ----------
let PASS = 0;
let FAIL = 0;
const log = (...a) => console.log(...a);

function check(name, ok, detail = '') {
  if (ok) {
    PASS++;
    log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    FAIL++;
    log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * 捕获结构化日志输出（logger 直接写 process.stdout/stderr）。
 * 关键：捕获的同时**原样透传**——否则断言自身的打印也会被吞掉，脚本变成「静默失败」。
 */
let CAPTURED = [];
let CAPTURING = false;
const origOut = process.stdout.write.bind(process.stdout);
const origErr = process.stderr.write.bind(process.stderr);
process.stdout.write = (chunk, ...rest) => {
  if (CAPTURING) CAPTURED.push(String(chunk));
  return origOut(chunk, ...rest);
};
process.stderr.write = (chunk, ...rest) => {
  if (CAPTURING) CAPTURED.push(String(chunk));
  return origErr(chunk, ...rest);
};

/**
 * 取出最近捕获到的记录并解析（生产模式是 JSON 行）。
 * `keepOn=false` 用于「读取断言自身打印」的场景，避免把脚本输出误当成日志行解析。
 */
function drain(keepOn = true) {
  const was = CAPTURING;
  CAPTURING = false;
  const lines = CAPTURED.map((s) => s.trim()).filter(Boolean);
  CAPTURING = keepOn ? was : false;
  CAPTURED = [];
  return lines;
}
function drainJson() {
  return drain().map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { raw: l };
    }
  });
}

// ---------- B 段前置：贯穿上下文语义 ----------
function ctxSemantics() {
  log('\n【B 段】RequestContext 贯穿语义（AsyncLocalStorage）');

  let insideId = null;
  const outsideId = RequestContext.getRequestId();
  RequestContext.run({ requestId: 'rid-test-1', method: 'GET', path: '/api/x' }, () => {
    insideId = RequestContext.getRequestId();
  });
  check('run 内可读到 requestId', insideId === 'rid-test-1', String(insideId));
  check('run 外读不到（作用域隔离，不泄漏到上一帧）', outsideId === undefined, String(outsideId));

  // patch 合并：模拟「中间件已开 ALS → 拦截器补字段」不能丢掉 requestId
  let patched = null;
  let afterPatch = null;
  RequestContext.run({ requestId: 'rid-test-2', traceId: 'trace-A' }, () => {
    RequestContext.patch({ userId: 'u-1' });
    patched = { rid: RequestContext.getRequestId(), trace: RequestContext.getTraceId(), uid: RequestContext.getUserId() };
  });
  RequestContext.run({ requestId: 'rid-test-3' }, () => {
    // 外层 patch 不应污染同级的另一个作用域
    afterPatch = RequestContext.getRequestId();
  });
  check('patch 补写后 requestId 不丢（链路不断裂）', patched && patched.rid === 'rid-test-2', JSON.stringify(patched));
  check('patch 同时保留 traceId 与新写入 userId', patched && patched.trace === 'trace-A' && patched.uid === 'u-1', JSON.stringify(patched));
  check('patch 不越界污染同级作用域', afterPatch === 'rid-test-3', String(afterPatch));

  let threw = null;
  try {
    RequestContext.patch({ userId: 'x' }); // 非请求上下文
  } catch (e) {
    threw = e;
  }
  check('非请求上下文调用 patch 静默忽略（脚本/定时任务安全）', threw === null, threw ? String(threw.message) : '');
}

// ---------- C 段：真实 express + 真实 HTTP ----------
function runHttpSuite() {
  return new Promise((resolve) => {
    log('\n【C 段】中间件 × 真实 express × 真实 HTTP');

    const app = express();
    app.use(requestLogMiddleware);

    app.get('/api/ok', (req, res) => res.json({ ok: true }));
    app.get('/api/boom', (req, res) => {
      // 触发 5xx：express 默认错误处理会返回 500
      throw new Error('boom-for-log-test');
    });
    // 供「客户端提前断开」用例使用：服务端故意挂住，让客户端在响应完成前 destroy
    app.get('/api/hang', (req, res) => {
      setTimeout(() => res.json({ ok: true }), 400);
    });
    app.get('/api/assets-like.css', (req, res) => res.type('css').send('body{}'));
    // 错误中间件：把异常摘要交给访问日志（生产环境该职责由 Nest 的 GlobalExceptionFilter 承担）
    app.use((err, req, res, next) => {
      res.locals = res.locals || {};
      res.locals.lastError = err && err.message ? err.message : String(err);
      next(err);
    });

    const server = http.createServer(app);

    function req(opts) {
      return new Promise((resolveReq) => {
        const r = http.request({ host: '127.0.0.1', port: PORT, path: opts.path, method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolveReq({ status: res.statusCode, headers: res.headers, body }));
        });
        if (opts.abort) {
          r.on('error', () => resolveReq({ status: 0, headers: {}, body: '', aborted: true }));
          r.end();
          setTimeout(() => r.destroy(), 30);
        } else {
          r.end();
        }
      });
    }

    server.listen(0, '127.0.0.1', async () => {
      PORT = server.address().port;
      try {
        // 1) 无 requestId：服务端自造并回写
        let res = await req({ path: '/api/ok' });
        const selfId = res.headers['x-request-id'];
        check('无 requestId 时服务端自造并回写响应头', /^[0-9a-f-]{36}$/.test(selfId || ''), String(selfId));

        await new Promise((r) => setTimeout(r, 30));
        let recs = drainJson();
        let access = recs.find((r) => r.event === 'http.access');
        check('响应结束后输出 http.access 访问日志', !!access, access ? JSON.stringify(access) : JSON.stringify(recs));
        check('访问日志含自造的 requestId（与响应头一致）', access && access.requestId === selfId, `${access && access.requestId} vs ${selfId}`);
        check('访问日志含 method/path/status/durationMs', access && access.method === 'GET' && access.path === '/api/ok' && access.status === 200 && typeof access.durationMs === 'number', JSON.stringify(access && { m: access.method, p: access.path, s: access.status, d: access.durationMs }));
        check('2xx 判定为 info', access && access.level === 'info', access && access.level);

        // 2) 调用方带来 requestId：必须沿用
        res = await req({ path: '/api/ok', headers: { 'X-Request-Id': 'CLIENT-RID-001' } });
        check('沿用调用方 X-Request-Id', res.headers['x-request-id'] === 'CLIENT-RID-001', String(res.headers['x-request-id']));
        await new Promise((r) => setTimeout(r, 30));
        recs = drainJson();
        access = recs.find((r) => r.event === 'http.access');
        check('日志 requestId 与客户端传入一致', access && access.requestId === 'CLIENT-RID-001', access && String(access.requestId));

        // 3) traceId 跨系统贯穿
        res = await req({ path: '/api/ok', headers: { 'X-Trace-Id': 'TRACE-POS-9' } });
        await new Promise((r) => setTimeout(r, 30));
        recs = drainJson();
        access = recs.find((r) => r.event === 'http.access');
        check('X-Trace-Id 被记入 traceId（POS→ERP 链路可对上）', access && access.traceId === 'TRACE-POS-9', access && String(access.traceId));

        // 3b) 完全不带任何链路头的请求：traceId 应默认同源于自造 requestId
        res = await req({ path: '/api/ok' });
        await new Promise((r) => setTimeout(r, 30));
        recs = drainJson();
        const plain = recs.filter((r) => r.event === 'http.access').pop();
        check('未传 X-Trace-Id 时 traceId 默认同源于 requestId', plain && plain.traceId === plain.requestId, plain && `${plain.traceId} / ${plain.requestId}`);

        // 4) requestId 贯穿到业务代码深度（next 回调内读取）
        const probe = express();
        probe.use(requestLogMiddleware);
        let deepId = null;
        probe.get('/api/deep', (req, res) => {
          deepId = RequestContext.getRequestId();
          res.json({ ok: true });
        });
        const probeServer = http.createServer(probe);
        await new Promise((r2) => probeServer.listen(0, '127.0.0.1', r2));
        const pPort = probeServer.address().port;
        await new Promise((r2) => {
          const rr = http.request({ host: '127.0.0.1', port: pPort, path: '/api/deep', headers: { 'X-Request-Id': 'DEEP-1234' } }, (rs) => rs.resume());
          rr.on('end', r2);
          rr.on('close', r2);
          rr.end();
        });
        check('requestId 贯穿到业务 handler（跨全部 await 深度）', deepId === 'DEEP-1234', String(deepId));
        probeServer.close();
        await new Promise((r2) => setTimeout(r2, 40));
        drain();

        // 5) 5xx 分级
        res = await req({ path: '/api/boom' });
        await new Promise((r) => setTimeout(r, 30));
        recs = drainJson();
        const err5 = recs.find((r) => r.event === 'http.access');
        check('5xx 响应记 error 级（可告警）', err5 && err5.level === 'error', err5 && `${err5.status}/${err5.level}`);
        check('5xx 访问日志附带错误摘要（此前无关联依据）', err5 && typeof err5.error === 'string' && err5.error.includes('boom-for-log-test'), err5 && String(err5.error));

        // 6) 噪音路径不记日志
        drain();
        res = await req({ path: '/api/assets-like.css' });
        await new Promise((r) => setTimeout(r, 30));
        recs = drainJson();
        check('静态资源路径不产生访问日志（避免噪音淹没业务日志）', !recs.some((r) => r.event === 'http.access'), JSON.stringify(recs));

        // 7) 客户端提前断开（服务端响应尚未 finish 即被 destroy）
        drain();
        await req({ path: '/api/hang', abort: true });
        await new Promise((r) => setTimeout(r, 80));
        recs = drainJson();
        const abandoned = recs.find((r) => r.event === 'http.abandoned');
        check('客户端提前断开记为 http.abandoned（不伪造 200 混入访问日志）', !!abandoned, JSON.stringify(recs.map((r) => r.event)));

        // 8) 慢请求标注
        drain();
        const slowApp = express();
        slowApp.use(requestLogMiddleware);
        slowApp.get('/api/slow', async (req, res) => {
          await new Promise((r) => setTimeout(r, 120));
          res.json({ ok: true });
        });
        const slowServer = http.createServer(slowApp);
        await new Promise((r2) => slowServer.listen(0, '127.0.0.1', r2));
        const sPort = slowServer.address().port;
        await new Promise((r2) => {
          const rr = http.request({ host: '127.0.0.1', port: sPort, path: '/api/slow' }, (rs) => rs.resume());
          rr.on('close', r2);
          rr.end();
        });
        slowServer.close();
        await new Promise((r2) => setTimeout(r2, 60));
        recs = drainJson();
        const slowRec = recs.find((r) => r.event === 'http.access');
        check('超过阈值的请求标注 slow=true', slowRec && slowRec.slow === true, slowRec && JSON.stringify({ d: slowRec.durationMs, slow: slowRec.slow }));
      } catch (e) {
        FAIL++;
        log(`  FAIL  C 段异常 — ${e && e.stack ? e.stack.split('\n')[0] : e}`);
      } finally {
        server.close();
        resolve();
      }
    });
  });
}

// ---------- D 段：异常过滤器接入结构化日志 ----------
function exceptionSuite() {
  log('\n【D 段】GlobalExceptionFilter × 结构化日志');

  function fakeHost(status = 500, headers = { 'X-Request-Id': 'RID-FILTER-1' }) {
    const captured = { status: null, body: null };
    const res = {
      headersSent: false,
      statusCode: status,
      getHeader: (k) => headers[k],
      setHeader: (k, v) => {
        headers[k] = v;
      },
      locals: {},
      status(s) {
        captured.status = s;
        return this;
      },
      json(b) {
        captured.body = b;
      },
    };
    // req 需带 headers：过滤器会据此兜底 requestId（未走中间件的调用路径）
    const host = { switchToHttp: () => ({ getRequest: () => ({ headers }), getResponse: () => res }) };
    return { host, res, captured };
  }

  // 1) 未知异常
  drain();
  const f1 = fakeHost();
  const filter = new GlobalExceptionFilter();
  filter.catch(new Error('未处理异常注入'), f1.host);
  const recs1 = drainJson();
  const un = recs1.find((r) => r.event === 'unhandled');
  check('未知异常输出 event=unhandled 且为 error 级', un && un.level === 'error', un ? `${un.level}/${JSON.stringify(un.err && un.err.message)}` : JSON.stringify(recs1));
  check('unhandled 日志带 requestId（与响应头同源）', un && un.requestId === 'RID-FILTER-1', un && String(un.requestId));
  check('异常响应体回带 requestId（客户端可据此检索日志）', f1.captured.body && f1.captured.body.error && f1.captured.body.error.requestId === 'RID-FILTER-1', JSON.stringify(f1.captured.body && f1.captured.body.error));
  check('异常响应头也回写 X-Request-Id', f1.res.getHeader('X-Request-Id') === 'RID-FILTER-1', String(f1.res.getHeader('X-Request-Id')));

  // 2) 业务异常（可预期拒绝）：此前完全不打日志
  drain();
  class BizErr extends Error {
    constructor() {
      super('余额不足');
      this.code = 'BALANCE_INSUFFICIENT';
      this.httpStatus = 400;
    }
  }
  const f2 = fakeHost(400);
  const { BusinessException } = require(path.join(DIST, 'common/interfaces/exception.interface'));
  filter.catch(new BusinessException('余额不足'), f2.host);
  const recs2 = drainJson();
  const biz = recs2.find((r) => r.event === 'business.rejected');
  check('业务异常也输出 business.rejected（此前是日志盲区）', !!biz, JSON.stringify(recs2.map((r) => r.event)));
  check('业务异常按 info 级记录（可预期，不算故障）', biz && biz.level === 'info', biz && String(biz.level));

  void BizErr;
}

// ---------- A 段：输出格式 ----------
function formatSuite() {
  log('\n【A 段】日志输出格式与阈值');

  process.env.NODE_ENV = 'production';
  drain(false); // 先清掉 A 段自身的打印，否则会被当成「日志行」解析
  CAPTURING = true; // 随后重新开启捕获，A 段后续用例依赖捕获 logger 输出
  RequestContext.run({ requestId: 'RID-FMT-1', traceId: 'T-FMT', method: 'POST', path: '/api/sales', startTime: Date.now() - 5 }, () => {
    logger.logWarn('http.access', { status: 400, durationMs: 7, slow: false });
  });
  const [line] = drainJson();
  check('生产模式输出合法 JSON 行（日志采集器可直接消费）', !!line && !line.raw, line ? String(line.raw || '').slice(0, 80) : 'none');
  check('JSON 含 ts/level/event/requestId/traceId 等约定字段', line && line.ts && line.level === 'warn' && line.event === 'http.access' && line.requestId === 'RID-FMT-1' && line.traceId === 'T-FMT', JSON.stringify(line));
  check('durationMs 由上下文 startTime 自动推算（调用方无需传）', line && typeof line.durationMs === 'number', line && String(line.durationMs));

  // 非请求上下文（脚本/定时任务）也不应抛错
  let noCtxThrew = null;
  try {
    drain();
    logger.logInfo('bootstrap.start', { stage: 'warmup' });
  } catch (e) {
    noCtxThrew = e;
  }
  const bootRecs = drainJson();
  check('非请求上下文输出日志不抛错（脚本/定时任务可用）', noCtxThrew === null && bootRecs.length >= 1, bootRecs.length ? `requestId=${bootRecs[0].requestId}` : 'none');

  process.env.NODE_ENV = 'development';
  drain();
  RequestContext.run({ requestId: 'RID-DEV' }, () => logger.logInfo('demo.event', { sku: 'A01' }));
  const [devLine] = drain();
  check('开发环境输出可读单行（本地排障友好）', /^2026-.*INFO\s+\[demo\.event\].*requestId=RID-DEV/.test(devLine || ''), String(devLine).slice(0, 90));

  check('levelForStatus 分级正确', logger.levelForStatus(500) === 'error' && logger.levelForStatus(404) === 'warn' && logger.levelForStatus(200) === 'info');

  // 恢复生产模式：C/D 段断言的是日志平台消费的 JSON 格式，不能被 A 段的 dev 切换带偏
  process.env.NODE_ENV = 'production';
}

// ---------- main ----------
(async () => {
  CAPTURING = true; // A 段需要捕获 logger 输出
  formatSuite();
  CAPTURING = true; // C/D 段的中间件与过滤器会写日志，同样需要捕获
  ctxSemantics();
  await runHttpSuite();
  exceptionSuite();

  log('\n============================================');
  if (FAIL === 0) {
    log(`REQUEST_ID_PASS  断言全部通过：${PASS} PASS / 0 FAIL`);
  } else {
    log(`REQUEST_ID_FAIL  ${PASS} PASS / ${FAIL} FAIL`);
  }
  log('============================================');
  process.exit(FAIL === 0 ? 0 : 1);
})();

let PORT = 0;
// 恢复 stdout，避免后续 check 输出被吞
process.on('exit', () => {
  process.stdout.write = origOut;
  process.stderr.write = origErr;
});
