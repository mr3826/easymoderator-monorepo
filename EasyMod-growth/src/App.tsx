import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { GrowthAuthProvider } from '@/auth/GrowthAuthProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { GrowthShell } from '@/layout/GrowthShell';
import { GrowthUnavailablePage } from '@/pages/GrowthUnavailablePage';
import { AccessDeniedPage } from '@/pages/AccessDeniedPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProspectDetailPage } from '@/pages/ProspectDetailPage';
import { ProspectFormPage } from '@/pages/ProspectFormPage';
import { ProspectListPage } from '@/pages/ProspectListPage';
import { SessionExpiredPage } from '@/pages/SessionExpiredPage';
import { UnauthorizedPage } from '@/pages/UnauthorizedPage';
import { RequirePermission } from '@/components/RequirePermission';
import { PROSPECT_READ_PERMISSIONS } from '@/auth/usePermission';

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
            <Route path="/unavailable" element={<GrowthUnavailablePage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<GrowthShell />}>
                <Route index element={<DashboardPage />} />
                <Route element={<RequirePermission permission={PROSPECT_READ_PERMISSIONS} />}>
                  <Route path="prospects" element={<ProspectListPage />} />
                  <Route path="prospects/:prospectId" element={<ProspectDetailPage />} />
                </Route>
                <Route element={<RequirePermission permission="growth_os.prospects.manage_all" />}>
                  <Route path="prospects/new" element={<ProspectFormPage />} />
                </Route>
                <Route
                  element={(
                    <RequirePermission
                      permission={['growth_os.prospects.manage_all', 'growth_os.prospects.update_assigned']}
                    />
                  )}
                >
                  <Route path="prospects/:prospectId/edit" element={<ProspectFormPage />} />
                </Route>
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
