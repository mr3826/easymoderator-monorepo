export const BUSINESS_TIME_ZONE = 'Asia/Dhaka';

function parts(value: Date) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const values = Object.fromEntries(formatted.map(({ type, value: partValue }) => [type, partValue]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function offsetMilliseconds(value: Date) {
  const valueParts = parts(value);
  return Date.UTC(
    valueParts.year,
    valueParts.month - 1,
    valueParts.day,
    valueParts.hour,
    valueParts.minute,
    valueParts.second,
  ) - value.getTime();
}

function fromBusinessLocal(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return new Date(NaN);
  const [, year, month, day, hour, minute] = match;
  const naiveUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const firstCandidate = new Date(naiveUtc - offsetMilliseconds(new Date(naiveUtc)));
  return new Date(naiveUtc - offsetMilliseconds(firstCandidate));
}

export function formatGrowthDateTime(value: string | null | undefined) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: BUSINESS_TIME_ZONE,
    timeZoneName: 'short',
  }).format(date);
}

export function toBusinessDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const valueParts = parts(date);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${valueParts.year}-${pad(valueParts.month)}-${pad(valueParts.day)}T${pad(valueParts.hour)}:${pad(valueParts.minute)}`;
}

export function fromBusinessDateTimeLocal(value: string) {
  return fromBusinessLocal(value);
}
