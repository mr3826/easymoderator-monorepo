'use strict';

/**
 * live-order-parser.test.js
 *
 * Unit tests for the live-selling purchase-intent parser. Pure function, no mocks.
 * Covers Banglish, Bengali, English signals, quantity/size extraction, custom
 * keywords, and the "no intent" negative cases.
 */

const { parseLiveOrderIntent } = require('../live-order-parser');

describe('parseLiveOrderIntent — intent detection', () => {
  it('detects Banglish "nibo"', () => {
    const r = parseLiveOrderIntent('eta nibo');
    expect(r.isPurchaseIntent).toBe(true);
    expect(r.signals).toContain('nibo');
  });

  it('detects Bengali "নিবো"', () => {
    expect(parseLiveOrderIntent('আমি এটা নিবো').isPurchaseIntent).toBe(true);
  });

  it('detects "lagbe" (need)', () => {
    expect(parseLiveOrderIntent('amar ekta lagbe').isPurchaseIntent).toBe(true);
  });

  it('detects price ask "dam koto"', () => {
    expect(parseLiveOrderIntent('eta dam koto?').isPurchaseIntent).toBe(true);
  });

  it('detects English "order"', () => {
    expect(parseLiveOrderIntent('I want to order this').isPurchaseIntent).toBe(true);
  });

  it('treats a bare quantity + size combo as intent even without a verb', () => {
    const r = parseLiveOrderIntent('2 ta L');
    expect(r.isPurchaseIntent).toBe(true);
    expect(r.quantity).toBe(2);
    expect(r.size).toBe('L');
  });
});

describe('parseLiveOrderIntent — quantity extraction', () => {
  it('parses "2 ta"', () => {
    expect(parseLiveOrderIntent('nibo 2 ta').quantity).toBe(2);
  });

  it('parses Bengali numerals "৩টি"', () => {
    expect(parseLiveOrderIntent('৩টি নিবো').quantity).toBe(3);
  });

  it('parses "5 pcs"', () => {
    expect(parseLiveOrderIntent('order 5 pcs').quantity).toBe(5);
  });

  it('returns null when no quantity present', () => {
    expect(parseLiveOrderIntent('nibo').quantity).toBeNull();
  });
});

describe('parseLiveOrderIntent — size extraction', () => {
  it('parses "size M"', () => {
    expect(parseLiveOrderIntent('nibo size M').size).toBe('M');
  });

  it('parses "XL"', () => {
    expect(parseLiveOrderIntent('XL lagbe').size).toBe('XL');
  });

  it('parses Bengali "বড়" as L', () => {
    expect(parseLiveOrderIntent('বড় সাইজ নিবো').size).toBe('L');
  });

  it('returns null when no size present', () => {
    expect(parseLiveOrderIntent('nibo 2 ta').size).toBeNull();
  });
});

describe('parseLiveOrderIntent — custom keywords & negatives', () => {
  it('honors shop-configured custom intent keywords', () => {
    const r = parseLiveOrderIntent('confirm koren', ['confirm']);
    expect(r.isPurchaseIntent).toBe(true);
    expect(r.signals).toContain('confirm');
  });

  it('returns no intent for a plain compliment', () => {
    const r = parseLiveOrderIntent('darun product, valo laglo');
    expect(r.isPurchaseIntent).toBe(false);
  });

  it('handles empty / non-string input safely', () => {
    expect(parseLiveOrderIntent('').isPurchaseIntent).toBe(false);
    expect(parseLiveOrderIntent(null).isPurchaseIntent).toBe(false);
    expect(parseLiveOrderIntent(undefined).isPurchaseIntent).toBe(false);
  });
});
