'use strict';

const { BUSINESS_TIME_ZONE, getBusinessDayBounds } = require('../growth-os.time');

function isoDayParts(date) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const parts = Object.fromEntries(formatted.map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

describe('Growth OS business day boundaries', () => {
  test('exposes the canonical Asia/Dhaka business timezone', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Asia/Dhaka');
  });

  test('bounds a business day from local midnight to next local midnight (UTC+06 fixed)', () => {
    // Asia/Dhaka has no DST, so +06 offset is stable across the year.
    // 2026-09-13 00:00 Asia/Dhaka === 2026-09-12T18:00:00Z
    // 2026-09-14 00:00 Asia/Dhaka === 2026-09-13T18:00:00Z
    const sample = new Date('2026-09-13T04:00:00.000Z'); // 10:00 Asia/Dhaka
    const { start, end } = getBusinessDayBounds(sample);
    expect(start.toISOString()).toBe('2026-09-12T18:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-13T18:00:00.000Z');
    expect(isoDayParts(start)).toBe('2026-09-13');
    expect(isoDayParts(end)).toBe('2026-09-14');
  });

  test('handles the local midnight boundary exactly', () => {
    const midnightLocal = new Date('2026-09-13T18:00:00.000Z');
    const { start, end } = getBusinessDayBounds(midnightLocal);
    expect(start.toISOString()).toBe('2026-09-13T18:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-14T18:00:00.000Z');
  });

  test('handles the last minute of a business day (still same local day)', () => {
    const justBeforeMidnight = new Date('2026-09-13T17:59:59.999Z');
    const { start, end } = getBusinessDayBounds(justBeforeMidnight);
    expect(start.toISOString()).toBe('2026-09-12T18:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-13T18:00:00.000Z');
  });

  test('crosses month boundary without losing the local day', () => {
    // 2026-10-01 00:30 Asia/Dhaka === 2026-09-30T18:30:00Z
    const sample = new Date('2026-09-30T18:30:00.000Z');
    const { start, end } = getBusinessDayBounds(sample);
    expect(isoDayParts(start)).toBe('2026-10-01');
    expect(isoDayParts(end)).toBe('2026-10-02');
  });

  test('handles leap day boundaries', () => {
    // 2028-02-29 is a valid Asia/Dhaka date.
    const sample = new Date('2028-02-28T19:00:00.000Z'); // 2028-02-29 01:00 Asia/Dhaka
    const { start, end } = getBusinessDayBounds(sample);
    expect(isoDayParts(start)).toBe('2028-02-29');
    expect(isoDayParts(end)).toBe('2028-03-01');
  });
});
