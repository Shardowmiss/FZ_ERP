import { ReactNode } from 'react';
import { useAuth } from '@client/src/contexts/AuthContext';

interface CanButtonProps {
  menu: string;
  // 动作词需与后端权限码后缀对齐（如 menu='purchase:inbound', action='accept'
  // 组合成后端码 'purchase:inbound:accept'）；新增动作请同步后端 rbac 目录。
  action:
    | 'create'
    | 'edit'
    | 'approve'
    | 'accept'
    | 'void'
    | 'delete'
    | 'view'
    | 'print'
    | 'export';
  children: ReactNode;
  fallback?: ReactNode;
  disabled?: boolean;
}

const CanButton = ({ menu, action, children, fallback = null, disabled = false }: CanButtonProps) => {
  const { hasPermission } = useAuth();
  const code = `${menu}:${action}`;

  if (!hasPermission(code)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

export default CanButton;
