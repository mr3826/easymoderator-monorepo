
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
import { isMarketingSurface } from "./app/lib/config";

// Initialise Sentry error tracking (no-op until VITE_SENTRY_DSN is set)
initSentry();

// The marketing site is public/acquisition-only; merchant push notifications
// and their service worker belong exclusively to app.easymod.tech.
if (!isMarketingSurface()) {
  registerServiceWorker().catch(() => {});
} else {
  document.head.querySelector('link[rel="manifest"]')?.remove();
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <App />
      {/* top-center, not bottom-*: DashboardLayout renders a `md:hidden fixed
          bottom-0` nav, and sonner only swaps to its mobile offset at 600px
          while that nav is visible up to 768px. Anchoring to the top avoids the
          collision at every width, and keeps the message out from under a thumb. */}
      <Toaster position="top-center" richColors closeButton duration={3000} />
    </ErrorBoundary>
  </QueryClientProvider>
);
