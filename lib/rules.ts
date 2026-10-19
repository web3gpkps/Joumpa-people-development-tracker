/**
 * Business rules ported from "Tracker Tindak Lanjut Uplifting JOUMPA.xlsx".
 *
 * Pure and framework-free. Conventions:
 * - Rows are DB rows with camelCase keys (`score_a` → `scoreA`); use `camelize()` on what
 *   supabase-js returns. Text columns are plain strings; values outside the expected
 *   vocabulary simply never match (as in the workbook).
 * - Dates are ISO `YYYY-MM-DD` strings. "Today" is always passed in (`IsoDate` or `Date`,
 *   a `Date` is read as its calendar date in Asia/Jakarta). Nothing here calls `new Date()`.
 * - Excel's empty string `""` is `null` here.
 * - Thresholds always come from `Settings` (sheet Parameter). Labels are the workbook's own.
 *
 * Excel semantics kept on purpose:
 * - ROUND is half away from zero on the 15-significant-digit value (`excelRound`).
 * - AVERAGE ignores blanks; statuses compare the *rounded* average.
 * - `=` and COUNTIF criteria on text are case-insensitive.
 */

import {
  addDays,
  dateParts,
  dayOfWeek,
  diffDays,
  formatTanggalPendek,
  makeDate,
  maxDate,
  minDate,
  toIsoDate,
  type IsoDate,
} from './dates';

export type { IsoDate } from './dates';
export type DateInput = IsoDate | Date;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const STATIONS = ['SUB', 'DPS', 'CGK', 'HLP', 'KNO'] as const;
export type StationCode = (typeof STATIONS)[number];

export const REPORT_GROUPS = ['SUB', 'DPS', 'CGK & HLP', 'KNO'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export type Gender = 'L' | 'P';
export type ReportConclusion = 'Sesuai' | 'Sesuai dengan Catatan' | 'Perlu Perbaikan' | 'Tidak Sesuai';
export type AssignmentStatus = 'Aktif' | 'Coaching 30 Hari' | 'Diganti' | 'Ditarik';
export type CriteriaStatus = 'Sesuai' | 'Perlu Perbaikan' | 'Tidak Sesuai';
export type Consistency = 'OK' | 'Beda – verifikasi';
export type Trend = '▲ Naik' | '▼ Turun' | '= Tetap';
export type BmiCategory = 'Kurus' | 'Normal' | 'Overweight' | 'Obesitas';
export type HeightRequirement = 'Memenuhi' | 'Tidak Memenuhi' | 'Isi standar di Parameter';
export type ActionStatus = 'Belum Mulai' | 'On Progress' | 'Selesai' | 'Tertunda';
export type ActionKind = 'Sekali' | 'Rutin';
export type ActionFlag = 'Selesai' | 'OVERDUE' | 'Jatuh tempo ≤ 7 hari' | 'Rutin – pantau' | 'On Track';
export type ReplacementPass = 'Lulus – boleh bertugas' | 'Belum lulus' | 'Belum training/dinilai';
/** `Lewat …` carries the deadline, e.g. `Lewat 31 Okt` for the default 31 Oct 2026. */
export type ReplacementTimeliness = 'Tepat waktu' | 'Menunggu' | 'OVERDUE' | `Lewat ${string}`;
export type Reported = 'Ya' | 'Belum';

/**
 * Rolling due dates. In the workbook, items TL10/TL12/TL13 of every report have a
 * `Batas Waktu` formula driven by TODAY() instead of a fixed date.
 */
export type DueRule =
  | 'bulanan-tgl-5' //  TL10: next 5th of the month   (DATE(YEAR(t),MONTH(t)+(DAY(t)>5),5))
  | 'cek-bmi-berikutnya' // TL12: next BMI check date, capped at the last period
  | 'jumat-berikutnya'; //  TL13: next Friday, clamped to Friday of week 1 … Friday of the last week

// ---------------------------------------------------------------------------
// Settings (sheet Parameter)
// ---------------------------------------------------------------------------

export interface Settings {
  week1Start: IsoDate;
  weeks: number;
  bmiFirstCheck: IsoDate;
  bmiIntervalDays: number;
  bmiPeriods: number;
  bmiUnderweightBelow: number;
  bmiNormalMax: number;
  bmiOverweightMax: number;
  minHeightFemale: number | null;
  minHeightMale: number | null;
  passAvgMin: number;
  improveAvgMin: number;
  posttestMin: number;
  replacementDeadline: IsoDate;
}

/** Values of sheet Parameter (C5–C21) and the hard-coded replacement deadline. */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  week1Start: '2026-10-12',
  weeks: 10,
  bmiFirstCheck: '2026-10-12',
  bmiIntervalDays: 14,
  bmiPeriods: 5,
  bmiUnderweightBelow: 18.5,
  bmiNormalMax: 25,
  bmiOverweightMax: 27,
  minHeightFemale: null,
  minHeightMale: null,
  passAvgMin: 4,
  improveAvgMin: 3,
  posttestMin: 80,
  replacementDeadline: '2026-10-31',
});

// ---------------------------------------------------------------------------
// Row shapes (camelCase DB rows; only the fields the rules read are required)
// ---------------------------------------------------------------------------

export interface ScoreFields {
  scoreA: number | null;
  scoreB: number | null;
  scoreC: number | null;
  scoreD: number | null;
  scoreE: number | null;
  scoreF: number | null;
}

export interface StaffRow extends ScoreFields {
  code: string;
  station: string | null;
  name: string | null;
  nipp?: string | null;
  gender: string | null;
  preTest?: number | null;
  postTest: number | null;
  reportConclusion: string | null;
  assignmentStatus?: string | null;
  notes?: string | null;
  bmiNote?: string | null;
  sortOrder?: number | null;
}

export interface WeeklyScoreRow extends ScoreFields {
  staffCode: string;
  week: number;
  observer?: string | null;
  coachingNotes?: string | null;
}

export interface BmiCheckRow {
  staffCode: string;
  period: number;
  checkDate?: IsoDate | null;
  heightCm: number | null;
  weightKg: number | null;
}

export interface ActionItemRow {
  code: string;
  reportGroup: string | null;
  kind: string | null;
  schedule?: string | null;
  dueDate: IsoDate | null;
  status: string | null;
  progress: number | null;
  /** Column `due_rule`. `null` → fixed `dueDate`; `undefined` (column absent) → inferred from `schedule`. */
  dueRule?: DueRule | null;
  area?: string | null;
  action?: string | null;
  target?: string | null;
  pic?: string | null;
  updatedOn?: IsoDate | null;
  evidence?: string | null;
  kpsNotes?: string | null;
  sortOrder?: number | null;
}

export interface ReplacementRow {
  id?: number;
  reportGroup: string | null;
  station?: string | null;
  /** Link to the staff row when the replaced person is in the roster; `replacedName` keeps the sheet text. */
  staffCode?: string | null;
  replacedName: string | null;
  reason?: string | null;
  withdrawnOn?: IsoDate | null;
  replacementName: string | null;
  effectiveOn: IsoDate | null;
  trainingOn?: IsoDate | null;
  postTest: number | null;
  practiceAvg: number | null;
  reported: string | null;
  notes?: string | null;
  sortOrder?: number | null;
}

export interface StationRow {
  code: string;
  reportGroup: string;
  sort?: number | null;
}

// ---------------------------------------------------------------------------
// snake_case → camelCase
// ---------------------------------------------------------------------------

type SnakeToCamel<S extends string> = S extends `${infer H}_${infer T}`
  ? `${H}${Capitalize<SnakeToCamel<T>>}`
  : S;
export type Camelize<T> = { [K in keyof T as K extends string ? SnakeToCamel<K> : K]: T[K] };

/** `{ score_a: 4, week1_start: '…' }` → `{ scoreA: 4, week1Start: '…' }` (shallow). */
export function camelize<T extends object>(row: T): Camelize<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as Camelize<T>;
}

// ---------------------------------------------------------------------------
// Excel primitives
// ---------------------------------------------------------------------------

/**
 * Excel ROUND: half away from zero, applied to the value as Excel sees it
 * (15 significant digits), so binary noise does not decide the tie.
 * `excelRound(3.335, 2) === 3.34`, `excelRound(-2.5) === -3`, `excelRound(18.45, 1) === 18.5`.
 */
export function excelRound(value: number, digits = 0): number {
  if (value === 0) return 0;
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) return value;
  const sign = value < 0 ? -1 : 1;
  const [mantissa, exp] = Math.abs(value).toExponential(14).split('e');
  const shifted = Number(`${mantissa}e${Number(exp) + digits}`);
  const result = sign * Number(`${Math.round(shifted)}e${-digits}`);
  return result === 0 ? 0 : result;
}

/** Removes binary noise from a difference of decimal inputs (3.83 − 3.33 → 0.5, not 0.5000000000000004). */
export function cleanFloat(value: number): number {
  return excelRound(value, 10);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function blank(v: string | null | undefined): boolean {
  return v == null || v.trim() === '';
}

/** Excel text `=`: case-insensitive. */
export function sameText(a: string | null | undefined, b: string): boolean {
  return a != null && a.trim().toUpperCase() === b.toUpperCase();
}

/** COUNTIF-style prefix criterion (`"Sesuai*"`), case-insensitive. */
export function startsWithText(a: string | null | undefined, prefix: string): boolean {
  return a != null && a.trim().toUpperCase().startsWith(prefix.toUpperCase());
}

/** Excel AVERAGE: mean of the numbers, blanks ignored; null when there are none. */
export function average(values: ReadonlyArray<number | null | undefined>): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (isNum(v)) {
      sum += v;
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
}

function asToday(today: DateInput): IsoDate {
  return toIsoDate(today);
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

/** Master SDM D: CGK and HLP share the report "CGK & HLP"; others are their own group. */
export function reportGroupOf(station: string | null | undefined): string | null {
  if (blank(station)) return null;
  const s = station!.trim();
  return sameText(s, 'CGK') || sameText(s, 'HLP') ? 'CGK & HLP' : s;
}

// ---------------------------------------------------------------------------
// Practice scores and status (Master SDM P–S, Log L–N, Rekap F–T)
// ---------------------------------------------------------------------------

export function scoresOf(row: ScoreFields): Array<number | null> {
  return [row.scoreA, row.scoreB, row.scoreC, row.scoreD, row.scoreE, row.scoreF];
}

/** Master SDM P / Log L: `IF(COUNT(A:F)=0,"",ROUND(AVERAGE(A:F),2))`. */
export function practiceAvg(scores: ReadonlyArray<number | null | undefined> | ScoreFields): number | null {
  const list = Array.isArray(scores) ? scores : scoresOf(scores as ScoreFields);
  const avg = average(list);
  return avg === null ? null : excelRound(avg, 2);
}

/**
 * Master SDM R / Rekap S (criteria 6.2):
 * avg < improveAvgMin → Tidak Sesuai; avg ≥ passAvgMin and (no post-test or post-test ≥ posttestMin)
 * → Sesuai; otherwise Perlu Perbaikan.
 */
export function criteriaStatus(
  avg: number | null,
  postTest: number | null | undefined,
  s: Settings,
): CriteriaStatus | null {
  if (avg === null) return null;
  if (avg < s.improveAvgMin) return 'Tidak Sesuai';
  if (avg >= s.passAvgMin && (!isNum(postTest) || postTest >= s.posttestMin)) return 'Sesuai';
  return 'Perlu Perbaikan';
}

/** Log M: criteria status without the post-test term. */
export function weeklyStatus(avg: number | null, s: Settings): CriteriaStatus | null {
  if (avg === null) return null;
  if (avg < s.improveAvgMin) return 'Tidak Sesuai';
  if (avg >= s.passAvgMin) return 'Sesuai';
  return 'Perlu Perbaikan';
}

/** Master SDM S: `LEFT(conclusion,6)=LEFT(status,6)` (case-insensitive) → OK, else "Beda – verifikasi". */
export function consistency(
  reportConclusion: string | null | undefined,
  status: CriteriaStatus | null,
): Consistency | null {
  if (blank(reportConclusion) || status === null) return null;
  const left6 = (x: string) => x.slice(0, 6).toUpperCase();
  return left6(reportConclusion!) === left6(status) ? 'OK' : 'Beda – verifikasi';
}

export interface StaffBaseline {
  practiceAvg: number | null;
  criteriaStatus: CriteriaStatus | null;
  consistency: Consistency | null;
}

/** Master SDM P, R, S for one staff row. */
export function staffBaseline(
  staff: ScoreFields & Pick<StaffRow, 'postTest' | 'reportConclusion'>,
  s: Settings,
): StaffBaseline {
  const avg = practiceAvg(staff);
  const status = criteriaStatus(avg, staff.postTest, s);
  return { practiceAvg: avg, criteriaStatus: status, consistency: consistency(staff.reportConclusion, status) };
}

/** Log N: weekly average − training baseline average. */
export function deltaVsBaseline(weeklyAvg: number | null, baselineAvg: number | null): number | null {
  return weeklyAvg === null || baselineAvg === null ? null : cleanFloat(weeklyAvg - baselineAvg);
}

// ---------------------------------------------------------------------------
// Weeks
// ---------------------------------------------------------------------------

/** Log B: Monday of week n. */
export function weekStart(week: number, s: Settings): IsoDate {
  return addDays(s.week1Start, (week - 1) * 7);
}

/** Laporan C5: last day (Sunday) of week n. */
export function weekEnd(week: number, s: Settings): IsoDate {
  return addDays(weekStart(week, s), 6);
}

/** Monitoring week containing `date` (1 … settings.weeks), or null outside the programme. */
export function weekOfDate(date: DateInput, s: Settings): number | null {
  const n = Math.floor(diffDays(asToday(date), s.week1Start) / 7) + 1;
  return n >= 1 && n <= s.weeks ? n : null;
}

// ---------------------------------------------------------------------------
// Rekap Performa (per staff)
// ---------------------------------------------------------------------------

export interface StaffRekap {
  /** Rekap E. */
  baselineAvg: number | null;
  /** Rekap F…: index 0 = week 1 … weeks−1. */
  weekly: Array<number | null>;
  /** Rekap P: `LOOKUP(9.99E+307, F:O)` = last week that has a score. */
  latest: number | null;
  latestWeek: number | null;
  /** Rekap Q: latest − baseline. */
  gain: number | null;
  /** Rekap R. */
  weeksAssessed: number;
  /** Rekap S: criteria status of the latest score with the training post-test. */
  currentStatus: CriteriaStatus | null;
  /** Rekap T. */
  trend: Trend | null;
}

/**
 * Weekly averages of one staff member (Rekap F–O): AVERAGEIFS of the Log row averages for
 * (staff, week), so duplicate rows for one week average (cannot happen with UNIQUE(staff, week)).
 * Weeks outside 1 … settings.weeks are ignored (the workbook only has those columns).
 */
export function weeklyAverages(rows: readonly WeeklyScoreRow[], s: Settings): Array<number | null> {
  const perWeek: Array<Array<number>> = Array.from({ length: s.weeks }, () => []);
  for (const r of rows) {
    if (!Number.isInteger(r.week) || r.week < 1 || r.week > s.weeks) continue;
    const avg = practiceAvg(r);
    if (avg !== null) perWeek[r.week - 1].push(avg);
  }
  return perWeek.map((xs) => average(xs));
}

export function staffRekap(
  staff: ScoreFields & Pick<StaffRow, 'code' | 'postTest'>,
  weeklyRows: readonly WeeklyScoreRow[],
  s: Settings,
): StaffRekap {
  const baselineAvg = practiceAvg(staff);
  const weekly = weeklyAverages(
    weeklyRows.filter((r) => r.staffCode === staff.code),
    s,
  );
  let latest: number | null = null;
  let latestWeek: number | null = null;
  for (let i = 0; i < weekly.length; i++) {
    const v = weekly[i];
    if (v !== null) {
      latest = v;
      latestWeek = i + 1;
    }
  }
  const gain = latest === null || baselineAvg === null ? null : cleanFloat(latest - baselineAvg);
  return {
    baselineAvg,
    weekly,
    latest,
    latestWeek,
    gain,
    weeksAssessed: weekly.filter((v) => v !== null).length,
    currentStatus: criteriaStatus(latest, staff.postTest, s),
    trend: trendOf(gain),
  };
}

/** Rekap T: sign of the gain. */
export function trendOf(gain: number | null): Trend | null {
  if (gain === null) return null;
  if (gain > 0) return '▲ Naik';
  if (gain < 0) return '▼ Turun';
  return '= Tetap';
}

// ---------------------------------------------------------------------------
// BMI (Cek BMI 2 Mingguan)
// ---------------------------------------------------------------------------

/** BMI I: `ROUND(weight/(height/100)^2, 1)`; null when either is missing. */
export function bmi(heightCm: number | null | undefined, weightKg: number | null | undefined): number | null {
  if (!isNum(heightCm) || !isNum(weightKg) || heightCm <= 0) return null;
  return excelRound(weightKg / (heightCm / 100) ** 2, 1);
}

/** BMI J: on the rounded BMI. < 18.5 Kurus; ≤ 25 Normal; ≤ 27 Overweight; else Obesitas. */
export function bmiCategory(value: number | null, s: Settings): BmiCategory | null {
  if (value === null) return null;
  if (value < s.bmiUnderweightBelow) return 'Kurus';
  if (value <= s.bmiNormalMax) return 'Normal';
  if (value <= s.bmiOverweightMax) return 'Overweight';
  return 'Obesitas';
}

/** BMI AJ. Gender "P" uses the female minimum; any other gender the male minimum. */
export function heightRequirement(
  latestHeight: number | null,
  gender: string | null | undefined,
  s: Settings,
): HeightRequirement | null {
  if (latestHeight === null || blank(gender)) return null;
  const min = sameText(gender, 'P') ? s.minHeightFemale : s.minHeightMale;
  if (!isNum(min)) return 'Isi standar di Parameter';
  return latestHeight >= min ? 'Memenuhi' : 'Tidak Memenuhi';
}

/** BMI header F4…: planned date of check period p. */
export function bmiCheckDate(period: number, s: Settings): IsoDate {
  return addDays(s.bmiFirstCheck, s.bmiIntervalDays * (period - 1));
}

/** Laporan C6: `MIN(periods, INT((week+1)/2))`. */
export function bmiPeriodForWeek(week: number, s: Settings): number {
  return Math.min(s.bmiPeriods, Math.floor((week + 1) / 2));
}

export interface BmiPeriodValue {
  period: number;
  checkDate: IsoDate | null;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  category: BmiCategory | null;
}

export interface BmiSummary {
  /** index 0 = period 1 … bmiPeriods−1; null when that period has no row. */
  periods: Array<BmiPeriodValue | null>;
  /** AE/AF/AH/AI: value from the highest period that has one. */
  latestHeight: number | null;
  latestWeight: number | null;
  latestBmi: number | null;
  latestCategory: BmiCategory | null;
  /** AG: latest weight − first recorded weight. */
  weightDelta: number | null;
  /** AJ. */
  heightRequirement: HeightRequirement | null;
}

/** One staff member's BMI row. Periods outside 1 … bmiPeriods are ignored. */
export function bmiSummary(
  checks: readonly BmiCheckRow[],
  gender: string | null | undefined,
  s: Settings,
): BmiSummary {
  const periods: Array<BmiPeriodValue | null> = Array.from({ length: s.bmiPeriods }, () => null);
  for (const c of checks) {
    if (!Number.isInteger(c.period) || c.period < 1 || c.period > s.bmiPeriods) continue;
    const b = bmi(c.heightCm, c.weightKg);
    periods[c.period - 1] = {
      period: c.period,
      checkDate: c.checkDate ?? null,
      heightCm: isNum(c.heightCm) ? c.heightCm : null,
      weightKg: isNum(c.weightKg) ? c.weightKg : null,
      bmi: b,
      category: bmiCategory(b, s),
    };
  }
  const lastOf = <K extends 'heightCm' | 'weightKg' | 'bmi'>(key: K): number | null => {
    for (let i = periods.length - 1; i >= 0; i--) {
      const v = periods[i]?.[key];
      if (isNum(v)) return v;
    }
    return null;
  };
  const firstWeight = periods.find((p) => isNum(p?.weightKg))?.weightKg ?? null;
  const latestHeight = lastOf('heightCm');
  const latestWeight = lastOf('weightKg');
  const latestBmi = lastOf('bmi');
  return {
    periods,
    latestHeight,
    latestWeight,
    latestBmi,
    latestCategory: bmiCategory(latestBmi, s),
    weightDelta: latestWeight === null || firstWeight === null ? null : cleanFloat(latestWeight - firstWeight),
    heightRequirement: heightRequirement(latestHeight, gender, s),
  };
}

// ---------------------------------------------------------------------------
// Tindak Lanjut
// ---------------------------------------------------------------------------

/**
 * Detects the workbook's rolling due dates from the `Jadwal` text, which states the rule:
 * "(batas = jatuh tempo berikutnya)", "(batas = cek berikutnya)", "(batas = Jumat berikutnya)".
 */
export function inferDueRule(schedule: string | null | undefined): DueRule | null {
  if (blank(schedule)) return null;
  const t = schedule!.toLowerCase();
  if (!/batas\s*=/.test(t)) return null;
  if (/batas\s*=\s*jatuh tempo berikutnya/.test(t) && /tanggal\s+5\b/.test(t)) return 'bulanan-tgl-5';
  if (/batas\s*=\s*cek berikutnya/.test(t)) return 'cek-bmi-berikutnya';
  if (/batas\s*=\s*jumat berikutnya/.test(t)) return 'jumat-berikutnya';
  return null;
}

export function actionDueRule(item: Pick<ActionItemRow, 'schedule' | 'dueRule'>): DueRule | null {
  return item.dueRule !== undefined ? item.dueRule : inferDueRule(item.schedule);
}

/** Tindak Lanjut I14/I16/I17 (and the same rows of every report). */
export function rollingDueDate(rule: DueRule, s: Settings, today: DateInput): IsoDate {
  const t = asToday(today);
  switch (rule) {
    case 'bulanan-tgl-5': {
      const { year, month, day } = dateParts(t);
      return makeDate(year, month + (day > 5 ? 1 : 0), 5);
    }
    case 'cek-bmi-berikutnya': {
      const last = addDays(s.bmiFirstCheck, s.bmiIntervalDays * (s.bmiPeriods - 1));
      const elapsed = diffDays(t, s.bmiFirstCheck);
      // MAX(0, ROUNDUP(elapsed/interval, 0)); ROUNDUP rounds away from zero, MAX clamps negatives.
      const k = elapsed <= 0 ? 0 : Math.ceil(elapsed / s.bmiIntervalDays);
      return minDate(last, addDays(s.bmiFirstCheck, s.bmiIntervalDays * k));
    }
    case 'jumat-berikutnya': {
      const lastFriday = addDays(s.week1Start, (s.weeks - 1) * 7 + 4);
      const firstFriday = addDays(s.week1Start, 4);
      const untilFriday = (((5 - dayOfWeek(t)) % 7) + 7) % 7; // MOD(6-WEEKDAY(t),7)
      return minDate(lastFriday, maxDate(firstFriday, addDays(t, untilFriday)));
    }
  }
}

/** Due date as the workbook shows it today: rolling rule if the item has one, else `dueDate`. */
export function effectiveDueDate(
  item: Pick<ActionItemRow, 'dueDate' | 'schedule' | 'dueRule'>,
  s: Settings,
  today: DateInput,
): IsoDate | null {
  const rule = actionDueRule(item);
  return rule ? rollingDueDate(rule, s, today) : (item.dueDate ?? null);
}

/** Tindak Lanjut P: null if no due date or status Selesai; due − today. */
export function daysLeft(
  dueDate: IsoDate | null | undefined,
  status: string | null | undefined,
  today: DateInput,
): number | null {
  if (blank(dueDate) || sameText(status, 'Selesai')) return null;
  return diffDays(dueDate!, asToday(today));
}

export function actionDaysLeft(
  item: Pick<ActionItemRow, 'dueDate' | 'schedule' | 'dueRule' | 'status'>,
  s: Settings,
  today: DateInput,
): number | null {
  return daysLeft(effectiveDueDate(item, s, today), item.status, today);
}

/**
 * Tindak Lanjut Q. Order matters: Selesai, no due date, overdue, due within 7 days
 * (also for Rutin items), Rutin, On Track.
 */
export function actionFlag(
  item: Pick<ActionItemRow, 'dueDate' | 'schedule' | 'dueRule' | 'status' | 'kind'>,
  s: Settings,
  today: DateInput,
): ActionFlag | null {
  if (sameText(item.status, 'Selesai')) return 'Selesai';
  const due = effectiveDueDate(item, s, today);
  if (blank(due)) return null;
  const left = diffDays(due!, asToday(today));
  if (left < 0) return 'OVERDUE';
  if (left <= 7) return 'Jatuh tempo ≤ 7 hari';
  if (sameText(item.kind, 'Rutin')) return 'Rutin – pantau';
  return 'On Track';
}

// ---------------------------------------------------------------------------
// Penggantian SDM
// ---------------------------------------------------------------------------

/** Penggantian L. */
export function replacementPass(
  r: Pick<ReplacementRow, 'replacementName' | 'postTest' | 'practiceAvg'>,
  s: Settings,
): ReplacementPass | null {
  if (blank(r.replacementName)) return null;
  if (!isNum(r.postTest) || !isNum(r.practiceAvg)) return 'Belum training/dinilai';
  return r.postTest >= s.posttestMin && r.practiceAvg >= s.passAvgMin ? 'Lulus – boleh bertugas' : 'Belum lulus';
}

/** Penggantian M. On the deadline day itself a missing effective date is still "Menunggu". */
export function replacementTimeliness(
  r: Pick<ReplacementRow, 'replacedName' | 'effectiveOn'>,
  s: Settings,
  today: DateInput,
): ReplacementTimeliness | null {
  if (blank(r.replacedName)) return null;
  if (blank(r.effectiveOn)) {
    return diffDays(asToday(today), s.replacementDeadline) > 0 ? 'OVERDUE' : 'Menunggu';
  }
  return diffDays(r.effectiveOn!, s.replacementDeadline) <= 0
    ? 'Tepat waktu'
    : `Lewat ${formatTanggalPendek(s.replacementDeadline)}`;
}
