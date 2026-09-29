import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@client/src/contexts/AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
  permission?: string;
}

const ProtectedRoute = ({ children, permission }: ProtectedRouteProps) => {
  const { isLoading, isLoggedIn, hasMenu } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (permission && !hasMenu(permission)) {
    return <Navigate to="/403" replace />;
  }

  return <div className="contents">{children}</div>;
};

export default ProtectedRoute;
