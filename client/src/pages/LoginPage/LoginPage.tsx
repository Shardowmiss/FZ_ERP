import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Store, LogIn, ArrowRight, Eye, EyeOff, Sun, Moon, CloudSun } from 'lucide-react';
import { toast } from 'sonner';
import { errMsg } from '@client/src/lib/errMsg';
import { useAuth, type EmployeeRole } from '@client/src/contexts/AuthContext';
import { STORE_NAME } from '@client/src/lib/store';
import { useT } from '@client/src/i18n';
import LanguageSwitcher from '@client/src/components/LanguageSwitcher';

const QUICK_LOGINS: Array<{
  code: string;
  pin: string;
  name: string;
  role: EmployeeRole;
  initial: string;
  color: string;
}> = [
  { code: '1001', pin: '123456', name: '张收银', role: 'cashier', initial: '收', color: '#2563EB' },
  { code: '2002', pin: '123456', name: '李店长', role: 'manager', initial: '店', color: '#16A34A' },
  { code: '3003', pin: '123456', name: '王督导', role: 'supervisor', initial: '督', color: '#D97706' },
];

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 6) return { icon: <Moon size={16} />, text: '夜深了，注意休息，准备接班啦' };
  if (h < 12) return { icon: <Sun size={16} />, text: '早上好，准备开始营业啦' };
  if (h < 18) return { icon: <CloudSun size={16} />, text: '下午好，加油，生意兴隆' };
  return { icon: <Moon size={16} />, text: '晚上好，辛苦了，今晚也顺利' };
};

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    navigate('/pos', { replace: true });
    return null;
  }

  const greeting = getGreeting();

  const doLogin = async (c: string, p: string) => {
    if (!c.trim() || !p.trim()) {
      toast.error(t('login.pleaseInput'));
      return;
    }
    setLoading(true);
    try {
      const emp = await login(c, p);
      toast.success(`欢迎，${emp.name}`);
      navigate('/pos', { replace: true });
    } catch (e) {
      // 统一走 errMsg：后端返回的业务原因（如「工号不存在」「PIN 已锁定」）能透出，
      // 而不是退化成一句没有信息量的「登录失败」
      toast.error(errMsg(e, t('login.failed')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-pos-paper to-[#F1E8DA] p-4">
      {/* 语种选择（登录页即可切换，UI 文案随之切换） */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm bg-white rounded-[24px] shadow-[0_20px_60px_-15px_rgba(40,30,20,0.25)] border border-pos-line overflow-hidden">
        {/* 头栏：门店 + 问候（高亲和） */}
        <div className="relative bg-pos-accent px-6 pt-6 pb-7 text-white">
          <div className="flex items-center gap-2 text-sm opacity-90">
            <Store size={16} /> {STORE_NAME}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-white/20 ring-1 ring-white/30 flex items-center justify-center text-xl font-semibold">
              店
            </div>
            <div>
              <h1 className="text-xl font-semibold leading-tight">{t('login.title')}</h1>
              <p className="text-xs opacity-85 mt-1 flex items-center gap-1">
                {greeting.icon} {greeting.text}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs text-pos-ink-3 block mb-1.5">{t('login.code')}</label>
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3" />
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="如 1001"
                className="w-full h-14 pl-9 pr-3 border border-pos-line rounded-xl text-base text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-2 focus:ring-pos-accent/20"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-pos-ink-3 block mb-1.5">{t('login.pin')}</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3" />
              <input
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doLogin(code, pin)}
                placeholder="••••••"
                className="w-full h-14 pl-9 pr-12 border border-pos-line rounded-xl text-base text-pos-ink tracking-widest focus:outline-none focus:border-pos-accent focus:ring-2 focus:ring-pos-accent/20"
              />
              <button
                type="button"
                onClick={() => setShowPin((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-pos-ink-3 hover:text-pos-accent transition-colors"
                aria-label={showPin ? '隐藏 PIN' : '显示 PIN'}
              >
                {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <button
            onClick={() => doLogin(code, pin)}
            disabled={loading}
            className="w-full h-14 bg-pos-accent text-white rounded-xl font-medium text-base hover:bg-pos-accent-hover transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading ? t('login.loading') : (<><LogIn size={18} /> {t('login.submit')}</>)}
          </button>

          <div className="pt-3 border-t border-pos-line">
            <div className="text-[11px] text-pos-ink-3 mb-2">{t('login.demoHint')}</div>
            <div className="grid grid-cols-1 gap-2">
              {QUICK_LOGINS.map((q) => (
                <button
                  key={q.code}
                  onClick={() => doLogin(q.code, q.pin)}
                  className="flex items-center justify-between px-3 py-2.5 text-sm border border-pos-line rounded-xl text-pos-ink-2 hover:bg-pos-paper transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                      style={{ backgroundColor: q.color }}
                    >
                      {q.initial}
                    </span>
                    {`${t('login.role.' + q.role)} (${q.name})`}
                  </span>
                  <ArrowRight size={14} className="text-pos-ink-3" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
