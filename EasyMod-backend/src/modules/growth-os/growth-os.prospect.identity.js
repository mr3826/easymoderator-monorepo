'use strict';

function normalizePhone(value) {
  if (value === undefined || value === null) return null;
  const digits = String(value).normalize('NFKC').replace(/\D/g, '');
  if (!digits) return null;

  let canonicalDigits = digits;
  if (canonicalDigits.startsWith('00880')) canonicalDigits = canonicalDigits.slice(2);
  else if (canonicalDigits.startsWith('880')) canonicalDigits = canonicalDigits;
  else if (canonicalDigits.startsWith('88')) canonicalDigits = `880${canonicalDigits.slice(2)}`;
  else if (canonicalDigits.startsWith('0')) canonicalDigits = `880${canonicalDigits.slice(1)}`;
  else canonicalDigits = `880${canonicalDigits}`;

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
