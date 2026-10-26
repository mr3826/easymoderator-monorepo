import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import bn from './locales/bn.json';
import en from './locales/en.json';

const storedLanguage = typeof window !== 'undefined'
  && typeof window.localStorage?.getItem === 'function'
  ? window.localStorage.getItem('easymod_lang')
  : null;
const initialLanguage = storedLanguage || 'bn';

const syncDocumentLanguage = (language: string) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
};

i18n.on('languageChanged', syncDocumentLanguage);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: initialLanguage,
    resources: {
      bn: { translation: bn },
      en: { translation: en },
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
