'use strict';

/**
 * Tests for src/utils/validators/phone.validator.js
 *
 * TDD — written before/alongside the consolidation of scattered BD phone regexes.
 * Covers: validatePhone, normalizePhone, extractMobile, toInternationalFormat,
 *         getOperator, regex exports, and edge cases.
 */

const {
  VALIDATORS,
  validatePhone,
  normalizePhone,
  extractMobile,
  toInternationalFormat,
  getOperator,
  bdMobileRegex,
  bdMobileStrictRegex,
  bdLandlineRegex
} = require('../phone.validator');

// ---------------------------------------------------------------------------
// validatePhone
// ---------------------------------------------------------------------------
describe('validatePhone', () => {
  describe('BD_MOBILE (default — accepts +88 prefix)', () => {
    const valid = [
      '01712345678',
      '01312345678',
      '01512345678',
      '01612345678',
      '01912345678',
      '+8801712345678',
      '8801712345678'
    ];
    const invalid = [
      '',
      null,
      undefined,
      '0201234567',   // starts with 02 (not mobile)
      '01212345678',  // operator 2 not valid
      '001712345678', // double 0
      'ABCDE',
      '1234567890',
      '+441234567890' // UK number
    ];

    test.each(valid)('accepts valid number: %s', (phone) => {
      expect(validatePhone(phone)).toBe(true);
    });

    test.each(invalid)('rejects invalid value: %s', (phone) => {
      expect(validatePhone(phone)).toBe(false);
    });
  });

  describe('BD_MOBILE_STRICT (no prefix allowed)', () => {
    test('accepts 01XXXXXXXXX format', () => {
      expect(validatePhone('01712345678', 'BD_MOBILE_STRICT')).toBe(true);
    });
    test('rejects +88 prefix', () => {
      expect(validatePhone('+8801712345678', 'BD_MOBILE_STRICT')).toBe(false);
    });
    test('rejects 88 prefix', () => {
      expect(validatePhone('8801712345678', 'BD_MOBILE_STRICT')).toBe(false);
    });
  });

  describe('BD_LANDLINE', () => {
    test('accepts 10-digit landline', () => {
      expect(validatePhone('0241234567', 'BD_LANDLINE')).toBe(true);
    });
    test('rejects mobile number as landline', () => {
      // 01712345678 is 11 chars, not 10 — rejects under landline pattern
      expect(validatePhone('01712345678', 'BD_LANDLINE')).toBe(false);
    });
  });

  test('throws on unknown format', () => {
    expect(() => validatePhone('01712345678', 'UNKNOWN')).toThrow('Unknown phone format: UNKNOWN');
  });

  test('returns false for non-string (number)', () => {
    expect(validatePhone(1712345678)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizePhone
// ---------------------------------------------------------------------------
describe('normalizePhone', () => {
  const cases = [
    ['01712345678',   '01712345678'],
    ['+8801712345678', '01712345678'],
    ['8801712345678',  '01712345678'],
    ['1712345678',     '01712345678']  // missing leading 0 → prepend
  ];

  test.each(cases)('normalizes %s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  test('returns null for null input', () => {
    expect(normalizePhone(null)).toBeNull();
  });
  test('returns null for empty string', () => {
    expect(normalizePhone('')).toBeNull();
  });
  test('returns null for undefined', () => {
    expect(normalizePhone(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractMobile
// ---------------------------------------------------------------------------
describe('extractMobile', () => {
  test('extracts mobile from +88 prefix', () => {
    expect(extractMobile('+8801712345678')).toBe('01712345678');
  });
  test('extracts mobile from bare format', () => {
    expect(extractMobile('01712345678')).toBe('01712345678');
  });
  test('returns null for invalid mobile', () => {
    expect(extractMobile('invalid')).toBeNull();
  });
  test('returns null for null', () => {
    expect(extractMobile(null)).toBeNull();
  });
  // Operator 2 is not assigned — must be rejected
  test('returns null for disallowed operator digit', () => {
    expect(extractMobile('01212345678')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toInternationalFormat
// ---------------------------------------------------------------------------
describe('toInternationalFormat', () => {
  test('converts 01XXXXXXXXX to +88 format', () => {
    expect(toInternationalFormat('01712345678')).toBe('+8801712345678');
  });
  test('handles already-prefixed +88 input', () => {
    expect(toInternationalFormat('+8801712345678')).toBe('+8801712345678');
  });
  test('returns null for invalid number', () => {
    expect(toInternationalFormat('invalid')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getOperator
// ---------------------------------------------------------------------------
describe('getOperator', () => {
  const operatorCases = [
    ['01312345678', 'Grameenphone'],
    ['01412345678', 'Grameenphone'],
    ['01512345678', 'Banglalink'],
    ['01612345678', 'Banglalink'],
    ['01712345678', 'Robi/Airtel'],
    ['01812345678', 'Robi/Airtel'],
    ['01912345678', 'Teletalk']
  ];

  test.each(operatorCases)('%s → %s', (phone, expectedOperator) => {
    const result = getOperator(phone);
    expect(result).not.toBeNull();
    expect(result.operator).toBe(expectedOperator);
    expect(result.isMobile).toBe(true);
  });

  test('returns null for invalid number', () => {
    expect(getOperator('invalid')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Exported regex shapes
// ---------------------------------------------------------------------------
describe('exported regex constants', () => {
  test('bdMobileRegex is a RegExp', () => {
    expect(bdMobileRegex).toBeInstanceOf(RegExp);
  });
  test('bdMobileStrictRegex rejects +88 prefix', () => {
    expect(bdMobileStrictRegex.test('+8801712345678')).toBe(false);
    expect(bdMobileStrictRegex.test('01712345678')).toBe(true);
  });
  test('bdLandlineRegex is a RegExp', () => {
    expect(bdLandlineRegex).toBeInstanceOf(RegExp);
  });
  test('VALIDATORS object has BD_MOBILE key', () => {
    expect(VALIDATORS).toHaveProperty('BD_MOBILE');
    expect(VALIDATORS.BD_MOBILE).toHaveProperty('regex');
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: callers that previously used inline regexes
// These assertions verify the shared validator covers every prior regex variant.
// ---------------------------------------------------------------------------
describe('compatibility with legacy inline regexes', () => {
  // Legacy pattern from rto-shield.service.js: /^01[3-9]\d{8}$/
  test('validated strict 01XXXXXXXXX (matches rto-shield regex)', () => {
    expect(validatePhone('01712345678', 'BD_MOBILE_STRICT')).toBe(true);
    expect(validatePhone('01212345678', 'BD_MOBILE_STRICT')).toBe(false);
  });

  // Legacy pattern from payment.service.js / shop-bd-settings.js: /^(?:\+?88)?01[3-9]\d{8}$/
  test('validates with optional +88 prefix (matches payment.service regex)', () => {
    expect(validatePhone('+8801912345678')).toBe(true);
    expect(validatePhone('8801912345678')).toBe(true);
    expect(validatePhone('01912345678')).toBe(true);
  });

  // Extraction regex used by the chatbot order session flow: /(?:\+?88)?0(1[3-9]\d{8})/
  test('normalizePhone strips prefix identically to legacy extraction', () => {
    expect(normalizePhone('+8801712345678')).toBe('01712345678');
    expect(normalizePhone('8801712345678')).toBe('01712345678');
  });
});
