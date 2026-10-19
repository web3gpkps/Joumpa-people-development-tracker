/*
 * BMI check periods: how many there can be, which dates each one covers and how it is named.
 * One source for the screens, the Excel export, the admin Parameter form and the Google Sheet tab
 * (lib/sync/bmi-structure.ts writes the same label into the tab's header row).
 * Pure: no React, no server code.
 */
import { addDays, dateParts, type IsoDate } from "./dates";
import { bmiCheckDate, type Settings } from "./rules";

/** Most checks a programme can have: two years of checks every two weeks. */
export const MAX_BMI_PERIODS = 52;
/** Longest interval between two checks, in days. */
export const MAX_BMI_INTERVAL_DAYS = 90;

/** English month abbreviations, the way the owner writes periods ("15-20 Oct 2026"). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type BmiPeriodRange = { start: IsoDate; end: IsoDate };

/**
 * The window of check `period`: from its planned date through the day before the next check, so
 * consecutive periods follow each other without gaps (interval 14: 12 Oct to 25 Oct, then 26 Oct).
 */
export function bmiPeriodRange(period: number, s: Pick<Settings, "bmiFirstCheck" | "bmiIntervalDays">): BmiPeriodRange {
  const start = bmiCheckDate(period, s as Settings);
  return { start, end: addDays(start, Math.max(1, s.bmiIntervalDays) - 1) };
}

/** "15-20 Oct 2026", "28 Oct-10 Nov 2026" or "28 Dec 2026-10 Jan 2027". A one-day window reads "15 Oct 2026". */
export function formatPeriodRange({ start, end }: BmiPeriodRange): string {
  const a = dateParts(start);
  const b = dateParts(end);
  if (start === end) return `${a.day} ${MONTHS[a.month - 1]} ${a.year}`;
  if (a.year !== b.year) return `${a.day} ${MONTHS[a.month - 1]} ${a.year}-${b.day} ${MONTHS[b.month - 1]} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${MONTHS[a.month - 1]}-${b.day} ${MONTHS[b.month - 1]} ${b.year}`;
  return `${a.day}-${b.day} ${MONTHS[b.month - 1]} ${b.year}`;
}

/**
 * The check taken during the Coaching Assessment is the first one. Its height and weight are
 * entered in the Google Sheet only: the screens show them and never offer to change them.
 */
export const COACHING_CHECK_PERIOD = 1;

export function isCoachingCheck(period: number): boolean {
  return period === COACHING_CHECK_PERIOD;
}

/** "BMI Cek ke-3": where there is no room for the period. */
export function bmiCheckName(period: number): string {
  return `BMI Cek ke-${period}`;
}

/** "BMI Cek ke-3 (Periode 9-22 Nov 2026)": group headers, the period select, history rows and the sheet header. */
export function bmiCheckLabel(period: number, s: Pick<Settings, "bmiFirstCheck" | "bmiIntervalDays">): string {
  return `${bmiCheckName(period)} (Periode ${formatPeriodRange(bmiPeriodRange(period, s))})`;
}

/** Every label for settings with `bmiPeriods` checks, in order. */
export function bmiCheckLabels(s: Pick<Settings, "bmiFirstCheck" | "bmiIntervalDays" | "bmiPeriods">): string[] {
  return Array.from({ length: s.bmiPeriods }, (_, i) => bmiCheckLabel(i + 1, s));
}
