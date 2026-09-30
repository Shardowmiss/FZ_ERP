/**
 * 零依赖轻量 i18n（对齐 react-i18next 的 useTranslation 形态，便于后续平滑替换）。
 *
 * 设计要点：
 * - 未翻译的 key 自动回退到 zh-CN（中文），保证首轮上线无空白。
 * - 语种持久化到 localStorage（本机缓存）；个人级持久化（落库）由调用方在
 *   切换时主动调用后端接口，本模块保持与鉴权解耦。
 * - 默认语种 zh-CN；支持 zh-CN / en。
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { zhCN, type I18nKey } from './locales/zh-CN';
import { en } from './locales/en';

export type Locale = 'zh-CN' | 'en';

export const SUPPORTED_LOCALES: { code: Locale; label: string }[] = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: 'English' },
];

const LOCAL_STORAGE_KEY = 'erp_language';

const dictionaries: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN as Record<string, string>,
  en: en as Record<string, string>,
};

export type TFunction = (
  key: I18nKey | string,
  vars?: Record<string, string | number>,
) => string;

interface I18nContextValue {
  language: Locale;
  setLanguage: (lang: Locale) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function resolve(
  language: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const dict = dictionaries[language] ?? dictionaries['zh-CN'];
  // 当前语种缺失 → 回退中文；中文也缺失 → 返回 key 本身（避免空白/崩溃）
  let value = dict[key] ?? (zhCN as Record<string, string>)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return value;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Locale>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored === 'zh-CN' || stored === 'en') return stored;
    } catch {
      // ignore
    }
    return 'zh-CN';
  });

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, language);
    } catch {
      // ignore
    }
    // 同步 <html lang>，利于无障碍 / SEO
    document.documentElement.lang = language === 'zh-CN' ? 'zh-CN' : 'en';
  }, [language]);

  const setLanguage = useCallback((lang: Locale) => {
    setLanguageState(lang);
  }, []);

  const t = useCallback<TFunction>(
    (key, vars) => resolve(language, key, vars),
    [language],
  );

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

/**
 * 取 i18n 上下文。未挂载 Provider 时返回安全兜底，避免崩溃。
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      language: 'zh-CN',
      setLanguage: () => {},
      t: (key, vars) => resolve('zh-CN', key, vars),
    };
  }
  return ctx;
}

/** 便捷钩子：仅取翻译函数。 */
export const useT = (): TFunction => useI18n().t;
