import { BD_PHONE_REGEX, isValidBdPhone, normalizeBdPhone } from './phone';

describe('BD_PHONE_REGEX', () => {
  it('matches the exact regex the web app uses', () => {
    expect(BD_PHONE_REGEX.source).toBe('^01[3-9]\\d{8}$');
  });
});

describe('isValidBdPhone', () => {
  it.each(['01712345678', '01812345678', '01912345678', '01312345678'])('accepts a valid number %s', (phone) => {
    expect(isValidBdPhone(phone)).toBe(true);
  });

  it('rejects a number with an invalid operator-prefix digit (0)', () => {
    expect(isValidBdPhone('01012345678')).toBe(false);
  });

  it('rejects a number with an invalid operator-prefix digit (1)', () => {
    expect(isValidBdPhone('01112345678')).toBe(false);
  });

  it('rejects a number that is too short', () => {
    expect(isValidBdPhone('0171234567')).toBe(false);
  });

  it('rejects a number that is too long', () => {
    expect(isValidBdPhone('017123456789')).toBe(false);
  });

  it('rejects a number missing the leading 0', () => {
    expect(isValidBdPhone('1712345678')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidBdPhone('017abcd5678')).toBe(false);
  });

  it('accepts a number with a +880 country code after normalization', () => {
    expect(isValidBdPhone('+8801712345678')).toBe(true);
  });

  it('accepts a number with spaces/dashes after normalization', () => {
    expect(isValidBdPhone('017-1234-5678')).toBe(true);
  });
});

describe('normalizeBdPhone', () => {
  it('strips a +880 country code', () => {
    expect(normalizeBdPhone('+8801712345678')).toBe('01712345678');
  });

  it('strips spaces and dashes', () => {
    expect(normalizeBdPhone('017 1234 5678')).toBe('01712345678');
  });

  it('leaves an already-local number unchanged', () => {
    expect(normalizeBdPhone('01712345678')).toBe('01712345678');
  });
});
