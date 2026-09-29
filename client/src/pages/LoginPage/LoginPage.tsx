import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Store, LogIn, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth, type EmployeeRole } from '@client/src/contexts/AuthContext';
import { STORE_NAME } from '@client/src/lib/store';

const QUICK_LOGINS: Array<{ code: string; pin: string; label: string; role: EmployeeRole }> = [
  { code: '1001', pin: '123456', label: '收银员（张收银）', role: 'cashier' },
  { code: '2002', pin: '123456', label: '店长（李店长）', role: 'manager' },
  { code: '3003', pin: '123456', label: '督导（王督导）', role: 'supervisor' },
];

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    navigate('/pos', { replace: true });
    return null;
  }

  const doLogin = async (c: string, p: string) => {
    if (!c.trim() || !p.trim()) {
      toast.error('请输入工号和 PIN');
      return;
    }
    setLoading(true);
    try {
      const emp = await login(c, p);
      toast.success(`欢迎，${emp.name}`);
      navigate('/pos', { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-pos-paper to-pos-accent-light/40 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-pos-line overflow-hidden">
        <div className="bg-pos-accent px-6 py-6 text-white">
          <div className="flex items-center gap-2 text-sm opacity-90"><Store size={16} /> {STORE_NAME}</div>
          <h1 className="text-xl font-semibold mt-2">云裁智慧门店 POS</h1>
          <p className="text-xs opacity-80 mt-1">请登录后开始收银</p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs text-pos-ink-3 block mb-1.5">工号</label>
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3" />
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="如 1001"
                className="w-full h-11 pl-9 pr-3 border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-pos-ink-3 block mb-1.5">PIN 码</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3" />
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doLogin(code, pin)}
                placeholder="••••••"
                className="w-full h-11 pl-9 pr-3 border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20"
              />
            </div>
          </div>
          <button
            onClick={() => doLogin(code, pin)}
            disabled={loading}
            className="w-full h-11 bg-pos-accent text-white rounded-lg font-medium hover:bg-[#A8401F] transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading ? '登录中...' : (<><LogIn size={16} /> 登录</>)}
          </button>

          <div className="pt-2 border-t border-pos-line">
            <div className="text-[11px] text-pos-ink-3 mb-2">演示快速登录（PIN 均为 123456）</div>
            <div className="grid grid-cols-1 gap-2">
              {QUICK_LOGINS.map((q) => (
                <button
                  key={q.code}
                  onClick={() => doLogin(q.code, q.pin)}
                  className="flex items-center justify-between px-3 py-2 text-xs border border-pos-line rounded-md text-pos-ink-2 hover:bg-pos-paper transition-colors"
                >
                  <span>{q.label}</span>
                  <ArrowRight size={12} className="text-pos-ink-3" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
