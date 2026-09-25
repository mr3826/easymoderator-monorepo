'use strict';

const BUSINESS_TIME_ZONE = 'Asia/Dhaka';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function calendarParts(value) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(value).map(({ type, value: partValue }) => [type, partValue]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMilliseconds(value) {
  const parts = calendarParts(value);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ) - value.getTime();
}

function fromBusinessCalendar(parts) {
  const naiveUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const firstCandidate = new Date(naiveUtc - offsetMilliseconds(new Date(naiveUtc)));
  const corrected = new Date(naiveUtc - offsetMilliseconds(firstCandidate));
  return corrected;
}

function addCalendarDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function getBusinessDayBounds(value = new Date()) {
  const parts = calendarParts(value);
  const start = fromBusinessCalendar({ year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, second: 0 });
  const next = addCalendarDays(parts, 1);
  const end = fromBusinessCalendar({ year: next.year, month: next.month, day: next.day, hour: 0, minute: 0, second: 0 });
  return { start, end, timeZone: BUSINESS_TIME_ZONE };
}

module.exports = { BUSINESS_TIME_ZONE, getBusinessDayBounds };
