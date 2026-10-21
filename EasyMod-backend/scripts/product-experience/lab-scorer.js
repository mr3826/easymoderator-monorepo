'use strict';

const normalizeForMatch = value => String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)))
    .replace(/[_-]/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const responseContainsValue = (response, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(response || '').replace(/[\s,]/g, '').includes(String(value));
    }
    const normalizedResponse = normalizeForMatch(response);
    const normalizedValue = normalizeForMatch(value);
    if (!normalizedValue) return false;
    if (/^\d+(?:\.\d+)?$/.test(normalizedValue)) {
        return new RegExp(`(?:^|\\s)${normalizedValue.replace('.', '\\.')}($|\\s)`).test(normalizedResponse);
    }
    return normalizedResponse.includes(normalizedValue);
};

const stockDisposition = (response, expectedValue) => {
    const text = normalizeForMatch(response);
    const unavailable = /\b(out of stock|not available|unavailable|sold out)\b|স্টকে নেই|মজুদ নেই|পাওয়া যাবে না|পাওয়া যাবে না|স্টক নেই|বিক্রি শেষ/.test(text);
    const available = /\b(in stock|available|stock e ache|stock e ase)\b|স্টকে আছে|স্টকে রয়েছে|স্টকে রয়েছে|মজুদ আছে|পাওয়া যাবে|পাওয়া যাবে|উপলভ্য/.test(text);
    if (expectedValue === 'IN_STOCK') return available && !unavailable;
    if (expectedValue === 'OUT_OF_STOCK') return unavailable;
    return false;
};

const responseContainsFact = ({ response, field, expectedValue, alternateValues = [] }) => {
    if (['stock', 'variant_stock'].includes(field)) return stockDisposition(response, expectedValue);
    return [expectedValue, ...alternateValues].some(value => responseContainsValue(response, value));
};

module.exports = { normalizeForMatch, responseContainsValue, responseContainsFact };
