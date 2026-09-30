import React from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { OfflineProvider } from './contexts/OfflineContext';
import { AuthProvider } from './contexts/AuthContext';
import { LanguageProvider } from './i18n';
import RequireAuth from './components/RequireAuth';
import Layout from './components/Layout';
import NotFound from './pages/NotFound/NotFound';
import LoginPage from './pages/LoginPage/LoginPage';
import PosPage from './pages/PosPage/PosPage';
import ReturnPage from './pages/ReturnPage/ReturnPage';
import MembersPage from './pages/MembersPage/MembersPage';
import PromotionsPage from './pages/PromotionsPage/PromotionsPage';
import InventoryPage from './pages/InventoryPage/InventoryPage';
import ShiftPage from './pages/ShiftPage/ShiftPage';
import DashboardPage from './pages/DashboardPage/DashboardPage';
import OmnichannelPage from './pages/OmnichannelPage/OmnichannelPage';
import ErpSyncPage from './pages/ErpSyncPage/ErpSyncPage';
import SettingsPage from './pages/SettingsPage/SettingsPage';
import { STORE_ID } from './lib/store';

const RoutesComponent = () => {
  return (
    <LanguageProvider>
      <AuthProvider>
      <Routes>
        {/* 登录页不受守卫限制 */}
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <RequireAuth>
              <OfflineProvider storeId={STORE_ID}>
                <Layout />
              </OfflineProvider>
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/pos" replace />} />
          {/* 收银员及以上可访问 */}
          <Route path="pos" element={<PosPage />} />
          <Route path="return" element={<ReturnPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="promotions" element={<PromotionsPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="omnichannel" element={<OmnichannelPage />} />
          {/* 店长及以上可访问（交接班 / 设置 / 库存 / ERP 同步） */}
          <Route path="shift" element={<RequireAuth role="manager"><ShiftPage /></RequireAuth>} />
          <Route path="settings" element={<RequireAuth role="manager"><SettingsPage /></RequireAuth>} />
          <Route path="inventory" element={<RequireAuth role="manager"><InventoryPage /></RequireAuth>} />
          <Route path="erp-sync" element={<RequireAuth role="supervisor"><ErpSyncPage /></RequireAuth>} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      </AuthProvider>
    </LanguageProvider>
  );
};

export default RoutesComponent;
