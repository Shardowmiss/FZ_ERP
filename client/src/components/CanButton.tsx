import { ReactNode } from 'react';
import { useAuth } from '@client/src/contexts/AuthContext';

interface CanButtonProps {
  menu: string;
  action: 'create' | 'edit' | 'approve' | 'delete' | 'print' | 'export';
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
