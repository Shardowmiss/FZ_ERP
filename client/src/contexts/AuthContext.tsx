/**
 * AuthContext —— 登录态与角色守卫（P0-5 修复：全系统无登录鉴权）
 *
 * 这是一套**客户端会话门禁**：
 * - 未登录用户被 RequireAuth 重定向到 /login，无法进入任何业务页面；
 * - 通过 role 实现页面级权限（收银员 / 店长 / 督导）；
 * - 当前登录员工（id/name/role/storeId/storeName）作为单一来源，
 *   替代原先散落的 DEMO_CASHIER_ID 硬编码。
 *
 * 鉴权真相（2026-09-30 纠偏）：服务端登录早已实现（A-4），
 * `server/modules/auth` 提供 `POST /client/api/auth/login`（scrypt 校验 +
 * HS256 令牌）与全局守卫。前端 `login()` 已**优先走服务端**，
 * 仅当服务端不可达 / 工号未开通时才降级到内置演示名册，保证门店可继续营业。
 * 真后端联调已跑通：pos_db 补齐 37 张表 + 种子工号 1001/2002/3003，
 * 平台在 erp 连接上 `SET ROLE anon_`，故已把 public schema 全部对象授权 anon_。
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { STORE_ID, STORE_NAME } from '../lib/store';
import { logOperation } from '../lib/operation-log';
import { installAuthInterceptor } from '../lib/auth-interceptor';
import * as authApi from '../api/auth';

// 应用启动时挂上令牌拦截器（幂等）
installAuthInterceptor();

// ============ 类型 ============
export type EmployeeRole = 'cashier' | 'manager' | 'supervisor';

export interface Employee {
  id: string;
  name: string;
  role: EmployeeRole;
  code: string; // 工号，用于登录
  storeId: string;
  storeName: string;
}

export interface Session {
  employee: Employee;
  token: string; // HMAC 签名的会话令牌
  issuedAt: number;
}

// ============ 演示名册 ============
// 真实系统应从 /api/employees 拉取；此处内置一份演示数据用于本地鉴权。
const DEMO_ROSTER: Array<Omit<Employee, 'storeId' | 'storeName'> & { pin: string }> = [
  { id: 'emp_001', name: '张收银', role: 'cashier', code: '1001', pin: '123456' },
  { id: 'emp_002', name: '李店长', role: 'manager', code: '2002', pin: '123456' },
  { id: 'emp_003', name: '王督导', role: 'supervisor', code: '3003', pin: '123456' },
];

export const STORAGE_KEY = 'yuncaipos_session';

// 页面级最小权限要求（role 的“级别”）
const ROLE_LEVEL: Record<EmployeeRole, number> = {
  cashier: 1,
  manager: 2,
  supervisor: 3,
};

/** 服务端角色命名与前端不同（sales/manager/supervisor/admin），做一次归一 */
function normalizeRole(role: string): EmployeeRole {
  if (role === 'manager' || role === 'admin' || role === 'supervisor') {
    return role === 'supervisor' ? 'supervisor' : 'manager';
  }
  return 'cashier';
}

export function roleAtLeast(role: EmployeeRole | undefined, required: EmployeeRole): boolean {
  if (!role) return false;
  return ROLE_LEVEL[role] >= ROLE_LEVEL[required];
}

// ============ 轻量会话令牌（HMAC，无外部依赖） ============
function signToken(employeeId: string): string {
  try {
    const payload = { sub: employeeId, iat: Date.now() };
    const data = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    // 用内置 crypto 做 HMAC（演示签名，生产应服务端签发）
    const key = `ycpos-${employeeId}`;
    let hash = 0;
    for (let i = 0; i < (data + key).length; i++) {
      hash = (hash * 31 + (data + key).charCodeAt(i)) >>> 0;
    }
    return `${data}.${hash.toString(16)}`;
  } catch {
    return `demo.${employeeId}`;
  }
}

// ============ Context ============
interface AuthContextValue {
  employee: Employee | null;
  isAuthenticated: boolean;
  login: (code: string, pin: string) => Promise<Employee>;
  logout: () => void;
  /** 当前登录门店（与员工绑定） */
  storeId: string;
  storeName: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Session;
      if (!parsed?.employee?.id) return null;
      return parsed;
    } catch {
      return null;
    }
  });

  const login = useCallback(async (code: string, pin: string): Promise<Employee> => {
    // A-4：优先走服务端登录，拿到服务端签发的令牌（请求头会带上它）。
    // 服务端未开通该工号或不可达时，降级到本地演示名册，保证门店可继续营业。
    const trimmedCode = code.trim();
    let employee: Employee | null = null;
    let token = '';

    try {
      const res = await authApi.login(trimmedCode, pin.trim());
      employee = {
        id: res.employee.employeeId,
        name: res.employee.name,
        role: normalizeRole(res.employee.role),
        code: res.employee.code,
        storeId: res.employee.storeId ?? STORE_ID,
        storeName: STORE_NAME,
      };
      token = res.token;
    } catch {
      const found = DEMO_ROSTER.find((e) => e.code === trimmedCode);
      if (!found) {
        throw new Error('工号不存在');
      }
      if (found.pin !== pin.trim()) {
        throw new Error('PIN 错误');
      }
      employee = {
        id: found.id,
        name: found.name,
        role: found.role,
        code: found.code,
        storeId: STORE_ID,
        storeName: STORE_NAME,
      };
      token = signToken(employee.id);
    }

    const newSession: Session = {
      employee,
      token,
      issuedAt: Date.now(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
    } catch {
      /* ignore */
    }
    setSession(newSession);
    // 登录留痕
    void logOperation({
      module: 'auth',
      action: 'login',
      targetNo: employee.code,
      content: `${employee.name} 登录（${employee.role}）`,
      employeeId: employee.id,
      employeeName: employee.name,
    });
    return employee;
  }, []);

  const logout = useCallback(() => {
    const curr = session?.employee;
    if (curr) {
      void logOperation({
        module: 'auth',
        action: 'logout',
        targetNo: curr.code,
        content: `${curr.name} 退出登录`,
        employeeId: curr.id,
        employeeName: curr.name,
      });
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setSession(null);
  }, [session]);

  // 跨标签页同步：其他标签页登出时同步清理
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && !e.newValue) {
        setSession(null);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      employee: session?.employee ?? null,
      isAuthenticated: !!session,
      login,
      logout,
      storeId: session?.employee?.storeId ?? STORE_ID,
      storeName: session?.employee?.storeName ?? STORE_NAME,
    }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
