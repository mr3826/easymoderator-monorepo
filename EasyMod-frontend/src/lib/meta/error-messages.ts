/**
 * Maps Meta API error codes / error string patterns to merchant-friendly text.
 * The user-facing copy is translated at CALL TIME via the i18n singleton so the
 * language always tracks the user's current selection (never frozen).
 *
 * Usage:
 *   import { getMetaErrorMessage } from '@/lib/meta/error-messages';
 *   const msg = getMetaErrorMessage(errorCode, rawMessage, 'bn');
 */
import i18n from "@/i18n";

interface MetaErrorMapping {
  /** Meta error code (number) or substring pattern (string) in the raw message */
  match: number | string;
  /** i18n key (under the `errors.meta.*` namespace) resolved at call time */
  key: string;
}

const META_ERROR_MAPPINGS: MetaErrorMapping[] = [
  // Token / auth errors
  { match: 190, key: "errors.meta.tokenExpired" },
  { match: 200, key: "errors.meta.needsMessageAccess" },
  { match: 102, key: "errors.meta.sessionInvalid" },
  // Page not found
  { match: 100, key: "errors.meta.pageNotFound" },
  // Rate limiting
  { match: 4, key: "errors.meta.tooManyRequests" },
  { match: 17, key: "errors.meta.dailyLimitReached" },
  // Permission errors (string patterns)
  { match: "token expired", key: "errors.meta.tokenExpired" },
  { match: "insufficient permission", key: "errors.meta.needsMessageAccess" },
  { match: "page not found", key: "errors.meta.pageNotFound" },
  { match: "rate limit", key: "errors.meta.tooManyRequests" },
  { match: "revoked", key: "errors.meta.accessRevoked" },
  { match: "disconnected", key: "errors.meta.channelDisconnected" },
  { match: "webhook", key: "errors.meta.webhookFailed" },
];

/** Normalised error extracted from an Axios error, regardless of backend shape. */
export interface ExtractedApiError {
  /** Numeric Meta error code, if the message carried one (e.g. "(#190) …"). */
  code: number | null;
  /** Raw backend/Meta error message — the actual reason a request failed. */
  message: string | null;
}

/**
 * Pull the real error message out of an Axios error, handling BOTH backend
 * response shapes:
 *   - thrown AppError       → { success:false, message, code }      (top level)
 *   - validate() middleware → { success:false, error:{ message, details:[…] } }
 *
 * The OAuth/connect flow used to discard this entirely and show a generic
 * "সংযোগ ব্যর্থ" toast, which made every connection failure impossible to
 * diagnose. Use this so the true reason reaches the screen and the console.
 */
export function extractMetaApiError(err: unknown): ExtractedApiError {
  const data = (err as { response?: { data?: unknown } })?.response?.data as
    | Record<string, unknown>
    | undefined;

  let message: string | null = null;

  if (data && typeof data === "object") {
    const nested = data.error as
      | { message?: unknown; details?: Array<{ message?: unknown }> }
      | undefined;

    if (nested && typeof nested === "object") {
      if (Array.isArray(nested.details) && nested.details.length > 0) {
        message =
          nested.details
            .map((d) => (typeof d?.message === "string" ? d.message : null))
            .filter(Boolean)
            .join("; ") || null;
      }
      if (!message && typeof nested.message === "string") message = nested.message;
    }

    if (!message && typeof data.message === "string") message = data.message as string;
  }

  // Fall back to the Axios error's own message (network errors etc.)
  if (!message) {
    const axiosMsg = (err as { message?: unknown })?.message;
    if (typeof axiosMsg === "string") message = axiosMsg;
  }

  // Meta embeds its numeric code in the text as "(#100) …" — recover it so the
  // code-based mappings below can match.
  let code: number | null = null;
  if (message) {
    const m = message.match(/\(#(\d+)\)/);
    if (m) code = Number(m[1]);
  }

  return { code, message };
}

/**
 * Returns a merchant-friendly error message for a Meta API error.
 * @param code - Numeric Meta error code (optional)
 * @param rawMessage - Raw error string from API (optional)
 * @param lang - 'bn' (default) or 'en'
 */
export function getMetaErrorMessage(
  code?: number | null,
  rawMessage?: string | null,
  lang: "bn" | "en" = "bn"
): string {
  // Try numeric code match first
  if (code != null) {
    const byCode = META_ERROR_MAPPINGS.find(
      (m) => typeof m.match === "number" && m.match === code
    );
    if (byCode) return i18n.t(byCode.key, { lng: lang });
  }

  // Try string pattern match against raw message
  if (rawMessage) {
    const lower = rawMessage.toLowerCase();
    const byString = META_ERROR_MAPPINGS.find(
      (m) => typeof m.match === "string" && lower.includes(m.match.toLowerCase())
    );
    if (byString) return i18n.t(byString.key, { lng: lang });
  }

  // Default fallback
  return i18n.t("errors.meta.fallback", { lng: lang });
}
