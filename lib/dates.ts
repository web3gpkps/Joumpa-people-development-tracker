/**
 * Date-only helpers for the JOUMPA rules.
 *
 * Every date in the domain is a calendar date, carried as an ISO string `YYYY-MM-DD`
 * (the shape Postgres `date` columns come back as). Arithmetic is done on UTC midnights,
 * so there is no DST or local-time drift. "Today" is the calendar date in Asia/Jakarta.
 */

export type IsoDate = string;

export const APP_TIME_ZONE = 'Asia/Jakarta';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Indonesian short month names, as the UI shows dates: `12 Okt 2026`. */
export const BULAN_SINGKAT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
] as const;

function utcMs(iso: IsoDate): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Not an ISO date (YYYY-MM-DD): ${JSON.stringify(iso)}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`Invalid calendar date: ${iso}`);
  }
  return ms;
}

/**
 * True for a complete calendar date in 2000..2100. Use it before passing a date input's value to
 * the rules: while someone is typing, inputs report values like "0002-10-25", which the helpers
 * here reject by throwing (Date.UTC maps years 0..99 to 1900..1999).
 */
export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const back = new Date(Date.UTC(y, mo - 1, d));
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d;
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Normalises a `today`-like input to an ISO date.
 * - `'2026-10-07'` is returned as is (validated).
 * - A `Date`, or a timestamp string such as `'2026-10-07T20:00:00Z'`, is converted to the
 *   calendar date in `timeZone` (default Asia/Jakarta).
 */
export function toIsoDate(value: Date | string, timeZone: string = APP_TIME_ZONE): IsoDate {
  if (typeof value === 'string' && ISO_DATE.test(value)) {
    utcMs(value);
    return value;
  }
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${String(value)}`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(utcMs(date) + days * DAY_MS);
}

/** `a − b` in whole days (like subtracting two Excel date serials). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((utcMs(a) - utcMs(b)) / DAY_MS);
}

/** Day of week, 0 = Sunday … 6 = Saturday (Excel `WEEKDAY(d)` is this + 1). */
export function dayOfWeek(date: IsoDate): number {
  return new Date(utcMs(date)).getUTCDay();
}

/** Excel `DATE(y, m, d)`: month/day overflow rolls over (month 13 = January next year). */
export function makeDate(year: number, month: number, day: number): IsoDate {
  return fromUtcMs(Date.UTC(year, month - 1, day));
}

export function dateParts(date: IsoDate): { year: number; month: number; day: number } {
  const d = new Date(utcMs(date));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return utcMs(a) <= utcMs(b) ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return utcMs(a) >= utcMs(b) ? a : b;
}

/** `12 Okt 2026` */
export function formatTanggal(date: IsoDate): string {
  const { year, month, day } = dateParts(date);
  return `${day} ${BULAN_SINGKAT[month - 1]} ${year}`;
}

/** `31 Okt` */
export function formatTanggalPendek(date: IsoDate): string {
  const { month, day } = dateParts(date);
  return `${day} ${BULAN_SINGKAT[month - 1]}`;
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const;

/** `Senin, 12 Okt 2026` */
export function formatHariTanggal(date: IsoDate): string {
  return `${HARI[dayOfWeek(date)]}, ${formatTanggal(date)}`;
}

const JAM = new Intl.DateTimeFormat('id-ID', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit' });

/** Clock time of a timestamp in Asia/Jakarta: `14.05`. */
export function formatJam(at: Date | string): string {
  return JAM.format(typeof at === 'string' ? new Date(at) : at);
}
