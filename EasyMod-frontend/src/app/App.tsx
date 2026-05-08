import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { apiClient } from "@/api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "../features/auth/AuthProvider";
import { useAuthHttpShopId } from "@/shared/lib/http";

function AppContent() {
  useAuthHttpShopId();

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
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
