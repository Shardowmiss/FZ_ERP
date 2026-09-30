import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { rbacApi } from '@client/src/api/rbac';
import type { RbacUser, RbacPermission } from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { useI18n, type Locale } from '@client/src/i18n';

interface AuthContextType {
  user: RbacUser | null;
  menus: RbacPermission[];
  permissions: string[];
  isLoading: boolean;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (code: string) => boolean;
  hasMenu: (code: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'erp_auth_token';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<RbacUser | null>(null);
  const [menus, setMenus] = useState<RbacPermission[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { setLanguage } = useI18n();

  // 登录后应用个人语种偏好（user.language 落库值），实现「个人用户在系统设置中单独配置语种」
  useEffect(() => {
    const lang = user?.language;
    if (lang === 'zh-CN' || lang === 'en') {
      setLanguage(lang as Locale);
    }
  }, [user?.language, setLanguage]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      loadCurrentUser();
    } else {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCurrentUser = async () => {
    try {
      const res = await rbacApi.me();
      setUser(res.user);
      setMenus(res.menus);
      setPermissions(res.permissions);
    } catch (e) {
      logger.error('Failed to load current user', e);
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      setMenus([]);
      setPermissions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (username: string, password: string) => {
    const res = await rbacApi.login({ username, password });
    localStorage.setItem(TOKEN_KEY, res.token);
    setUser(res.user);
    setMenus(res.menus);
    setPermissions(res.permissions);
  };

  const logout = async () => {
    try {
      await rbacApi.logout();
    } catch (e) {
      // ignore
    }
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setMenus([]);
    setPermissions([]);
  };

  const hasPermission = (code: string) => {
    if (!user) return false;
    if (user.roleCodes?.includes('admin')) return true;
    return permissions.includes(code);
  };

  const hasMenu = (code: string) => {
    if (!user) return false;
    return permissions.includes(code);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        menus,
        permissions,
        isLoading,
        isLoggedIn: !!user,
        login,
        logout,
        hasPermission,
        hasMenu,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      user: null,
      menus: [],
      permissions: [],
      isLoading: false,
      isLoggedIn: false,
      login: async () => {},
      logout: async () => {},
      hasPermission: () => false,
      hasMenu: () => false,
    };
  }
  return ctx;
};
