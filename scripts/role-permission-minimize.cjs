// 角色授权最小化（安全部分收口）—— 通用脚本
//
// 判定依据（shared/permission-match.ts）：
//   canDo(code, held): held 含父码 ⇒ 子动作放行（粗码隐式放大全部动作 = 越权根因）
//   checkAccess(code, held): 读放宽（持子码即可进只读接口）
//   canDo(coarseGuard, [child]): FALSE —— 写接口若声明为粗码守卫，只持子码过不了
//     ⇒ 在 #815 把写守卫拆成动作子码之前，写资源的粗码必须保留，否则写接口 403。
//
// 本脚本采用「安全部分收口」规则：
//   · 3 段显式动作码：原样保留（含写动作，保证写接口可用）
//   · 2 段粗码 res：
//       - 若角色持有 res 的任一「写动作」(非 :view) ⇒ 保留粗码 res（写守卫需要，残余越权待 #815 清除）
//       - 否则（仅只读或无显式动作）⇒ 收敛为 res:view（若目录有），去除隐式放大
//   · 2 段叶子动作码（目录无 res:* 子码，如 dashboard:view）：原样保留
//   · 1 段顶层码：转 res:view（若目录有）否则保留
//
// 用法：
//   node scripts/role-permission-minimize.cjs            # 打印 5 个角色的目标集（dry-run）
//   ROLE=warehouse node ...                              # 仅打印某角色
//   MODE=apply node ...                                  # 对全部/指定角色清库并重放目标集（幂等）
//   MODE=apply ROLE=warehouse node ...

const postgres = require('postgres');

const sql = postgres({
  host: '127.0.0.1',
  port: 5434,
  database: 'erp_db',
  username: 'erp',
  password: 'erp',
});

const ROLES = ['warehouse', 'store_manager', 'finance', 'purchasing', 'data_governor'];
const targetRoles = process.env.ROLE ? [process.env.ROLE] : ROLES;

function isWriteAction(code) {
  const seg = code.split(':');
  if (seg.length < 3) return false;
  return seg[2] !== 'view';
}

async function computeTarget(role) {
  const heldRows = await sql`
    SELECT p.code AS perm_code
    FROM rbac_role_permission rp
    JOIN rbac_role r ON r.id = rp.role_id
    JOIN rbac_permission p ON p.id = rp.permission_id
    WHERE r.code = ${role}
    ORDER BY p.code
  `;
  const held = heldRows.map((r) => r.perm_code);
  const catalogRows = await sql`SELECT code FROM rbac_permission`;
  const catalogSet = new Set(catalogRows.map((r) => r.code));

  const target = new Set();
  const collapsed = []; // 粗码 -> :view（去除隐式放大）
  const keptCoarse = []; // 保留的粗码（写资源，待 #815）
  const keptAction = [];
  const keptLeaf = [];

  for (const code of held) {
    const segs = code.split(':').length;
    if (segs === 3) {
      target.add(code);
      keptAction.push(code);
    } else if (segs === 1) {
      const v = `${code}:view`;
      if (catalogSet.has(v)) {
        target.add(v);
        collapsed.push(`${code} → ${v}`);
      } else {
        target.add(code);
      }
    } else {
      // 2 段
      // 叶子判定：目录无 code + ':' 开头的子码
      let hasChildren = false;
      for (const c of catalogSet) {
        if (c.startsWith(code + ':')) {
          hasChildren = true;
          break;
        }
      }
      if (!hasChildren) {
        // 叶子动作码（如 dashboard:view）
        target.add(code);
        keptLeaf.push(code);
        continue;
      }
      // 资源粗码：看角色是否持有其写动作
      const writeActions = held.filter((h) => h.startsWith(code + ':') && isWriteAction(h));
      if (writeActions.length > 0) {
        target.add(code); // 保留粗码（写守卫需要）
        keptCoarse.push(`${code}（写动作 ${writeActions.length} 个，待 #815）`);
      } else {
        const v = `${code}:view`;
        if (catalogSet.has(v)) {
          target.add(v);
          collapsed.push(`${code} → ${v}`);
        } else {
          target.add(code);
          keptCoarse.push(`${code}（目录无 :view，防御性保留）`);
        }
      }
    }
  }

  // 最小可复现配置（用于写回 OPERATIONAL_ROLES）：
  //   · 2 段资源粗码 res：若持有其写动作 ⇒ 保留 res（分组码，重启会展开全部子码，写守卫需要）
  //                      否则 ⇒ res:view（叶子，不再展开写动作）
  //   · 2 段叶子码（无子码，如 dashboard:view / retail:view）：原样保留
  //   · 3 段动作码：由父资源粗码或 :view 覆盖，不单独列入配置
  const minimalConfig = new Set();
  const resourceSeen = new Set();
  for (const code of held) {
    const segs = code.split(':').length;
    if (segs === 2) {
      let hasChildren = false;
      for (const c of catalogSet) {
        if (c.startsWith(code + ':')) { hasChildren = true; break; }
      }
      if (!hasChildren) {
        minimalConfig.add(code); // 叶子动作码
      } else {
        if (resourceSeen.has(code)) continue;
        resourceSeen.add(code);
        const writeActions = held.filter((h) => h.startsWith(code + ':') && isWriteAction(h));
        minimalConfig.add(writeActions.length > 0 ? code : `${code}:view`);
      }
    } else if (segs === 3) {
      const parent = code.split(':').slice(0, 2).join(':');
      if (resourceSeen.has(parent)) continue;
      resourceSeen.add(parent);
      const writeActions = held.filter((h) => h.startsWith(parent + ':') && isWriteAction(h));
      minimalConfig.add(writeActions.length > 0 ? parent : `${parent}:view`);
    }
    // 1 段顶层：由上层处理时不会出现（held 无 1 段码）
  }

  return {
    role,
    held,
    target: [...target].sort(),
    minimalConfig: [...minimalConfig].sort(),
    collapsed,
    keptCoarse,
    keptAction,
    keptLeaf,
  };
}

function tsArray(arr) {
  return arr.map((c) => `        '${c}',`).join('\n');
}

async function main() {
  const results = [];
  for (const role of targetRoles) {
    const r = await computeTarget(role);
    results.push(r);
    console.log('══════════════════════════════════════════════════════════════');
    console.log(` 角色 ${r.role}`);
    console.log(`══════════════════════════════════════════════════════════════`);
    console.log(`持有 ${r.held.length} 码 → 目标 ${r.target.length} 码`);
    console.log(`· 粗码收敛为 :view（去除隐式放大）: ${r.collapsed.length} 条`);
    r.collapsed.forEach((c) => console.log(`     ${c}`));
    console.log(`· 保留粗码（写资源，待 #815）: ${r.keptCoarse.length} 条`);
    r.keptCoarse.forEach((c) => console.log(`     ${c}`));
    console.log(`· 保留叶子动作码: ${r.keptLeaf.join(', ') || '(无)'}`);
    console.log(`· 保留显式动作码: ${r.keptAction.length} 条`);
    console.log('');
    console.log('── OPERATIONAL_ROLES 最小可复现配置（permissions 数组，直接粘贴）──');
    console.log(`[\n${tsArray(r.minimalConfig)}\n      ]`);
    console.log('');
  }

  if (process.env.MODE === 'apply') {
    for (const r of results) {
      // 清空该角色现有授权
      await sql`
        DELETE FROM rbac_role_permission
        WHERE role_id = (SELECT id FROM rbac_role WHERE code = ${r.role})
      `;
      // 取权限 id
      const permIds = await sql`
        SELECT id, code FROM rbac_permission WHERE code = ANY(${r.target})
      `;
      const idMap = new Map(permIds.map((p) => [p.code, p.id]));
      const missing = r.target.filter((c) => !idMap.has(c));
      if (missing.length) console.log(`  ! ${r.role} 目标码不在目录（跳过）: ${missing.join(', ')}`);
      const roleId = await sql`SELECT id FROM rbac_role WHERE code = ${r.role}`;
      const rid = roleId[0].id;
      for (const c of r.target) {
        const pid = idMap.get(c);
        if (pid) {
          await sql`
            INSERT INTO rbac_role_permission (role_id, permission_id)
            VALUES (${rid}, ${pid})
            ON CONFLICT DO NOTHING
          `;
        }
      }
      const cnt = await sql`
        SELECT count(*)::int AS n FROM rbac_role_permission WHERE role_id = ${rid}
      `;
      console.log(`  ✓ ${r.role} 已重放：目标 ${r.target.length} 码，库现 ${cnt[0].n} 码`);
    }
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
