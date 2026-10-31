import { isMarketingSurface } from "./app/lib/config";
import { readLanguageOverride, readStoredLanguage, storeLanguage } from "./i18n/language";

if (isMarketingSurface()) {
  // Marketing pages do not need the authenticated merchant workspace bundle.
  document.head.querySelector('link[rel="manifest"]')?.remove();
  const languageOverride = readLanguageOverride(window.location.search);
  if (languageOverride) storeLanguage(languageOverride);
  const language = languageOverride || readStoredLanguage() || "bn";
  void Promise.all([
    import("./main-marketing"),
    import("./i18n/publicLocale").then(({ loadPublicLocaleResources }) => loadPublicLocaleResources(language)),
  ]).then(([marketing, resources]) => marketing.startMarketing(language, resources)).catch(() => {
    const root = document.getElementById("root");
    if (root) root.textContent = "EasyModerator pages could not load. Refresh to try again.";
  });
} else {
  void import("./main-app");
}
