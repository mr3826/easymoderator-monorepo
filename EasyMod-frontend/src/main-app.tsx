import "./i18n";
import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { ErrorBoundary } from "./app/components/ErrorBoundary.tsx";
import { Toaster } from "sonner";
import "./styles/index.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./app/lib/queryClient";
import { registerServiceWorker } from "./app/lib/pushNotification";
import { initSentry } from "./sentry";

initSentry();
registerServiceWorker().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <App />
      {/* Keep merchant notices clear of the fixed bottom navigation on mobile. */}
      <Toaster
        position="top-center"
        offset={{ top: 72 }}
        mobileOffset={{ top: 64 }}
        richColors
        closeButton
        duration={3000}
      />
    </ErrorBoundary>
  </QueryClientProvider>
);
