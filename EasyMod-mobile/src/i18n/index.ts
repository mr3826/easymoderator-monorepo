import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import bn from './locales/bn.json';

/**
 * `bn` (Bengali) is the default language (MOBILE_PRODUCT_SPEC.md §3), extending the web app's
 * existing translation key namespace (`CURRENT_STATE.md` §12) rather than starting a second one —
 * see `locales/en.json`/`locales/bn.json` for which keys are shared verbatim with
 * `EasyMod-frontend/src/i18n/locales/*.json` (common.*, auth.signin.*, nav.*, inbox.offlineBanner)
 * versus the new `mobile.*` namespace for strings that only exist on mobile (tab labels, the
 * offline-mutations banner, the error boundary fallback).
 *
 * `i18n.use(...)` below is i18next's real instance API (chaining a plugin before `.init()`), not
 * an accidental reference to the module's separately-exported named `use` function — hence the
 * disable comment on that line.
 */
// eslint-disable-next-line import/no-named-as-default-member
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    bn: { translation: bn },
  },
  lng: 'bn',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

export default i18n;
