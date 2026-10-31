type LocaleData = { common: Record<string, unknown> } & Record<string, unknown>;

export function combineLocale<App extends LocaleData, Public extends LocaleData>(
  app: App,
  publicLocale: Public,
): Omit<App, keyof Public | "common"> & Omit<Public, "common"> & {
  common: App["common"] & Public["common"];
} {
  return {
    ...app,
    ...publicLocale,
    common: { ...app.common, ...publicLocale.common },
  } as Omit<App, keyof Public | "common"> & Omit<Public, "common"> & {
    common: App["common"] & Public["common"];
  };
}
