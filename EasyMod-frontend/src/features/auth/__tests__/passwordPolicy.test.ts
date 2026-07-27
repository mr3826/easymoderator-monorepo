import { describe, it, expect } from 'vitest';
import { signupSchema } from '../validation/schemas';
import {
  PASSWORD_RULES,
  getPasswordError,
  getPasswordScore,
} from '../validation/passwordPolicy';

/**
 * The API (auth.validator.js) requires min 8 + uppercase + digit + special on
 * signup and reset-password. The client used to require only 8/upper/lower/digit
 * and still rated such a password "Strong", so signup failed with an opaque 400.
 */
const VALID = 'AuditPass987x!';

const buildSignup = (password: string) => ({
  fullName: 'QA Merchant',
  email: 'merchant@example.com',
  phone: '01712345678',
  password,
  acceptedTerms: true,
});

describe('password policy', () => {
  it('accepts a password that satisfies every rule', () => {
    expect(getPasswordError(VALID)).toBeNull();
    expect(signupSchema.safeParse(buildSignup(VALID)).success).toBe(true);
  });

  it.each([
    ['too short', 'Ab1!xyz'],
    ['no uppercase', 'auditpass987x!'],
    ['no lowercase', 'AUDITPASS987X!'],
    ['no digit', 'AuditPassword!'],
    ['no special character', 'AuditPass987x'],
  ])('rejects a password with %s', (_label, password) => {
    expect(getPasswordError(password)).not.toBeNull();
    expect(signupSchema.safeParse(buildSignup(password)).success).toBe(false);
  });

  it('rejects the exact password shape the API refused before this fix', () => {
    // Uppercase + lowercase + digit + 8 chars, but no special character.
    const password = 'AuditPass987x';
    expect(signupSchema.safeParse(buildSignup(password)).success).toBe(false);
    expect(getPasswordError(password)).toMatch(/special character/i);
  });

  it('only reaches a full score when every rule passes', () => {
    expect(getPasswordScore(VALID)).toBe(PASSWORD_RULES.length);
    // Missing the special character must not reach the top score, otherwise the
    // strength meter would label a backend-invalid password "Strong".
    expect(getPasswordScore('AuditPass987x')).toBe(PASSWORD_RULES.length - 1);
  });

  it('keeps the zod schema and PASSWORD_RULES in agreement', () => {
    for (const rule of PASSWORD_RULES) {
      // Build a password that satisfies everything except this one rule.
      const counterexample = {
        length: 'Ab1!',
        uppercase: 'auditpass987x!',
        lowercase: 'AUDITPASS987X!',
        digit: 'AuditPassword!',
        special: 'AuditPass987x',
      }[rule.id];

      expect(rule.test(counterexample)).toBe(false);
      expect(signupSchema.safeParse(buildSignup(counterexample)).success).toBe(false);
    }
  });
});
