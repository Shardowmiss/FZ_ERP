/**
 * POS 语种切换器。
 * - 从 i18n Provider 读取/设置当前语种（同时写入 localStorage，刷新保持）；
 * - syncFromBackend=true 时（设置页）会与后端当前员工已保存语种同步，
 *   并把变更持久化到 pos_employee.language，实现「个人独立配置、跨设备保持」。
 */
import { useEffect, useState } from 'react';
import { useI18n, SUPPORTED_LOCALES } from '@client/src/i18n';
import { getMe, updateMyLanguage } from '@client/src/api/settings';
import { useT } from '@client/src/i18n';

interface Props {
  /** 是否在挂载时从后端同步、并把变更写回后端（设置页用，需已登录） */
  syncFromBackend?: boolean;
  className?: string;
}

export default function LanguageSwitcher({ syncFromBackend = false, className }: Props) {
  const { language, setLanguage } = useI18n();
  const t = useT();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!syncFromBackend) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await getMe();
        if (!cancelled && me?.language && me.language !== language) {
          setLanguage(me.language as 'zh-CN' | 'en');
        }
      } catch {
        // 未登录 / 令牌失效时静默：以本地 localStorage 为准
      }
    })();
    return () => {
      cancelled = true;
    };
    // 仅在挂载时同步一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = async (next: string) => {
    setLanguage(next as 'zh-CN' | 'en');
    if (!syncFromBackend) return;
    setSaving(true);
    try {
      await updateMyLanguage(next);
    } catch {
      // 持久化失败不阻断前端切换（本地仍生效）
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <span className="text-sm text-pos-ink-2">{t('language.label')}</span>
      <select
        value={language}
        disabled={saving}
        onChange={(e) => handleChange(e.target.value)}
        className="h-9 rounded-lg border border-pos-line bg-white px-2 text-sm text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-2 focus:ring-pos-accent/20"
      >
        {SUPPORTED_LOCALES.map((loc) => (
          <option key={loc.code} value={loc.code}>
            {loc.label}
          </option>
        ))}
      </select>
      {saving && <span className="text-xs text-pos-ink-3">{t('language.saving')}</span>}
    </div>
  );
}
