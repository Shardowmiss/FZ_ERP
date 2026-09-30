/**
 * 语种切换器。
 *
 * - 切换即写入 localStorage（由 LanguageProvider 负责）并即时生效。
 * - 若已登录（有 token），同时调用后端接口把个人语种持久化到 user.language，
 *   实现「个人用户可在系统设置中单独配置语种」。未登录时仅本机生效。
 */
import { useState } from 'react';
import { Globe } from 'lucide-react';
import { useI18n, SUPPORTED_LOCALES, type Locale } from '@client/src/i18n';
import { useAuth } from '@client/src/contexts/AuthContext';
import { rbacApi } from '@client/src/api/rbac';

interface Props {
  /** menu：用于用户下拉菜单的整行样式；inline：用于登录页右上角的紧凑样式 */
  variant?: 'menu' | 'inline';
}

export function LanguageSwitcher({ variant = 'menu' }: Props) {
  const { language, setLanguage, t } = useI18n();
  const { isLoggedIn } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleChange = async (lang: Locale) => {
    if (lang === language) return;
    // 1) 本机即时生效
    setLanguage(lang);
    // 2) 登录态：持久化到个人偏好（落库 user.language）
    if (isLoggedIn) {
      setBusy(true);
      try {
        await rbacApi.updateMyLanguage(lang);
      } catch {
        // 落库失败不影响本机体验，仅记本地偏好
      } finally {
        setBusy(false);
      }
    }
  };

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-1.5 py-1 text-white/90">
        <Globe size={14} className="opacity-80" />
        {SUPPORTED_LOCALES.map((loc, idx) => (
          <span key={loc.code} className="flex items-center">
            {idx > 0 && <span className="mx-0.5 text-white/30">|</span>}
            <button
              type="button"
              onClick={() => handleChange(loc.code)}
              disabled={busy}
              className={`px-1 text-xs transition-colors ${
                language === loc.code
                  ? 'font-semibold text-white underline underline-offset-2'
                  : 'hover:text-white'
              }`}
            >
              {loc.code === 'zh-CN' ? '中' : 'EN'}
            </button>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="px-3 py-1.5 border-b border-gray-100">
      <div className="flex items-center gap-2 text-[11px] text-gray-400 mb-1">
        <Globe size={12} />
        {t('language.label')}
      </div>
      <div className="flex gap-1">
        {SUPPORTED_LOCALES.map((loc) => (
          <button
            key={loc.code}
            type="button"
            onClick={() => handleChange(loc.code)}
            disabled={busy}
            className={`flex-1 px-2 py-1 text-xs rounded border transition-colors ${
              language === loc.code
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {loc.label}
          </button>
        ))}
      </div>
    </div>
  );
}
