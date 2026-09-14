'use strict';

/**
 * Pure unit tests for ADR M-008 decision D4 — no DB, no flag, runs in the
 * default `npm test` gate like any other unit suite.
 */

const { getMerchantDayWindowUtc, hoursSince, readTimestamp } = require('../mobile-day-window.util');

describe('getMerchantDayWindowUtc (ADR M-008 D4)', () => {
    test('Asia/Dhaka: mid-day instant resolves to the Dhaka calendar date, window is [prev 18:00Z, same-day 18:00Z)', () => {
        const now = new Date('2026-09-14T10:00:00.000Z'); // 16:00 in Dhaka (UTC+6)
        const result = getMerchantDayWindowUtc('Asia/Dhaka', now);

        expect(result.timezoneUsed).toBe('Asia/Dhaka');
        expect(result.fellBackToUtc).toBe(false);
        expect(result.timezoneNote).toBeNull();
        expect(result.dateLabel).toBe('2026-09-14');
        expect(result.startUtc.toISOString()).toBe('2026-09-13T18:00:00.000Z');
        expect(result.endUtc.toISOString()).toBe('2026-09-14T18:00:00.000Z');
    });

    test('Asia/Dhaka: instant just before the boundary belongs to the previous Dhaka day', () => {
        const now = new Date('2026-09-13T17:59:59.999Z'); // 23:59:59.999 in Dhaka on the 13th
        const result = getMerchantDayWindowUtc('Asia/Dhaka', now);

        expect(result.dateLabel).toBe('2026-09-13');
        expect(result.startUtc.toISOString()).toBe('2026-09-12T18:00:00.000Z');
        expect(result.endUtc.toISOString()).toBe('2026-09-13T18:00:00.000Z');
    });

    test('Asia/Dhaka: instant exactly at the boundary belongs to the next Dhaka day (start is inclusive)', () => {
        const now = new Date('2026-09-13T18:00:00.000Z'); // exactly 00:00:00 in Dhaka on the 14th
        const result = getMerchantDayWindowUtc('Asia/Dhaka', now);

        expect(result.dateLabel).toBe('2026-09-14');
        expect(result.startUtc.toISOString()).toBe('2026-09-13T18:00:00.000Z');
        expect(now.getTime()).toBe(result.startUtc.getTime());
    });

    test('non-Dhaka shop timezone falls back to UTC day boundaries and reports why', () => {
        const now = new Date('2026-09-14T23:30:00.000Z');
        const result = getMerchantDayWindowUtc('America/New_York', now);

        expect(result.timezoneUsed).toBe('UTC');
        expect(result.fellBackToUtc).toBe(true);
        expect(result.dateLabel).toBe('2026-09-14');
        expect(result.startUtc.toISOString()).toBe('2026-09-14T00:00:00.000Z');
        expect(result.endUtc.toISOString()).toBe('2026-09-15T00:00:00.000Z');
        expect(result.timezoneNote).toMatch(/America\/New_York/);
        expect(result.timezoneNote).toMatch(/UTC/);
    });

    test('missing/null shop timezone also falls back to UTC, labelled as unset', () => {
        const result = getMerchantDayWindowUtc(null, new Date('2026-09-14T12:00:00.000Z'));
        expect(result.timezoneUsed).toBe('UTC');
        expect(result.fellBackToUtc).toBe(true);
        expect(result.timezoneNote).toMatch(/unset/);
    });

    test('every window is exactly 24 hours wide', () => {
        const dhaka = getMerchantDayWindowUtc('Asia/Dhaka', new Date());
        const utc = getMerchantDayWindowUtc('UTC', new Date());
        expect(dhaka.endUtc.getTime() - dhaka.startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
        expect(utc.endUtc.getTime() - utc.startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
    });
});

describe('hoursSince', () => {
    test('computes fractional hours elapsed', () => {
        const now = new Date('2026-09-14T12:00:00.000Z');
        const threeHoursAgo = new Date('2026-09-14T09:00:00.000Z');
        expect(hoursSince(threeHoursAgo, now)).toBeCloseTo(3, 5);
    });

    test('clamps a future/clock-skewed timestamp to zero rather than going negative', () => {
        const now = new Date('2026-09-14T12:00:00.000Z');
        const future = new Date('2026-09-14T13:00:00.000Z');
        expect(hoursSince(future, now)).toBe(0);
    });

    test('an unparsable date returns zero rather than NaN', () => {
        expect(hoursSince('not-a-date', new Date())).toBe(0);
        expect(hoursSince(null, new Date())).toBe(0);
    });
});

describe('readTimestamp (accessor-trap defence)', () => {
    test('reads the snake_case column when that is what the row exposes', () => {
        const row = { created_at: new Date('2026-09-01T00:00:00.000Z') };
        expect(readTimestamp(row).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    });

    test('falls back to the camelCase accessor when snake_case is undefined', () => {
        const row = { createdAt: new Date('2026-09-02T00:00:00.000Z') };
        expect(readTimestamp(row).toISOString()).toBe('2026-09-02T00:00:00.000Z');
    });

    test('returns null for a row with neither', () => {
        expect(readTimestamp({})).toBeNull();
        expect(readTimestamp(null)).toBeNull();
    });
});
