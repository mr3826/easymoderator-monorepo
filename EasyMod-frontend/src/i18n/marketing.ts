import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import type { AppLanguage } from "./language";

const syncDocumentLanguage = (language: string) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = language === "bn" ? "bn" : "en";
  }
};

export function initializeMarketingI18n(
  initialLanguage: AppLanguage,
  resources: Awaited<ReturnType<typeof import("./publicLocale").loadPublicLocaleResources>>,
) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      lng: initialLanguage,
      resources: { [initialLanguage]: { translation: resources } },
      fallbackLng: false,
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage"],
        lookupLocalStorage: "easymod_lang",
        caches: ["localStorage"],
      },
    });

  syncDocumentLanguage(initialLanguage);
  i18n.on("languageChanged", syncDocumentLanguage);
}
