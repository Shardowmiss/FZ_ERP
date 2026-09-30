import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@client/src/contexts/AuthContext';
import { toast } from 'sonner';
import { User, Lock, ShieldCheck, Building2, ScanFace } from 'lucide-react';
import { useT } from '@client/src/i18n';
import { LanguageSwitcher } from '@client/src/components/LanguageSwitcher';

// 品牌区指标使用真实产品事实（经审计的模块/页面/数据表规模），不编造经营数据。
const METRICS = [
  { value: '25', label: 'login.metrics.modules' },
  { value: '134', label: 'login.metrics.pages' },
  { value: '123', label: 'login.metrics.tables' },
];

const TRUSTS = [
  { icon: ShieldCheck, text: 'login.trust.compliance' },
  { icon: Building2, text: 'login.trust.private' },
  { icon: ScanFace, text: 'login.trust.sso' },
];

const Login = () => {
  const t = useT();
  const [username, setUsername] = useState(() => localStorage.getItem('erp_remember_user') ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => localStorage.getItem('erp_remember_user') !== null);
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
      // 记住我（本机）：仅记住用户名，绝不存储密码
      if (remember) localStorage.setItem('erp_remember_user', username);
      else localStorage.removeItem('erp_remember_user');
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

  const handleSso = () => {
    toast.info('正在唤起企业微信统一登录…');
  };

  return (
    <div className="relative min-h-screen flex flex-col lg:flex-row bg-[#0B1220]">
      {/* 语种切换（右上角，登录前也可选） */}
      <div className="absolute top-4 right-4 z-20">
        <LanguageSwitcher variant="inline" />
      </div>
      {/* 左：品牌叙事区（大气 / 朝气 / 稳重 / 专业） */}
      <div className="relative overflow-hidden lg:w-1/2 bg-gradient-to-br from-[#0B1220] via-[#0E1B3A] to-primary text-white flex flex-col justify-between p-8 lg:p-14">
        {/* 服装行业肌理：极淡衣架阵列 */}
        <svg
          className="absolute inset-0 w-full h-full opacity-[0.05] pointer-events-none"
          viewBox="0 0 400 400"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <g id="hanger">
              <path d="M20 0 V18 a18 18 0 0 1 36 0 V0" fill="none" stroke="#fff" strokeWidth="2" />
              <path d="M38 18 L70 70 H10 Z" fill="none" stroke="#fff" strokeWidth="2" />
            </g>
          </defs>
          {Array.from({ length: 7 }).map((_, r) =>
            Array.from({ length: 6 }).map((_, c) => (
              <use key={`${r}-${c}`} href="#hanger" x={c * 72} y={r * 64} />
            )),
          )}
        </svg>

        {/* 顶栏 logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8">
              <path d="M12 3 V8 a4 4 0 0 1 8 0 V3" />
              <path d="M20 8 L20 17 H4 L4 8" />
              <path d="M4 8 L12 14 L20 8" />
            </svg>
          </div>
          <div>
            <div className="text-lg font-bold tracking-wide">云裁</div>
            <div className="text-[11px] tracking-[0.22em] text-white/50">YUNCAI APPAREL ERP</div>
          </div>
        </div>

        {/* 中部叙事 */}
        <div className="relative z-10 max-w-md">
          <div className="inline-flex items-center gap-2 text-[#C9A227] text-xs font-medium mb-5">
            <span className="h-px w-6 bg-[#C9A227]" /> 服装产业一体化经营平台
          </div>
          <h1 className="text-3xl lg:text-[40px] lg:leading-tight font-extrabold">
            从设计到门店
            <br />
            全链路数字化
          </h1>
          <p className="mt-4 text-white/60 text-sm leading-relaxed">
            为服装零售企业提供设计、生产、供应链、渠道与财务的一体化协同，让每一件成衣的旅程都清晰、可控、可追溯。
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4">
            {METRICS.map((m) => (
              <div key={m.label}>
                <div className="text-2xl font-bold text-white">{m.value}</div>
                <div className="mt-1 text-xs text-white/55">{t(m.label)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 信任栏 */}
        <div className="relative z-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-white/55 text-xs">
          {TRUSTS.map((trust) => (
            <div key={trust.text} className="flex items-center gap-1.5">
              <trust.icon size={14} />
              <span>{t(trust.text)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 右：专业表单区 */}
      <div className="flex-1 lg:w-1/2 flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-foreground">欢迎登录</h2>
            <p className="text-sm text-muted-foreground mt-1.5">{t('login.subtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('login.username')}</label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('login.usernamePlaceholder')}
                  autoComplete="username"
                  className="w-full h-11 pl-9 pr-3 rounded-xl border border-input bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('login.password')}</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.passwordPlaceholder')}
                  autoComplete="current-password"
                  className="w-full h-11 pl-9 pr-3 rounded-xl border border-input bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-[#2563EB]"
                />
                {t('login.remember')}
              </label>
              <a className="text-sm text-primary hover:text-[#1D4ED8] transition-colors">{t('login.forgotPassword')}</a>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-primary hover:bg-[#1D4ED8] text-primary-foreground font-medium rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? `${t('login.submit')}…` : t('login.submit')}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> 或 <span className="h-px flex-1 bg-border" />
          </div>

          <button
            onClick={handleSso}
            className="w-full h-11 flex items-center justify-center gap-2 rounded-xl border border-border bg-card text-foreground hover:bg-accent transition-colors text-sm font-medium"
          >
            <ScanFace size={16} className="text-primary" /> {t('login.sso')}
          </button>

          {(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
            <div className="mt-6 text-center text-xs text-muted-foreground">{t('login.testAccount')}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
