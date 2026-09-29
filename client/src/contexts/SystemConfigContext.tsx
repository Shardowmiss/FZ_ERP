import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { systemApi } from '@client/src/api/system';
import type { SystemConfig } from '@shared/api.interface';

const DEFAULT_CONFIG: SystemConfig = {
  rememberTabs: true,
  defaultHomePage: 'dashboard',
  sidebarCollapsed: false,
  tablePageSize: 20,
  amountDecimals: 2,
  qtyDecimals: 2,
  autoSaveDraft: true,
  autoSaveInterval: 60,
  allowNegativeStock: false,
  allowEditAfterApproval: false,
  overDeliveryRatio: 0,
  retailAllowPriceEdit: true,
  lowStockAlert: true,
  pendingApprovalAlert: true,
  maxTabs: 10,
  uniqueCodeArchiveDays: 0,
};

interface ConfigContextType {
  config: SystemConfig;
  loading: boolean;
  refresh: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType | null>(null);

export const SystemConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfig] = useState<SystemConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await systemApi.config.get();
      setConfig(data);
    } catch {
      setConfig(DEFAULT_CONFIG);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <ConfigContext.Provider value={{ config, loading, refresh }}>
      {children}
    </ConfigContext.Provider>
  );
};

export const useSystemConfig = () => {
  const ctx = useContext(ConfigContext);
  return ctx ?? { config: DEFAULT_CONFIG, loading: false, refresh: async () => {} };
};
