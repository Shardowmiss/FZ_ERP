import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useAuth, roleAtLeast, type EmployeeRole } from '@client/src/contexts/AuthContext';

interface RequireAuthProps {
  children: ReactNode;
  /** 所需最低角色；不传则只要登录即可 */
  role?: EmployeeRole;
}

const ROLE_LABEL: Record<EmployeeRole, string> = {
  cashier: '收银员',
  manager: '店长',
  supervisor: '督导',
};

/**
 * 路由守卫（P0-5）
 * - 未登录 -> 跳转到 /login
 * - 已登录但角色不足 -> 跳转到 /pos 并提示无权限
 *
 * 修复（2026-10-04）：原先角色不足时静默重定向到 /pos，用户点击菜单毫无反馈，
 * 表现为「点了没反应」。现补一条无权限 toast，明确告知需用更高权限账号登录。
 */
export default function RequireAuth({ children, role }: RequireAuthProps) {
  const { isAuthenticated, employee } = useAuth();
  const location = useLocation();

  const denied = !!role && !!employee && !roleAtLeast(employee.role, role);

  useEffect(() => {
    if (denied) {
      toast.error(
        `当前账号（${ROLE_LABEL[employee!.role]}）无权限访问该页面，请使用${ROLE_LABEL[role!]}及以上账号登录`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [denied]);

  if (!isAuthenticated || !employee) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (denied) {
    return <Navigate to="/pos" replace />;
  }

  return <>{children}</>;
}
