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

  test('redacts the complete bearer credential from authorization text', () => {
    expect(redactSecretiveValues('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature'))
      .toBe('Authorization:[redacted]');
  });

  test('removes credentials, query strings, and fragments from source URLs', () => {
    expect(redactSecretiveValues({
      page_url: 'https://user:pass@example.com/prospect?access_token=secret#contact',
    })).toEqual({ page_url: 'https://example.com/prospect' });
  });

  test('redacts contact and normalized PII keys from audit snapshots', () => {
    expect(redactSecretiveValues({
      status: 'qualified',
      source: 'facebook',
      contact_email: 'merchant@example.test',
      contact_phone: '+8801700000000',
      normalized_email: 'merchant@example.test',
      normalized_phone: '8801700000000',
      business_name: 'North Star Retail',
      owner_user_id: 'owner-uuid',
    })).toEqual({
      status: 'qualified',
      source: 'facebook',
      contact_email: '[redacted]',
      contact_phone: '[redacted]',
      normalized_email: '[redacted]',
      normalized_phone: '[redacted]',
      business_name: 'North Star Retail',
      owner_user_id: 'owner-uuid',
    });
  });
});
