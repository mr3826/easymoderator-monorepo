import type { AppLanguage } from "./language";

const localeLoaders = {
  en: () => import("./locales/public/en.json"),
  bn: () => import("./locales/public/bn.json"),
} satisfies Record<AppLanguage, () => Promise<{ default: object }>>;

export async function loadPublicLocaleResources(language: AppLanguage) {
  return (await localeLoaders[language]()).default;
}

export async function ensurePublicLocaleResources(
  instance: {
    hasResourceBundle: (language: string, namespace: string) => boolean;
    addResourceBundle: (language: string, namespace: string, resources: object, deep?: boolean, overwrite?: boolean) => void;
  },
  language: AppLanguage,
) {
  if (instance.hasResourceBundle(language, "translation")) return;
  const resources = await loadPublicLocaleResources(language);
  instance.addResourceBundle(language, "translation", resources, true, true);
}
