/**
 * Maps Meta API error codes / error string patterns to merchant-friendly text.
 * Two languages: English and Bengali.
 *
 * Usage:
 *   import { getMetaErrorMessage } from '@/lib/meta/error-messages';
 *   const msg = getMetaErrorMessage(errorCode, rawMessage, 'bn');
 */

interface MetaErrorMapping {
  /** Meta error code (number) or substring pattern (string) in the raw message */
  match: number | string;
  en: string;
  bn: string;
}

const META_ERROR_MAPPINGS: MetaErrorMapping[] = [
  // Token / auth errors
  {
    match: 190,
    en: "Reconnect your page (security token expired)",
    bn: "পেজ পুনরায় সংযুক্ত করুন (সিকিউরিটি টোকেন মেয়াদ শেষ)",
  },
  {
    match: 200,
    en: "Easy Moderator needs message access — please re-authorize",
    bn: "Easy Moderator-এর মেসেজ অ্যাক্সেস দরকার — পুনরায় অনুমোদন করুন",
  },
  {
    match: 102,
    en: "Session token invalid. Please reconnect your Facebook page.",
    bn: "সেশন টোকেন অকার্যকর। Facebook পেজ পুনরায় সংযুক্ত করুন।",
  },
  // Page not found
  {
    match: 100,
    en: "We couldn't find that page. Did you switch business managers?",
    bn: "পেজটি খুঁজে পাওয়া যায়নি। Business Manager পরিবর্তন করেছেন?",
  },
  // Rate limiting
  {
    match: 4,
    en: "Too many requests to Meta. Wait a few minutes and try again.",
    bn: "Meta-তে অনেক বেশি request হয়েছে। কিছুক্ষণ অপেক্ষা করুন।",
  },
  {
    match: 17,
    en: "Daily message limit reached. Try again after midnight.",
    bn: "দৈনিক মেসেজ সীমা শেষ। মধ্যরাতের পরে আবার চেষ্টা করুন।",
  },
  // Permission errors (string patterns)
  {
    match: "token expired",
    en: "Reconnect your page (security token expired)",
    bn: "পেজ পুনরায় সংযুক্ত করুন (সিকিউরিটি টোকেন মেয়াদ শেষ)",
  },
  {
    match: "insufficient permission",
    en: "Easy Moderator needs message access — please re-authorize",
    bn: "Easy Moderator-এর মেসেজ অ্যাক্সেস দরকার — পুনরায় অনুমোদন করুন",
  },
  {
    match: "page not found",
    en: "We couldn't find that page. Did you switch business managers?",
    bn: "পেজটি খুঁজে পাওয়া যায়নি। Business Manager পরিবর্তন করেছেন?",
  },
  {
    match: "rate limit",
    en: "Too many requests to Meta. Wait a few minutes and try again.",
    bn: "Meta-তে অনেক বেশি request হয়েছে। কিছুক্ষণ অপেক্ষা করুন।",
  },
  {
    match: "revoked",
    en: "Page access revoked. Please reconnect.",
    bn: "পেজ অ্যাক্সেস বাতিল হয়েছে। পুনরায় সংযুক্ত করুন।",
  },
  {
    match: "disconnected",
    en: "Channel disconnected. Use the Reconnect button to restore.",
    bn: "চ্যানেল বিচ্ছিন্ন হয়েছে। Reconnect বাটন ব্যবহার করুন।",
  },
  {
    match: "webhook",
    en: "Webhook verification failed. Check your app settings in Meta App Dashboard.",
    bn: "Webhook যাচাই ব্যর্থ হয়েছে। Meta App Dashboard-এ সেটিংস চেক করুন।",
  },
];

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
    if (byCode) return byCode[lang];
  }

  // Try string pattern match against raw message
  if (rawMessage) {
    const lower = rawMessage.toLowerCase();
    const byString = META_ERROR_MAPPINGS.find(
      (m) => typeof m.match === "string" && lower.includes(m.match.toLowerCase())
    );
    if (byString) return byString[lang];
  }

  // Default fallback
  return lang === "bn"
    ? "কিছু একটা ভুল হয়েছে। পুনরায় সংযুক্ত করুন অথবা Support-এ যোগাযোগ করুন।"
    : "Something went wrong. Try reconnecting, or contact support.";
}
