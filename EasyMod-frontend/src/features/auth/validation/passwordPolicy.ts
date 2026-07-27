/**
 * Single source of truth for the password policy.
 *
 * The backend (EasyMod-backend/src/modules/auth/auth.validator.js) enforces
 * min 8 chars + uppercase + digit + special on BOTH signup and reset-password.
 * Before this module the frontend checked a different set (it never required a
 * special character) and the strength meter still reported "Strong", so a
 * merchant following the on-screen guidance was rejected by the API with an
 * opaque 400. Every client-side password check must derive from here so the two
 * sides cannot drift apart again.
 */

export interface PasswordRule {
  /** Stable id, also used as the strength-meter criterion key. */
  id: 'length' | 'uppercase' | 'lowercase' | 'digit' | 'special';
  test: (value: string) => boolean;
  message: string;
  /** True when the backend rejects the password without it. */
  requiredByApi: boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    test: (v) => v.length >= 8,
    message: 'Password must be at least 8 characters',
    requiredByApi: true,
  },
  {
    id: 'uppercase',
    test: (v) => /[A-Z]/.test(v),
    message: 'Password must contain at least one uppercase letter',
    requiredByApi: true,
  },
  {
    id: 'lowercase',
    test: (v) => /[a-z]/.test(v),
    message: 'Password must contain at least one lowercase letter',
    // Not enforced by the API, but kept as a client-side quality bar.
    requiredByApi: false,
  },
  {
    id: 'digit',
    test: (v) => /[0-9]/.test(v),
    message: 'Password must contain at least one number',
    requiredByApi: true,
  },
  {
    id: 'special',
    test: (v) => /[^A-Za-z0-9]/.test(v),
    message: 'Password must contain at least one special character',
    requiredByApi: true,
  },
];

/** Human-readable summary shown under password inputs. */
export const PASSWORD_HINT =
  'Use 8+ characters with uppercase, lowercase, a number, and a special character';

/** Returns the first unmet rule's message, or null when the password is acceptable. */
export function getPasswordError(value: string): string | null {
  const failed = PASSWORD_RULES.find((rule) => !rule.test(value));
  return failed ? failed.message : null;
}

/** Number of satisfied rules (0..PASSWORD_RULES.length). */
export function getPasswordScore(value: string): number {
  return PASSWORD_RULES.reduce((score, rule) => (rule.test(value) ? score + 1 : score), 0);
}
