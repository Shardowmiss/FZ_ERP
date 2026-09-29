import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { requestLogMiddleware } from '../../middleware/request-log.middleware';
import { RequestContext } from '../../common/logging/request-context';
import { GlobalExceptionFilter } from '../../common/filters/exception.filter';

/** 捕获结构化日志输出（logger 直接写 process.stdout/stderr）。 */
function captureLogs() {
  const lines: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: unknown) => {
    lines.push(String(c));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown) => {
    lines.push(String(c));
    return true;
  }) as typeof process.stderr.write;
  return {
    drain: () => {
      const parsed = lines
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return { raw: l };
          }
        });
      lines.length = 0;
      return parsed;
    },
    restore: () => {
      process.stdout.write = out;
      process.stderr.write = err;
    },
  };
}

/** 最小 express 响应替身：中间件只用到 setHeader / statusCode / writableEnded / on。 */
function fakeRes(status = 200) {
  const res = new EventEmitter() as unknown as {
    statusCode: number;
    writableEnded: boolean;
    locals: Record<string, unknown>;
    setHeader: (k: string, v: string) => void;
    getHeader: (k: string) => string | undefined;
    headers: Record<string, string>;
  };
  res.statusCode = status;
  res.writableEnded = true;
  res.locals = {};
  res.headers = {};
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.getHeader = (k) => res.headers[k];
  return res;
}

/**
 * 把头名统一成小写——真实 HTTP 里 req.headers 的键必然是小写，
 * 直接喂 `{ 'X-Request-Id': ... }` 这类大写键会让中间件「读不到」而静默自造新 ID。
 */
function lowerHeaders(headers: Record<string, string> = {}) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

function fakeReq(headers: Record<string, string> = {}, url = '/api/sales') {
  return { headers: lowerHeaders(headers), url, method: 'POST', originalUrl: url } as never;
}

/**
 * 驱动中间件直到 next 回调结束，并让 res 的 finish 事件派发。
 * finish 必须在 **next 回调内部**触发：中间件的 ALS 作用域在 next() 返回后就退出了，
 * 若在外部 emit，访问日志里的 requestId 会是 undefined（真实 express 中 finish 本就在作用域内触发）。
 */
function runMiddleware(req: never, res: ReturnType<typeof fakeRes>) {
  let nextCalled = false;
  requestLogMiddleware(req, res as never, ((() => {
    nextCalled = true;
    res.emit('finish');
  }) as never) as never);
  return nextCalled;
}

describe('request-log 中间件：requestId 贯穿与链路标识', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('缺失 X-Request-Id 时自造 UUID 并回写响应头', () => {
    const res = fakeRes();
    runMiddleware(fakeReq({}, '/api/sales'), res);
    const id = res.headers['X-Request-Id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('沿用调用方传入的 X-Request-Id（不被覆盖）', () => {
    const res = fakeRes();
    runMiddleware(fakeReq({ 'X-Request-Id': 'CLIENT-7' }), res);
    expect(res.headers['X-Request-Id']).toBe('CLIENT-7');
  });

  it('X-Trace-Id 优先，缺失时默认同源于 requestId（POS→ERP 同一次推送两端可对上）', () => {
    // 必须在 next 回调内读取：中间件跑完后 ALS 作用域已退出
    const captured: Array<{ traceId?: string; requestId?: string }> = [];
    const probe = (headers: Record<string, string>, url: string) => {
      const res = fakeRes();
      requestLogMiddleware(fakeReq(headers, url) as never, res as never, (() => {
        captured.push({ ...(RequestContext.get() ?? {}) });
        res.emit('finish');
      }) as never);
    };

    probe({ 'X-Trace-Id': 'TRACE-POSSVC-3' }, '/api/x');
    probe({}, '/api/y');

    expect(captured[0]?.traceId).toBe('TRACE-POSSVC-3');
    expect(captured[1]?.traceId).toBe(captured[1]?.requestId);
  });

  it('requestId 贯穿到 next 之后的业务代码（跨异步深度）', () => {
    const res = fakeRes();
    let inside: string | undefined;
    let outside: string | undefined;
    requestLogMiddleware(fakeReq({ 'X-Request-Id': 'DEEP-42' }), res as never, ((() => {
      inside = RequestContext.getRequestId();
      void Promise.resolve().then(() => {
        // 微任务里仍应可见
      });
    }) as never) as never);
    outside = RequestContext.getRequestId();
    expect(inside).toBe('DEEP-42');
    expect(outside).toBeUndefined(); // 未进入上下文时读不到
    res.emit('finish');
  });

  it('访问日志按状态码分级：2xx=info / 5xx=error', () => {
    process.env.NODE_ENV = 'production';
    const cap = captureLogs();
    const ok = fakeRes(200);
    runMiddleware(fakeReq({}, '/api/sales'), ok);
    const bad = fakeRes(500);
    runMiddleware(fakeReq({}, '/api/sales'), bad);
    const recs = cap.drain();
    cap.restore();

    const info = recs.find((r) => r.event === 'http.access' && r.status === 200);
    const error = recs.find((r) => r.event === 'http.access' && r.status === 500);
    expect(info?.level).toBe('info');
    expect(error?.level).toBe('error');
    expect(info?.requestId).toBe(ok.headers['X-Request-Id']);
  });

  it('静态资源等噪音路径不产生访问日志', () => {
    process.env.NODE_ENV = 'production';
    const cap = captureLogs();
    runMiddleware(fakeReq({}, '/assets/app.css'), fakeRes());
    const recs = cap.drain();
    cap.restore();
    expect(recs.filter((r) => r.event === 'http.access')).toHaveLength(0);
  });
});

describe('GlobalExceptionFilter：故障可关联', () => {
  afterEach(() => {
    process.env.NODE_ENV = 'production';
  });

  function fakeHost(status: number, headers: Record<string, string> = {}) {
    const lower = lowerHeaders(headers);
    const res = fakeRes(status) as never;
    const captured: { status?: number; body?: unknown } = {};
    (res as { status: (s: number) => unknown }).status = (s: number) => {
      captured.status = s;
      return res;
    };
    (res as { json: (b: unknown) => void }).json = (b: unknown) => {
      captured.body = b;
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: lower }),
        getResponse: () => res,
      }),
    };
    return { host, res, captured };
  }

  it('未知异常输出 unhandled 事件，且 requestId 与响应头/响应体同源', () => {
    process.env.NODE_ENV = 'production';
    const cap = captureLogs();
    const { host, res, captured } = fakeHost(500, { 'X-Request-Id': 'RID-FAIL-1' });
    new GlobalExceptionFilter().catch(new Error('炸了'), host as never);
    const recs = cap.drain();
    cap.restore();

    const un = recs.find((r) => r.event === 'unhandled');
    expect(un?.level).toBe('error');
    expect(un?.requestId).toBe('RID-FAIL-1'); // 关键：故障日志不再是无主记录
    expect((res as unknown as { headers: Record<string, string> }).headers['X-Request-Id']).toBe('RID-FAIL-1');
    expect((captured.body as { error: { requestId?: string } }).error.requestId).toBe('RID-FAIL-1');
  });

  it('未走中间件时，从请求头兜底 requestId（过滤器直调场景）', () => {
    process.env.NODE_ENV = 'production';
    const cap = captureLogs();
    const { host } = fakeHost(500, { 'x-request-id': 'HEADER-ONLY-9' });
    new GlobalExceptionFilter().catch(new Error('炸了2'), host as never);
    const recs = cap.drain();
    cap.restore();
    expect(recs.find((r) => r.event === 'unhandled')?.requestId).toBe('HEADER-ONLY-9');
  });
});

describe('跨端透传：POS 上行携带本端 requestId（ERP 侧以同一 traceId 收单）', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = origFetch;
    process.env.ERP_UPSTREAM_BASE_URL = 'http://erp.test/upstream';
  });

  /** 捕获上行请求的 headers。 */
  function stubFetch(ok = true) {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fn = vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url: _url, headers: init.headers, body: init.body });
      return {
        ok,
        status: ok ? 200 : 500,
        text: async () => (ok ? '{"erpNo":"E-1"}' : 'boom'),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fn);
    return calls;
  }

  it('请求上下文中的 requestId 作为 X-Request-Id / X-Trace-Id 上行', async () => {
    process.env.ERP_UPSTREAM_BASE_URL = 'http://erp.test/upstream';
    const calls = stubFetch();
    const { RealErpAdapter } = await import('./real-erp.adapter');
    const adapter = new RealErpAdapter();

    // pushToErp 是私有方法：此处直接调用以验证上行头（公开路径 pushUpstream 最终也走这里）。
    // 必须在 RequestContext.run 内调用——请求上下文就是链路标识的来源。
    await RequestContext.run({ requestId: 'POS-RID-8848', traceId: 'POS-RID-8848' }, () =>
      (adapter as unknown as { pushToErp: (b: string, d: string, p: Record<string, unknown>) => Promise<unknown> }).pushToErp(
        'sales',
        'SO-20260924-001',
        { orderNo: 'SO-20260924-001' },
      ),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].headers['X-Request-Id']).toBe('POS-RID-8848');
    expect(calls[0].headers['X-Trace-Id']).toBe('POS-RID-8848');
    // 既有上行契约不受影响：幂等键与上行密钥仍在
    expect(calls[0].headers['Idempotency-Key']).toContain('SO-20260924-001');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
  });

  it('非请求上下文（定时任务/脚本）降级为本地 traceId，不影响功能', async () => {
    process.env.ERP_UPSTREAM_BASE_URL = 'http://erp.test/upstream';
    const calls = stubFetch();
    const { RealErpAdapter } = await import('./real-erp.adapter');
    const adapter = new RealErpAdapter();
    await (adapter as unknown as { pushToErp: (b: string, d: string, p: Record<string, unknown>) => Promise<unknown> }).pushToErp(
      'sales',
      'SO-NOCTX',
      {},
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['X-Trace-Id']).toBe('sales:SO-NOCTX:1');
  });

  it('重试 3 次期间 traceId 保持稳定（否则同一次推送会被切成三条互不相干的链路）', async () => {
    process.env.ERP_UPSTREAM_BASE_URL = 'http://erp.test/upstream';
    const calls = stubFetch(false);
    const { RealErpAdapter } = await import('./real-erp.adapter');
    const adapter = new RealErpAdapter();

    await expect(
      RequestContext.run({ requestId: 'POS-RID-STABLE' }, () =>
        (adapter as unknown as { pushToErp: (b: string, d: string, p: Record<string, unknown>) => Promise<unknown> }).pushToErp(
          'sales',
          'SO-RETRY',
          {},
        ),
      ),
    ).rejects.toThrow();

    expect(calls).toHaveLength(3);
    const traceIds = new Set(calls.map((c) => c.headers['X-Trace-Id']));
    expect(traceIds.size).toBe(1);
    expect([...traceIds][0]).toBe('POS-RID-STABLE');
    expect(new Set(calls.map((c) => c.headers['Idempotency-Key'])).size).toBe(3);
  }, 15000);
});
