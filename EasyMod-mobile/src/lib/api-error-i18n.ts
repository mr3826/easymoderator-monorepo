import type { ErrorKind } from '@/api/errors';

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
