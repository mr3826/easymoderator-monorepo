import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { GrowthAuthProvider } from '@/auth/GrowthAuthProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { GrowthShell } from '@/layout/GrowthShell';
import { AccessDeniedPage } from '@/pages/AccessDeniedPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SessionExpiredPage } from '@/pages/SessionExpiredPage';
import { UnauthorizedPage } from '@/pages/UnauthorizedPage';

export function App() {
  return (
    <ErrorBoundary>
      <GrowthAuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />
            <Route path="/access-denied" element={<AccessDeniedPage />} />
            <Route path="/session-expired" element={<SessionExpiredPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<GrowthShell />}>
                <Route index element={<DashboardPage />} />
              </Route>
            </Route>
            <Route path="/app" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </GrowthAuthProvider>
    </ErrorBoundary>
  );
}
