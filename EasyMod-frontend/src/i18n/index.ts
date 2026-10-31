import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import bn from './locales/bn.json';
import en from './locales/en.json';
import bnPublic from './locales/public/bn.json';
import enPublic from './locales/public/en.json';
import { readLanguageOverride, readStoredLanguage, storeLanguage } from './language';
import { combineLocale } from './combineLocale';

const languageOverride = typeof window !== 'undefined' ? readLanguageOverride(window.location?.search || '') : null;

if (languageOverride) storeLanguage(languageOverride);

const storedLanguage = readStoredLanguage();
const initialLanguage = languageOverride || storedLanguage || 'bn';

const syncDocumentLanguage = (language: string) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language.toLowerCase().startsWith('bn') ? 'bn' : 'en';
  }
};

i18n.on('languageChanged', syncDocumentLanguage);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: initialLanguage,
    resources: {
      bn: { translation: combineLocale(bn, bnPublic) },
      en: { translation: combineLocale(en, enPublic) },
    },
    fallbackLng: 'bn',
    interpolation: {
      escapeValue: false, // React handles XSS
    },
    detection: {
      order: ['localStorage'],
      lookupLocalStorage: 'easymod_lang',
      caches: ['localStorage'],
    },
  })
  .then(() => {
    syncDocumentLanguage(i18n.resolvedLanguage || i18n.language || 'bn');
  });

export default i18n;
