import type { ErrorKind } from '@/api/errors';

/**
 * Maps a `NormalizedError.kind` (ADR M-003, `@/api/errors.ts`) to the i18n key that already
 * carries its user-facing copy under `mobile.error.*` in `en.json`/`bn.json`. Every screen that
 * surfaces an API error goes through this instead of writing new inline error strings, so all nine
 * kinds stay covered by the one translated set and a future tenth kind fails loudly (TypeScript's
 * `Record<ErrorKind, string>` below is exhaustive) rather than silently falling through to nothing.
 */
const ERROR_I18N_KEY: Record<ErrorKind, string> = {
  network: 'mobile.error.network',
  timeout: 'mobile.error.timeout',
  unauthorized: 'mobile.error.unauthorized',
  forbidden: 'mobile.error.forbidden',
  notFound: 'mobile.error.notFound',
  validation: 'mobile.error.validation',
  rateLimited: 'mobile.error.rateLimited',
  server: 'mobile.error.server',
  unknown: 'mobile.error.unknown',
};

export function apiErrorMessageKey(kind: ErrorKind): string {
  return ERROR_I18N_KEY[kind] ?? ERROR_I18N_KEY.unknown;
}
