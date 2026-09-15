'use strict';

/**
 * ADR M-008 (Phase 2, decision D4) — the backend's first timezone-aware
 * day-boundary helper. Nothing before this computed a merchant-local "today"
 * anywhere in the codebase; the existing dashboard computes day boundaries in
 * server-local/UTC time (see dashboard.service.js), which this deliberately
 * does not reuse or fix (out of scope for Phase 2 — see M-008 amendment).
 *
 * Bangladesh has observed no DST since 2010, so `Asia/Dhaka` is treated as a
 * fixed UTC+06:00 offset — plain arithmetic, no date library needed (the
 * Phase 2 execution plan explicitly rules out adding dayjs/moment/luxon for
 * this one helper).
 *
 * Only `Asia/Dhaka` is understood. Any other `Shop.timezone` value falls back
 * to UTC day boundaries and reports that explicitly via `fellBackToUtc` /
 * `timezoneNote` rather than silently computing a wrong "today" — the
 * mobile/today response surfaces this as `timezone_note`.
 */

const DHAKA_OFFSET_MINUTES = 6 * 60; // UTC+06:00, fixed — no DST
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Resolve the [start, end) UTC instant window for "today" in the merchant's
 * shop timezone, plus a human-readable date label in that same timezone.
 *
 * @param {string|null|undefined} shopTimezone - `Shop.timezone` value
 * @param {Date} [now]
 * @returns {{
 *   startUtc: Date,
 *   endUtc: Date,
 *   timezoneUsed: 'Asia/Dhaka'|'UTC',
 *   fellBackToUtc: boolean,
 *   dateLabel: string,
 *   timezoneNote: string|null,
 * }}
 */
function getMerchantDayWindowUtc(shopTimezone, now = new Date()) {
    const isDhaka = shopTimezone === 'Asia/Dhaka';
    const offsetMinutes = isDhaka ? DHAKA_OFFSET_MINUTES : 0;
    const timezoneUsed = isDhaka ? 'Asia/Dhaka' : 'UTC';

    // Shift the instant forward by the offset so its UTC calendar fields
    // read as the merchant's local wall-clock date, then rebuild that local
    // midnight as a UTC instant and shift back by the same offset. This is
    // exact fixed-offset arithmetic — no DST table, no ambiguous/duplicated
    // local times to worry about, which is exactly why a fixed offset is
    // safe for Asia/Dhaka and would NOT be safe for a DST-observing zone.
    const shifted = new Date(now.getTime() + offsetMinutes * MS_PER_MINUTE);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const day = shifted.getUTCDate();

    const localMidnightAsUtcMillis = Date.UTC(year, month, day, 0, 0, 0, 0);
    const startUtc = new Date(localMidnightAsUtcMillis - offsetMinutes * MS_PER_MINUTE);
    const endUtc = new Date(startUtc.getTime() + MS_PER_DAY);
    const dateLabel = `${year}-${pad2(month + 1)}-${pad2(day)}`;

    const fellBackToUtc = !isDhaka;
    const timezoneNote = fellBackToUtc
        ? `Shop timezone is '${shopTimezone || 'unset'}', not 'Asia/Dhaka'; falling back to UTC day `
            + 'boundaries so "today" is never silently computed wrong.'
        : null;

    return { startUtc, endUtc, timezoneUsed, fellBackToUtc, dateLabel, timezoneNote };
}

/**
 * Hours elapsed between `date` and `now`, clamped at zero so a clock-skewed
 * or future timestamp never produces a negative urgency score.
 */
function hoursSince(date, now = new Date()) {
    // `new Date(null)` coerces to the epoch (a finite timestamp), not
    // Invalid Date, so null/undefined must be rejected before conversion —
    // otherwise a missing timestamp would silently score as "decades overdue"
    // instead of falling back to zero.
    if (date == null) return 0;
    const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
    if (!Number.isFinite(timestamp)) return 0;
    return Math.max(0, (now.getTime() - timestamp) / MS_PER_HOUR);
}

/**
 * Read a row's created/updated timestamp defensively regardless of whether
 * the underlying Sequelize model exposes it as the camelCase accessor or the
 * snake_case column name — the exact accessor trap documented in
 * conversation.service.js (~570-577): `underscored: true` models expose
 * `.createdAt` unless the model explicitly renames the timestamp attribute
 * to `created_at` (as CourierDispatch and Message do). Trying only one key
 * silently returns `undefined` on the other model shape.
 */
function readTimestamp(row, key = 'created_at') {
    if (!row) return null;
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = row[key] ?? row[camel];
    if (value == null) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

module.exports = {
    DHAKA_OFFSET_MINUTES,
    getMerchantDayWindowUtc,
    hoursSince,
    readTimestamp,
};
