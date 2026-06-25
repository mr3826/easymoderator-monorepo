/**
 * Maps policy-engine deny reason strings/codes to merchant-friendly messages.
 * Keeps stack traces and internal codes out of the UI.
 *
 * Keys are substring/regex-matched (case-insensitive) against the raw error
 * message from the backend. First match wins. The user-facing copy is resolved
 * at CALL TIME via the i18n singleton so the language always tracks the user's
 * current selection (never frozen).
 */
import i18n from "@/i18n";

interface DenyMapping {
  /** Substring/regex that must appear in the raw error (case-insensitive) */
  match: string;
  /** i18n key (under the `policy.deny.*` namespace) resolved at call time */
  key: string;
}

const DENY_MAPPINGS: DenyMapping[] = [
  { match: "24h", key: "policy.deny.customerFirst24h" },
  { match: "24 hour", key: "policy.deny.customerFirst24h" },
  { match: "outside.*window", key: "policy.deny.windowExpired" },
  { match: "rate limit", key: "policy.deny.dailyLimitReached" },
  { match: "opt.?out", key: "policy.deny.optedOut" },
  { match: "consent", key: "policy.deny.noConsent" },
  { match: "policy", key: "policy.deny.blockedByPolicy" },
  { match: "token", key: "policy.deny.connectionExpired" },
  { match: "permission", key: "policy.deny.missingPermission" },
  { match: "block", key: "policy.deny.pageBlocked" },
];

/**
 * Returns a merchant-friendly message for a policy deny error.
 * @param rawError - The raw error string from the backend/API response.
 * @param lang - 'bn' (default) or 'en'
 */
export function getDenyMessage(rawError: string, lang: "bn" | "en" = "bn"): string {
  const lower = rawError.toLowerCase();
  for (const mapping of DENY_MAPPINGS) {
    const pattern = new RegExp(mapping.match, "i");
    if (pattern.test(lower)) {
      return i18n.t(mapping.key, { lng: lang });
    }
  }
  // Default fallback
  return i18n.t("policy.deny.fallback", { lng: lang });
}
