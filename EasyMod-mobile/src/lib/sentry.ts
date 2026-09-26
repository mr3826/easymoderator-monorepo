/**
 * Thin Sentry RN interface.
 *
 * No real Sentry DSN or account is configured for Phase 1 — provisioning one is a human gate per
 * the mobile program's constraints (the same pattern as the Firebase gate documented in
 * `docs/mobile/CURRENT_STATE.md` §8), never something an agent sets up on its own. Every function
 * here is an inert no-op until `EXPO_PUBLIC_SENTRY_DSN` is set in the environment; call sites do
 * not need to change when that gate is later cleared — this file is the one place a real
 * `@sentry/react-native` `init` call would be added.
 */

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function isSentryConfigured(): boolean {
  return Boolean(dsn);
}

export function initSentry(): void {
  if (!dsn) return;
  // Intentionally not implemented: wiring a real `@sentry/react-native` `init({ dsn, ... })` call
  // requires the human-gated DSN above to actually exist. Left as a documented no-op.
}

const isDev = process.env.NODE_ENV !== 'production';

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!dsn) {
    if (isDev) {
      console.warn('[sentry:noop] captureException', error, context);
    }
    return;
  }
  // Real forwarding to Sentry happens here once a DSN is provisioned.
}

export function captureMessage(message: string, context?: Record<string, unknown>): void {
  if (!dsn) {
    if (isDev) {
      console.warn('[sentry:noop] captureMessage', message, context);
    }
    return;
  }
}
