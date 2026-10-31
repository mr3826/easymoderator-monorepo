type LocaleData = { common?: Record<string, unknown> } & Record<string, unknown>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep-merge the workspace (app) locale with the public funnel locale.
 * The app locale is authoritative for any key both define, so the authenticated
 * product keeps its approved production copy (e.g. `pricing.*`) while the public
 * bundle still contributes the keys only it defines (e.g. `publicFunnel.*`).
 */
function mergeAppFirst(
  app: Record<string, unknown>,
  pub: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...pub };
  for (const [key, appVal] of Object.entries(app)) {
    const pubVal = out[key];
    if (isPlainObject(appVal) && isPlainObject(pubVal)) {
      out[key] = mergeAppFirst(appVal, pubVal);
    } else {
      out[key] = appVal;
    }
  }
  return out;
}

export function combineLocale<App extends LocaleData, Public extends LocaleData>(
  app: App,
  publicLocale: Public,
): Omit<App, keyof Public | "common"> & Omit<Public, "common"> & {
  common: NonNullable<App["common"]> & NonNullable<Public["common"]>;
} {
  return mergeAppFirst(
    app as Record<string, unknown>,
    publicLocale as Record<string, unknown>,
  ) as Omit<App, keyof Public | "common"> & Omit<Public, "common"> & {
    common: NonNullable<App["common"]> & NonNullable<Public["common"]>;
  };
}
