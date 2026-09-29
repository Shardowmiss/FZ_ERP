// 黑盒测试 PermissionGuard 决策逻辑（全局写授权守卫）。
// 加载编译后的守卫，用 require 缓存桩替换重型 RbacService 依赖，注入 mock 验证四类路径。
// 运行：node sim-permission-guard.cjs
const path = require('path');

// 1) 用桩替换重型 rbac.service，避免加载其整个依赖图
const rbacServicePath = path.resolve(
  __dirname,
  './dist/server/modules/rbac/rbac.service.js',
);
require.cache[rbacServicePath] = {
  id: rbacServicePath,
  filename: rbacServicePath,
  loaded: true,
  exports: { RbacService: class {} },
};

const { PermissionGuard } = require('./dist/server/common/guards/permission.guard.js');

// 2) mock RbacService：按 token → 权限码集合判定
function makeRbac(grantedByToken) {
  return {
    async checkPermission(token, code) {
      const set = grantedByToken[String(token)] || new Set();
      return set.has(code);
    },
  };
}

// 3) mock Reflector：直接返回给定的权限码（undefined 表示未标注 @CheckPermission）
function makeReflector(code) {
  return {
    getAllAndOverride() {
      return code;
    },
  };
}

// 4) 伪 ExecutionContext
function makeCtx(token, bearer) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-auth-token': token, authorization: bearer },
      }),
    }),
  };
}

let pass = 0;
let fail = 0;
function assert(name, cond) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name);
  }
}

async function run() {
  console.log('=== sim-permission-guard (black-box) ===');

  // ① 未声明权限码 → 放行（向后兼容，不破坏既有调用）
  {
    const g = new PermissionGuard(makeRbac({}), makeReflector(undefined));
    const r = await g.canActivate(makeCtx('tok'));
    assert('no-code-pass-through', r === true);
  }

  // ② 声明了权限码但无 token → 401 Unauthorized
  {
    const g = new PermissionGuard(makeRbac({}), makeReflector('sales:order'));
    let status = null;
    try {
      await g.canActivate(makeCtx(undefined));
    } catch (e) {
      status = e && typeof e.getStatus === 'function' ? e.getStatus() : null;
    }
    assert('code-but-no-token-401', status === 401);
  }

  // ③ 有 token 且持有权限 → 放行
  {
    const g = new PermissionGuard(
      makeRbac({ tok: new Set(['sales:order']) }),
      makeReflector('sales:order'),
    );
    const r = await g.canActivate(makeCtx('tok'));
    assert('token-has-permission-allow', r === true);
  }

  // ④ 有 token 但不持有权限 → 403 Forbidden（垂直越权被拦）
  {
    const g = new PermissionGuard(
      makeRbac({ tok: new Set(['other:code']) }),
      makeReflector('sales:order'),
    );
    let status = null;
    try {
      await g.canActivate(makeCtx('tok'));
    } catch (e) {
      status = e && typeof e.getStatus === 'function' ? e.getStatus() : null;
    }
    assert('token-no-permission-403', status === 403);
  }

  // ⑤ Authorization: Bearer <token> 回退路径 → 放行
  {
    const g = new PermissionGuard(
      makeRbac({ 'bearer-tok': new Set(['sales:order']) }),
      makeReflector('sales:order'),
    );
    const r = await g.canActivate(makeCtx(undefined, 'Bearer bearer-tok'));
    assert('bearer-fallback-allow', r === true);
  }

  console.log(
    `\n=== sim-permission-guard: ${pass} passed, ${fail} failed ===`,
  );
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('SIM ERROR', e);
  process.exit(2);
});
