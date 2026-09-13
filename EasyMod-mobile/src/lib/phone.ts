/**
 * Bangladeshi mobile number validation.
 *
 * The regex is copied verbatim from the web app (`EasyMod-frontend`) per
 * `docs/mobile/CURRENT_STATE.md` §12 / `MOBILE_PRODUCT_SPEC.md` §3, so mobile and web accept and
 * reject exactly the same set of numbers. It matches an 11-digit local number starting with `01`,
 * where the third digit is one of the currently-issued Bangladeshi mobile operator prefixes
 * (3 through 9) — no country code, no spaces or dashes.
 */
export const BD_PHONE_REGEX = /^01[3-9]\d{8}$/;

/** Strips spaces, dashes, and a leading `+880`/`880` country code before validating. */
export function normalizeBdPhone(input: string): string {
  const trimmed = input.trim().replace(/[\s-]/g, '');
  if (trimmed.startsWith('+880')) return `0${trimmed.slice(4)}`;
  if (trimmed.startsWith('880') && trimmed.length > 11) return `0${trimmed.slice(3)}`;
  return trimmed;
}

export function isValidBdPhone(input: string): boolean {
  if (typeof input !== 'string') return false;
  return BD_PHONE_REGEX.test(normalizeBdPhone(input));
}
