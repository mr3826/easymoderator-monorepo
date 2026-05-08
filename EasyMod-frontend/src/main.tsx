
import './i18n';
import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { ErrorBoundary } from "./app/components/ErrorBoundary.tsx";
import { Toaster } from "sonner";
import "./styles/index.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./app/lib/queryClient";
import { registerServiceWorker } from "./app/lib/pushNotification";
import { initSentry } from "./sentry";

// Initialise Sentry error tracking (no-op until VITE_SENTRY_DSN is set)
initSentry();

// Register service worker for push notifications (non-blocking)
registerServiceWorker().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <App />
      <Toaster position="bottom-right" richColors closeButton duration={3000} />
    </ErrorBoundary>
  </QueryClientProvider>
);
  