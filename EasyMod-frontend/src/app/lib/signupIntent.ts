export const GROWTH_UPGRADE_INTENT = "growth-upgrade" as const;

export function isGrowthUpgradeIntent(params: URLSearchParams): boolean {
  const intents = params.getAll("intent");
  return intents.length === 1 && intents[0] === GROWTH_UPGRADE_INTENT;
}

/**
 * Signup accepts only one fixed continuation. Arbitrary return URLs and
 * unknown/duplicate intent values always return to the merchant dashboard.
 */
export function getSignupSuccessPath(params: URLSearchParams, fallbackLocale: string): string {
  if (!isGrowthUpgradeIntent(params)) return "/dashboard";

  const requestedLocale = params.get("lang");
  const locale = requestedLocale === "bn" || requestedLocale === "en"
    ? requestedLocale
    : fallbackLocale === "bn" ? "bn" : "en";

  return `/subscription?intent=${GROWTH_UPGRADE_INTENT}&lang=${locale}`;
}
