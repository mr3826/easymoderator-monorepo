'use strict';

function normalizePhone(value) {
  if (value === undefined || value === null) return null;
  const digits = String(value).normalize('NFKC').replace(/\D/g, '');
  if (!digits) return null;

  // ponytail: this Bangladesh-default heuristic should be replaced with a real
  // E.164 parser before the prospect pool becomes multi-country.
  let canonicalDigits = digits;
  const bdLocal = /^0(?:1\d{9}|[2-9]\d{8})$/.test(digits);
  const bdCountry = /^880(?:1\d{9}|[2-9]\d{8})$/.test(digits);
  const bdShortCountry = /^88(?:1\d{9}|[2-9]\d{8})$/.test(digits);
  const bdInternational = /^00880(?:1\d{9}|[2-9]\d{8})$/.test(digits);
  if (bdLocal) canonicalDigits = `880${digits.slice(1)}`;
  else if (bdCountry) canonicalDigits = digits;
  else if (bdShortCountry) canonicalDigits = `880${digits.slice(2)}`;
  else if (bdInternational) canonicalDigits = digits.slice(2);

  return `+${canonicalDigits}`;
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizePage(value) {
  if (typeof value !== 'string') return null;
  let normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  normalized = normalized.replace(/^https?:\/\//, '').replace(/^\/\//, '');
  normalized = normalized.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  normalized = normalized.replace(/^www\./, '').replace(/^m\.facebook\.com(?=\/|$)/, 'facebook.com');
  return normalized;
}

function normalizeBusinessName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function normalizeIdentity({
  business_name = null,
  businessName = null,
  contact_phone = null,
  contactPhone = null,
  contact_email = null,
  contactEmail = null,
  page_url = null,
  pageUrl = null,
} = {}) {
  return {
    normalized_business_name: normalizeBusinessName(business_name ?? businessName),
    normalized_phone: normalizePhone(contact_phone ?? contactPhone),
    normalized_email: normalizeEmail(contact_email ?? contactEmail),
    normalized_page: normalizePage(page_url ?? pageUrl),
  };
}

function hasChannel(identity = {}) {
  return Boolean(identity.normalized_phone || identity.normalized_email || identity.normalized_page);
}

module.exports = {
  normalizePhone,
  normalizeEmail,
  normalizePage,
  normalizeBusinessName,
  normalizeIdentity,
  hasChannel,
};
