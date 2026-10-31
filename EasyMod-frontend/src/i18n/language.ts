export type AppLanguage = "en" | "bn";

/** Read and write the saved locale without breaking the page when storage is blocked. */
export function readStoredLanguage(): AppLanguage | null {
  try {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem("easymod_lang");
    return value === "en" || value === "bn" ? value : null;
  } catch {
    return null;
  }
}

export function storeLanguage(language: AppLanguage): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem("easymod_lang", language);
  } catch {
    // Locale selection still applies for the current page when storage is unavailable.
  }
}

/** Return only the supported locale override; unrelated query parameters are ignored. */
export function readLanguageOverride(search: string): AppLanguage | null {
  const value = new URLSearchParams(search).get("lang");
  return value === "en" || value === "bn" ? value : null;
}

/** Keep a user's explicit locale choice stable if the current URL is refreshed. */
export function withLanguageOverride(href: string, language: AppLanguage): string {
  const url = new URL(href);
  url.searchParams.set("lang", language);
  return url.toString();
}
