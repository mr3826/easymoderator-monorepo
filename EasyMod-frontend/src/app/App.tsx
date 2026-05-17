import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { apiClient } from "@/api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "../features/auth/AuthProvider";
import { useAuthHttpShopId } from "@/shared/lib/http";
import PageLoader from "./components/PageLoader";

function AppContent() {
  useAuthHttpShopId();

  return (
    <ErrorBoundary>
      {/* fallbackElement: shown while the initial route loader (publicLoader /
          protectedLoader) is awaiting authService.ensureInitialized(). Without
          this, React Router renders nothing (blank white screen) for the ~0.5–8 s
          window while the /me check + optional refresh cycle completes. */}
      <RouterProvider router={router} fallbackElement={<PageLoader />} />
    </ErrorBoundary>
  );
}

export default function App() {
  useEffect(() => {
    void apiClient.initCsrfToken();
  }, []);

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
