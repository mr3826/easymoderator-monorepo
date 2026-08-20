'use strict';

const {
  hasChannel,
  normalizeBusinessName,
  normalizeEmail,
  normalizeIdentity,
  normalizePage,
  normalizePhone,
} = require('../growth-os.prospect.identity');

describe('Growth OS prospect identity normalization', () => {
  it('normalizes Unicode business names without discarding letters or numbers', () => {
    expect(normalizeBusinessName('  Café & Co. 東京 123!!!  ')).toBe('café co 東京 123');
  });

  it('treats Bangladesh phone formats +880, +88, 00880, and 01 as equivalent', () => {
    const values = [
      '+880 1712-345678',
      '+88 01712-345678',
      '00880 1712 345678',
      '01712 345678',
    ];

    expect(values.map(normalizePhone)).toEqual([
      '+8801712345678',
      '+8801712345678',
      '+8801712345678',
      '+8801712345678',
    ]);
  });

  it('trims and lowercases email identity values', () => {
    expect(normalizeEmail('  Owner@Example.COM  ')).toBe('owner@example.com');
    expect(normalizeIdentity({ contactEmail: ' SALES@Example.COM ' }).normalized_email)
      .toBe('sales@example.com');
  });

  it('canonicalizes mobile Facebook page hosts to facebook.com', () => {
    const mobile = normalizePage(' HTTPS://M.FACEBOOK.COM/Cafe-Page/?utm_source=campaign#comments ');
    const desktop = normalizePage('https://facebook.com/cafe-page/');

    expect(mobile).toBe('facebook.com/cafe-page');
    expect(desktop).toBe(mobile);
  });

  it('removes query strings, fragments, protocol prefixes, and trailing slashes', () => {
    expect(normalizePage('https://Example.com/Some/Path///?ref=1#details'))
      .toBe('example.com/some/path');
    expect(normalizePage('//www.facebook.com/Store/')).toBe('facebook.com/store');
  });

  it('supports the current and legacy identity field names in one normalized result', () => {
    expect(normalizeIdentity({
      business_name: '  North Star  ',
      contact_phone: '01700000000',
      contact_email: 'TEAM@NORTHSTAR.EXAMPLE',
      page_url: 'https://m.facebook.com/north-star/?x=1',
    })).toEqual({
      normalized_business_name: 'north star',
      normalized_phone: '+8801700000000',
      normalized_email: 'team@northstar.example',
      normalized_page: 'facebook.com/north-star',
    });
  });

  it('reports whether at least one deduplication channel is present', () => {
    expect(hasChannel({ normalized_phone: null, normalized_email: null, normalized_page: null }))
      .toBe(false);
    expect(hasChannel({ normalized_email: 'owner@example.com' })).toBe(true);
    expect(normalizePhone('not a phone number')).toBeNull();
  });
});
