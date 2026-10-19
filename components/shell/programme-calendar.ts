/*
 * The BMI check schedule (tab "Parameter BMI"): first check, interval and number of checks. Date
 * math comes from lib/dates and lib/rules, so the shell agrees with Cek BMI.
 */
import { formatHariTanggal, formatTanggalPendek, toIsoDate, type IsoDate } from "@/lib/dates";
import { DEFAULT_SETTINGS, bmiCheckDate, type Settings } from "@/lib/rules";

/** The settings columns the schedule needs, in the DB row's snake_case shape (public.pd_settings). */
export type BmiScheduleRow = {
  bmi_first_check: string;
  bmi_interval_days: number;
  bmi_periods: number;
};

function asRuleSettings(row: BmiScheduleRow): Settings {
  return {
    ...DEFAULT_SETTINGS,
    bmiFirstCheck: row.bmi_first_check,
    bmiIntervalDays: row.bmi_interval_days,
    bmiPeriods: row.bmi_periods,
  };
}

/**
 * Today's calendar date in Asia/Jakarta as 'YYYY-MM-DD'.
 * Reads the clock: with cacheComponents, call it only at request time (after
 * cookies(), a Supabase query, or `await connection()`), never in a prerendered component.
 */
export function todayInJakarta(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

/** The first BMI check on or after today, or null when the last one has passed. */
export function nextBmiCheck(schedule: BmiScheduleRow, today: IsoDate): { period: number; date: IsoDate } | null {
  const s = asRuleSettings(schedule);
  for (let period = 1; period <= s.bmiPeriods; period++) {
    const date = bmiCheckDate(period, s);
    if (date >= today) return { period, date };
  }
  return null;
}

/** The shell's one schedule line: "Cek BMI ke-2: 26 Okt", "Cek BMI ke-2 hari ini", or "Cek BMI selesai". */
export function bmiScheduleLine(schedule: BmiScheduleRow, today: IsoDate): string {
  const next = nextBmiCheck(schedule, today);
  if (!next) return `Cek BMI ke-${schedule.bmi_periods} sudah lewat`;
  if (next.date === today) return `Cek BMI ke-${next.period} hari ini`;
  return `Cek BMI ke-${next.period}: ${formatTanggalPendek(next.date)}`;
}

/** One sentence for screen readers and the dashboard: "Cek BMI berikutnya: ke-2 dari 5, Senin, 26 Okt 2026." */
export function bmiScheduleSummary(schedule: BmiScheduleRow, today: IsoDate): string {
  const next = nextBmiCheck(schedule, today);
  if (!next) return `Cek BMI terakhir (ke-${schedule.bmi_periods}) sudah lewat.`;
  if (next.date === today) return `Cek BMI ke-${next.period} dijadwalkan hari ini.`;
  return `Cek BMI berikutnya: ke-${next.period} dari ${schedule.bmi_periods}, ${formatHariTanggal(next.date)}.`;
}
