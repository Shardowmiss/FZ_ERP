import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@client/src/contexts/AuthContext';
import { toast } from 'sonner';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (isLoggedIn) {
    const from = (location.state as { from?: { pathname?: string } })?.from
      ?.pathname;
    const target = from && from !== '/' && from !== '/login' ? from : '/dashboard';
    return <Navigate to={target} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('请输入用户名和密码');
      return;
    }
    setLoading(true);
    try {
      await login(username, password);
      toast.success('登录成功');
      const from = (location.state as { from?: { pathname?: string } })?.from
        ?.pathname;
      const target = from && from !== '/' && from !== '/login' ? from : '/dashboard';
      navigate(target, { replace: true });
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : '登录失败，请检查用户名和密码';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-96">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">服装ERP管理系统</h1>
          <p className="text-sm text-gray-500 mt-1">请登录您的账号</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>
        <div className="mt-4 text-xs text-gray-400 text-center">
          测试账号：admin / admin123
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
