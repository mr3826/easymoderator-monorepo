/**
 * Maps policy-engine deny reason strings/codes to merchant-friendly messages.
 * Keeps stack traces and internal codes out of the UI.
 *
 * Keys are substring-matched (case-insensitive) against the raw error message
 * from the backend. First match wins.
 */

interface DenyMapping {
  /** Substring that must appear in the raw error (case-insensitive) */
  match: string;
  /** English merchant-friendly message */
  en: string;
  /** Bengali merchant-friendly message */
  bn: string;
}

const DENY_MAPPINGS: DenyMapping[] = [
  {
    match: "24h",
    en: "Customer must message first within 24 hours (Meta policy)",
    bn: "কাস্টমার আগে মেসেজ করতে হবে — ২৪ ঘন্টার মধ্যে (Meta নীতি)",
  },
  {
    match: "24 hour",
    en: "Customer must message first within 24 hours (Meta policy)",
    bn: "কাস্টমার আগে মেসেজ করতে হবে — ২৪ ঘন্টার মধ্যে (Meta নীতি)",
  },
  {
    match: "outside.*window",
    en: "Messaging window expired. Use a message tag (e.g. Post-Purchase Update) to continue.",
    bn: "মেসেজিং উইন্ডো শেষ। Message tag ব্যবহার করুন (যেমন: Post-Purchase Update)।",
  },
  {
    match: "rate limit",
    en: "Daily message limit reached. Try again after midnight.",
    bn: "দৈনিক মেসেজ সীমা শেষ। মধ্যরাতের পরে আবার চেষ্টা করুন।",
  },
  {
    match: "opt.?out",
    en: "Customer has opted out of messages. Respect their choice.",
    bn: "কাস্টমার মেসেজ বন্ধ করেছেন। তাদের সিদ্ধান্ত মানতে হবে।",
  },
  {
    match: "consent",
    en: "Customer consent not found. They must message you first.",
    bn: "কাস্টমারের সম্মতি পাওয়া যায়নি। তাদের আগে মেসেজ করতে হবে।",
  },
  {
    match: "policy",
    en: "Message blocked by platform policy. Check Meta's messaging guidelines.",
    bn: "Meta নীতি অনুযায়ী মেসেজ ব্লক হয়েছে।",
  },
  {
    match: "token",
    en: "Channel connection expired. Please reconnect your Facebook/Instagram page.",
    bn: "চ্যানেল সংযোগ মেয়াদ শেষ। Facebook/Instagram page পুনরায় সংযুক্ত করুন।",
  },
  {
    match: "permission",
    en: "Missing permission to send messages. Re-authorize Easy Moderator.",
    bn: "মেসেজ পাঠানোর অনুমতি নেই। Easy Moderator পুনরায় অনুমোদন করুন।",
  },
  {
    match: "block",
    en: "Customer may have blocked the page. You cannot send messages to them.",
    bn: "কাস্টমার হয়তো পেজ ব্লক করেছেন। তাদের মেসেজ পাঠানো সম্ভব নয়।",
  },
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
      return mapping[lang];
    }
  }
  // Default fallback
  return lang === "bn"
    ? "মেসেজ পাঠানো যায়নি। সংযোগ চেক করুন অথবা Support এ যোগাযোগ করুন।"
    : "Message could not be sent. Check your connection or contact support.";
}
