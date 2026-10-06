import React, { useCallback, useEffect } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { logger } from '@lark-apaas/client-toolkit/logger';

import '@client/src/api/request-interceptor';

import { AuthProvider } from './contexts/AuthContext';
import { TabsProvider } from './contexts/TabsContext';
import { SystemConfigProvider } from './contexts/SystemConfigContext';
import { LanguageProvider } from './i18n';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/Login/Login';
import ForbiddenPage from './pages/Forbidden/Forbidden';
import WelcomePage from './pages/Welcome/WelcomePage';
import NotFound from './pages/NotFound/NotFound';
import UniqueCodePublicTracePage from './pages/inventory/UniqueCodeTracePage';
import { routeComponents } from '@client/src/config/menuConfig';


function useGlobalErrorHandler() {
  useEffect(() => {
    const RELOAD_KEY = '__global_error_reload_count';
    const MAX_RELOADS = 2;
    const DOM_KEYWORDS = [
      'removeChild',
      'Failed to execute',
      'NotFoundError',
      'The node to be removed',
      'The node before which',
      'appendChild',
      'insertBefore',
      'contains the source',
      'Failed to set',
      'hydrat',
    ];

    function isDomError(msg: string): boolean {
      return DOM_KEYWORDS.some((kw) => msg.includes(kw));
    }

    function getCount(): number {
      try {
        return Number(sessionStorage.getItem(RELOAD_KEY) || '0');
      } catch {
        return 0;
      }
    }

    function increment(): void {
      try {
        sessionStorage.setItem(RELOAD_KEY, String(getCount() + 1));
      } catch {
        // ignore
      }
    }

    function maybeReload(message: string): boolean {
      if (!isDomError(message)) return false;
      const count = getCount();
      if (count >= MAX_RELOADS) return false;
      increment();
      logger.error(
        `[GlobalErrorHandler] DOM error, reloading (${count + 1}/${MAX_RELOADS}): ${message}`,
      );
      window.location.reload();
      return true;
    }

    function handleError(event: ErrorEvent): void {
      const msg = event.message || '';
      const isKeyUndefined =
        (msg.includes('key') && msg.includes('length') && msg.includes('undefined')) ||
        /Cannot read properties of undefined.*\bkey\b.*length/.test(msg) ||
        /key\.length.*undefined/.test(msg);
      if (isKeyUndefined) {
        logger.error(`[GlobalErrorHandler] Suppressed key.undefined error: ${msg}`);
        event.preventDefault();
        return;
      }
      maybeReload(msg);
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent): void {
      const reason = event.reason;
      const msg =
        reason?.message || (typeof reason === 'string' ? reason : String(reason || ''));
      maybeReload(msg);
    }

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);
}

const protectedWith = (
  element: React.ReactNode,
  permission?: string,
): React.ReactElement => (
  <ProtectedRoute permission={permission}>{element}</ProtectedRoute>
);

const generatedRoutes: React.ReactElement[] = (() => {
  const list = Object.entries(routeComponents).map(([path, entry]) => (
    <Route key={path} path={path.slice(1)} element={protectedWith(<entry.component />, entry.permission)} />
  ));
  const edit = Object.entries(routeComponents)
    .filter(([, e]) => e.edit)
    .flatMap(([path, entry]) => {
      const base = path.slice(1);
      const EditComp = React.lazy(entry.edit!);
      const perm = entry.permission;
      return [
        <Route key={`${base}/new`} path={`${base}/new`} element={protectedWith(<EditComp />, perm)} />,
        <Route key={`${base}/:id/edit`} path={`${base}/:id/edit`} element={protectedWith(<EditComp />, perm)} />,
      ];
    });
  return [...list, ...edit];
})();
const RoutesComponent = () => {
  useGlobalErrorHandler();
  return (
    <LanguageProvider>
    <AuthProvider>
    <SystemConfigProvider>
      <ErrorBoundary
        onError={(error: Error) => {
          const msg = error.message || '';
          const name = error.name || '';
          const domErrorKeywords = [
            'removeChild',
            'Failed to execute',
            'NotFoundError',
            'The node to be removed',
            'The node before which',
            'appendChild',
            'insertBefore',
            'contains the source',
            'Failed to set',
            'hydrat',
          ];
          const isDomError = domErrorKeywords.some(
            (kw: string) => msg.includes(kw) || name.includes(kw),
          );
          if (!isDomError) return;

          logger.error(
            `[ErrorBoundary] DOM reconciliation error: ${msg}\nComponent stack: ${(error as Error & { componentStack?: string }).componentStack || 'N/A'}\nJS stack: ${error.stack || 'N/A'}`,
          );

          const STORAGE_KEY = '__error_reload_count';
          const MAX_RETRIES = 2;
          let count = 0;
          try {
            const stored = window.sessionStorage.getItem(STORAGE_KEY);
            if (stored) count = parseInt(stored, 10) || 0;
          } catch {
            // sessionStorage unavailable, skip auto-reload
            return;
          }

          if (count >= MAX_RETRIES) return;

          logger.error(
            `[ErrorBoundary] DOM reconciliation error detected (retry ${count + 1}/${MAX_RETRIES}), reloading page: ${msg}`,
          );

          try {
            window.sessionStorage.setItem(STORAGE_KEY, String(count + 1));
          } catch {
            // ignore
          }
          window.location.reload();
        }}
        fallbackRender={({ error, resetErrorBoundary }) => (
          <div style={{
            padding: 24,
            background: '#fff',
            minHeight: '100vh',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 99999,
            position: 'relative',
          }}>
            <h1 style={{ color: '#dc2626', fontSize: 20, marginBottom: 12, fontWeight: 600 }}>
              Render Error - Debug Info
            </h1>
            <p style={{ marginBottom: 8 }}><strong>Message:</strong> {(error as Error).message}</p>
            <p style={{ marginBottom: 8 }}><strong>Name:</strong> {(error as Error).name}</p>
            <div style={{ marginTop: 16 }}>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>Component Stack:</p>
              <pre style={{
                background: '#f3f4f6',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                overflow: 'auto',
                maxHeight: 300,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                {(error as Error & { componentStack?: string }).componentStack || 'N/A'}
              </pre>
            </div>
            <div style={{ marginTop: 16 }}>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>JS Stack:</p>
              <pre style={{
                background: '#f3f4f6',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                overflow: 'auto',
                maxHeight: 300,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                {(error as Error).stack || 'N/A'}
              </pre>
            </div>
            <button
              onClick={resetErrorBoundary}
              style={{
                marginTop: 20,
                padding: '8px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Try Again
            </button>
          </div>
        )}
      >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/403" element={<ForbiddenPage />} />
        {/*
         * 公开溯源页：消费者 / 门店扫码直达，无需登录。
         * 必须置于 ProtectedRoute 之外（与 /login 同级），否则会被鉴权拦截。
         * 对应后端 @Public() 的 GET /api/trace-public/:code 与 /api/trace-public/qr/:code。
         */}
        <Route path="/trace/:code" element={<UniqueCodePublicTracePage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <TabsProvider>
                <Layout />
              </TabsProvider>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route
            path="welcome"
            element={protectedWith(<WelcomePage />)}
          />
          {generatedRoutes}
          </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      </ErrorBoundary>
    </SystemConfigProvider>
    </AuthProvider>
    </LanguageProvider>
  );
};

export default RoutesComponent;
