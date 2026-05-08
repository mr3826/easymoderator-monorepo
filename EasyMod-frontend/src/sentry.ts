import * as Sentry from '@sentry/react';

export const initSentry = (): void => {
  if (!import.meta.env.VITE_SENTRY_DSN) {
    if (import.meta.env.PROD) {
      console.warn('[Sentry] VITE_SENTRY_DSN not set — error tracking DISABLED in PRODUCTION');
    } else {
      console.info('[Sentry] VITE_SENTRY_DSN not set — error tracking disabled');
    }
    return;
  }

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 1.0,
  });
};
