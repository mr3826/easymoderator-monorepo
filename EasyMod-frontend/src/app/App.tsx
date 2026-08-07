import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { apiClient } from "@/api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "../features/auth/AuthProvider";
import { useAuthHttpShopId } from "@/shared/lib/http";
import { isMarketingSurface } from "./lib/config";

function AppContent() {
  useAuthHttpShopId();

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}

function PublicContent() {
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}

export default function App() {
  const marketingSurface = isMarketingSurface();

  useEffect(() => {
    if (!marketingSurface) void apiClient.initCsrfToken();
  }, [marketingSurface]);

  if (marketingSurface) return <PublicContent />;

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
