import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth, roleAtLeast, type EmployeeRole } from '@client/src/contexts/AuthContext';

interface RequireAuthProps {
  children: ReactNode;
  /** 所需最低角色；不传则只要登录即可 */
  role?: EmployeeRole;
}

/**
 * 路由守卫（P0-5）
 * - 未登录 -> 跳转到 /login
 * - 已登录但角色不足 -> 跳转到 /pos 并提示无权限
 */
export default function RequireAuth({ children, role }: RequireAuthProps) {
  const { isAuthenticated, employee } = useAuth();
  const location = useLocation();

  if (!isAuthenticated || !employee) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (role && !roleAtLeast(employee.role, role)) {
    return <Navigate to="/pos" replace />;
  }

  return <>{children}</>;
}
