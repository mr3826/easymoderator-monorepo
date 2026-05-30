'use strict';

/**
 * live-order-parser.js
 *
 * Pure, dependency-free extractor for live-selling comment-order intent.
 *
 * During FB/IG Live selling, comment storms are full of short purchase signals
 * ("nibo", "নিবো", "size M", "2 ta", "dam koto"). This parser detects whether a
 * comment expresses purchase intent and pulls out quantity / size when present,
 * so the comment-to-DM flow can capture the order and the DM can confirm it.
 *
 * Meta-policy note: this only changes WHICH comments are treated as a match (a
 * purchase-intent comment on the shop's OWN live, within the already-enabled
 * comment-to-DM flow). It does NOT touch the send path, rate limits, opt-out,
 * idempotency or the 24h window — so it stays SAFE under the 10-point checklist.
 */

// Banglish + Bengali + English purchase-intent signals. Matched as word-ish
// substrings against a normalized (lowercased) comment.
const INTENT_TOKENS = [
  // "will take / want it"
  'nibo', 'nibe', 'nebo', 'niba', 'নিবো', 'নিব', 'নেবো', 'নিবে',
  // "need"
  'lagbe', 'লাগবে', 'lagba',
  // "will buy"
  'kinbo', 'kinte', 'কিনবো', 'কিনব',
  // "want"
  'chai', 'চাই',
  // explicit order
  'order', 'অর্ডার', 'অডার',
  // price ask (softer intent, still a buying signal during a live)
  'dam', 'দাম', 'koto', 'কত', 'price', 'কত টাকা', 'koto taka',
  // availability ask
  'ache', 'আছে', 'stock', 'available',
  // "I want this one" deixis common in lives
  'eta', 'এটা', 'eita', 'এইটা',
];

// Size vocabulary → normalized size token
const SIZE_MAP = [
  [/\bxxl\b|\bdouble xl\b|\bডাবল\b/i, 'XXL'],
  [/\bxl\b|extra large|এক্সএল/i, 'XL'],
  [/\blarge\b|\bl\b|লার্জ|বড়/i, 'L'],
  [/\bmedium\b|\bm\b|মিডিয়াম|মাঝারি/i, 'M'],
  [/\bsmall\b|\bs\b|স্মল|ছোট/i, 'S'],
];

// Bengali → ASCII digit map for quantity parsing
const BN_DIGITS = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };

function bengaliToAsciiDigits(str) {
  return str.replace(/[০-৯]/g, (d) => BN_DIGITS[d] || d);
}

/**
 * Extract a quantity from the comment, e.g. "2 ta", "৩টি", "5 pcs", or a bare
 * leading number. Returns a positive integer or null.
 */
function extractQuantity(normalized) {
  const ascii = bengaliToAsciiDigits(normalized);
  // number directly followed by a quantity unit (ta/ti/pcs/pis/piece/pc)
  const unit = ascii.match(/(\d{1,3})\s*(ta|ti|pcs|pis|piece|pc|টা|টি|পিস)/i);
  if (unit) {
    const n = parseInt(unit[1], 10);
    if (n > 0 && n <= 999) return n;
  }
  // bare standalone number (avoid matching sizes/years — cap at 99)
  const bare = ascii.match(/\b(\d{1,2})\b/);
  if (bare) {
    const n = parseInt(bare[1], 10);
    if (n > 0 && n <= 99) return n;
  }
  return null;
}

/**
 * Extract a size token (S/M/L/XL/XXL) from the comment, or null.
 */
function extractSize(text) {
  for (const [re, size] of SIZE_MAP) {
    if (re.test(text)) return size;
  }
  return null;
}

/**
 * Parse purchase intent from a live-selling comment.
 *
 * @param {string} text - raw comment text
 * @param {string[]} [customKeywords] - extra shop-configured intent keywords
 * @returns {{ isPurchaseIntent: boolean, quantity: number|null, size: string|null, signals: string[] }}
 */
function parseLiveOrderIntent(text, customKeywords = []) {
  const empty = { isPurchaseIntent: false, quantity: null, size: null, signals: [] };
  if (!text || typeof text !== 'string') return empty;

  const normalized = text.toLowerCase().trim();
  if (!normalized) return empty;

  const tokens = INTENT_TOKENS.concat(
    Array.isArray(customKeywords) ? customKeywords.filter((k) => typeof k === 'string' && k.trim()) : []
  );

  const signals = [];
  for (const tok of tokens) {
    if (normalized.includes(tok.toLowerCase())) signals.push(tok);
  }

  const quantity = extractQuantity(normalized);
  const size = extractSize(normalized);

  // A bare quantity + size combo ("2 ta L") is itself a strong live-order signal
  // even without an explicit verb, which is common in fast live comment storms.
  const hasStructuredSignal = quantity !== null && size !== null;

  const isPurchaseIntent = signals.length > 0 || hasStructuredSignal;

  return {
    isPurchaseIntent,
    quantity,
    size,
    signals,
  };
}

module.exports = { parseLiveOrderIntent };
