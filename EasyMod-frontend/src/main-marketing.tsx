import { createRoot } from "react-dom/client";
import PublicApp from "./app/PublicApp";
import { ErrorBoundary } from "./app/components/ErrorBoundary";
import { initializeMarketingI18n } from "./i18n/marketing";
import type { AppLanguage } from "./i18n/language";
import "./styles/index.css";

if (import.meta.env.VITE_SENTRY_DSN) {
  void import("./sentry").then(({ initSentry }) => initSentry());
}

export function startMarketing(
  language: AppLanguage,
  resources: Awaited<ReturnType<typeof import("./i18n/publicLocale").loadPublicLocaleResources>>,
) {
  initializeMarketingI18n(language, resources);
  createRoot(document.getElementById("root")!).render(<ErrorBoundary><PublicApp /></ErrorBoundary>);
}
