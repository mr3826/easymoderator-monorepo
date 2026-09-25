import { apiErrorMessageKey } from './api-error-i18n';
import i18n from '@/i18n';
import type { ErrorKind } from '@/api/errors';

const ALL_KINDS: ErrorKind[] = [
  'network',
  'timeout',
  'unauthorized',
  'forbidden',
  'notFound',
  'validation',
  'rateLimited',
  'server',
  'unknown',
];

describe('apiErrorMessageKey', () => {
  it.each(ALL_KINDS)('maps "%s" to an existing, non-empty mobile.error.* translation in both locales', (kind) => {
    const key = apiErrorMessageKey(kind);
    expect(key).toBe(`mobile.error.${kind}`);

    for (const lng of ['en', 'bn']) {
      const translated = i18n.getFixedT(lng)(key);
      // i18next returns the key itself when a translation is missing — this proves the key
      // actually resolves to real copy in both locales, not just that the mapper ran.
      expect(translated).not.toBe(key);
      expect(translated.length).toBeGreaterThan(0);
    }
  });
});
