export const SHOP_TIMEZONE = 'Africa/Kampala';

/**
 * Returns YYYY-MM-DD for the given Date in Africa/Kampala timezone.
 */
export function formatKampalaDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function getKampalaToday(now: Date = new Date()): string {
  return formatKampalaDateString(now);
}

export function getKampalaTomorrow(now: Date = new Date()): string {
  return addDaysToDateString(getKampalaToday(now), 1);
}

export function getKampalaTimeNow(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SHOP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

/**
 * Pure calendar date arithmetic on YYYY-MM-DD strings so dates never shift across timezones.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateDisplay(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(utcDate);
}

export function formatTimestampKampala(isoString: string): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SHOP_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Returns true if dateStr (YYYY-MM-DD) is strictly older than `months` months
 * relative to `referenceDateStr` (defaults to today in Africa/Kampala).
 */
export function isOlderThanMonths(
  dateStr: string,
  months: number,
  referenceDateStr: string = getKampalaToday()
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [ry, rm, rd] = referenceDateStr.split('-').map(Number);
  const cutoffUtc = new Date(Date.UTC(ry, rm - 1 - months, rd));
  const cutoffStr = [
    cutoffUtc.getUTCFullYear(),
    String(cutoffUtc.getUTCMonth() + 1).padStart(2, '0'),
    String(cutoffUtc.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return dateStr < cutoffStr;
}
