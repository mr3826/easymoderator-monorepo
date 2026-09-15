'use strict';

const { redactSecretiveValues } = require('../growth-os.audit-sanitizer');

describe('Growth OS audit sanitizer', () => {
  test('redacts sensitive object keys without changing safe values', () => {
    expect(redactSecretiveValues({
      password: 'not stored',
      nested: { access_token: 'not stored', amount: 5, enabled: false },
      empty: '',
    })).toEqual({
      password: '[redacted]',
      nested: { access_token: '[redacted]', amount: 5, enabled: false },
      empty: '',
    });
  });

  test('redacts credential assignments in reason strings for colon and equals syntax', () => {
    expect(redactSecretiveValues('token: secret-value api_key="another-secret"')).toBe(
      'token:[redacted] api_key=[redacted]',
    );
  });
});
