import { describe, expect, it } from 'vitest';
import {
  fromBusinessDateTimeLocal,
  formatGrowthDateTime,
  toBusinessDateTimeLocal,
} from './growthTime';

describe('growthTime business-day contract (Asia/Dhaka, fixed +06)', () => {
  it('interprets selected wall-clock as Dhaka time, not browser time', () => {
    expect(fromBusinessDateTimeLocal('2026-09-27T20:00').toISOString()).toBe('2026-09-27T14:00:00.000Z');
    expect(fromBusinessDateTimeLocal('2026-09-27T00:00').toISOString()).toBe('2026-09-26T18:00:00.000Z');
  });

  it('keeps 23:59 and 00:00 boundaries inside their selected business day', () => {
    expect(toBusinessDateTimeLocal(fromBusinessDateTimeLocal('2026-09-27T23:59').toISOString()))
      .toBe('2026-09-27T23:59');
    expect(toBusinessDateTimeLocal(fromBusinessDateTimeLocal('2026-09-27T00:00').toISOString()))
      .toBe('2026-09-27T00:00');
  });

  it('round-trips every hour boundary across the UTC day line', () => {
    for (const hour of ['00', '06', '17', '18', '23']) {
      const local = `2026-09-27T${hour}:30`;
      expect(toBusinessDateTimeLocal(fromBusinessDateTimeLocal(local).toISOString())).toBe(local);
    }
  });

  it('renders instants in the business zone independent of host locale', () => {
    // 2026-09-27T18:00Z is 2026-09-28 00:00 in Dhaka — the rendered day must
    // be the business day, never the UTC calendar day.
    const rendered = formatGrowthDateTime('2026-09-27T18:00:00.000Z');
    expect(rendered).toMatch(/Sep(tember)? 28/);
    expect(rendered).not.toMatch(/Sep(tember)? 27/);
  });

  it('rejects malformed datetime-local values instead of guessing', () => {
    expect(Number.isNaN(fromBusinessDateTimeLocal('2026-09-27 20:00').getTime())).toBe(true);
    expect(Number.isNaN(fromBusinessDateTimeLocal('2026-09-27T20:00:30').getTime())).toBe(true);
    expect(Number.isNaN(fromBusinessDateTimeLocal('').getTime())).toBe(true);
  });

  it('formats missing values as Not provided and passes through unparseable strings', () => {
    expect(formatGrowthDateTime(null)).toBe('Not provided');
    expect(formatGrowthDateTime(undefined)).toBe('Not provided');
    expect(formatGrowthDateTime('not-a-date')).toBe('not-a-date');
  });
});
