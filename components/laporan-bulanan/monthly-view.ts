/*
 * Laporan Bulanan's view over the workspace: rows in display order, the Cabang and Periode
 * filters, the summary per period and the defaults for a new report. Pure and client-safe; the
 * derived columns (Tepat waktu?, % Sesuai, Capai target) come from lib/pd-rules.
 */
import { BULAN_SINGKAT, dateParts, makeDate, type IsoDate } from "@/lib/dates";
import { monthlyOnTime, monthlyTargetMet, periodLabel } from "@/lib/pd-rules";
import { changedVia, shortDateTime } from "@/lib/workspace/view";
import type { Workspace, WorkspaceMonthlyReport } from "@/lib/workspace";

/** Value of the "all" option of both filters (a Cabang or a month is never this). */
export const ALL = "semua";

/** Indeks kepuasan target (≥ 4,25), set for KNO and BPN only. */
export const SATISFACTION_TARGET = 4.25;
export const SATISFACTION_GROUPS: readonly string[] = ["KNO", "BPN"];

/** One Laporan Bulanan row as the screen shows and edits it. */
export type MonthlyReportRow = {
  /** reportGroup + period: the table's primary key. */
  key: string;
  reportGroup: string;
  period: string;
  periodLabel: string;
  dueOn: string | null;
  receivedOn: string | null;
  activeStaff: number | null;
  compliantStaff: number | null;
  complaints: number | null;
  responded: string | null;
  satisfaction: number | null;
  notes: string | null;
  /** "tautan ini, 8 Okt 14.05" or null for a row never changed through the app. */
  changed: string | null;
};

export function reportKey(reportGroup: string, period: string): string {
  return `${reportGroup}|${period}`;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "2026-10" from '2026-10-01' (the ?periode= value). */
export function monthValue(period: string): string {
  return period.slice(0, 7);
}

/** '2026-10-01' from "2026-10", or null when it is not a real month. */
export function periodFromMonth(month: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const mo = Number(m[2]);
  if (year < 2000 || year > 2100 || mo < 1 || mo > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** The report is due on the 5th of the next month: '2026-10-01' → '2026-11-05'. */
export function defaultDueOn(period: string): IsoDate {
  const { year, month } = dateParts(period);
  return makeDate(year, month + 1, 5);
}

/** First day of today's month: the period a new report most likely covers. */
export function currentPeriod(today: IsoDate): string {
  return `${today.slice(0, 7)}-01`;
}

/**
 * Rows in display order: oldest period first (the next report due sits on top), then Cabang in station order (a Cabang the
 * stations no longer list goes last, by name).
 */
export function toRows(ws: Pick<Workspace, "monthlyReports" | "linkId" | "linkLabels">, groups: string[]): MonthlyReportRow[] {
  const order = new Map(groups.map((g, i) => [g, i] as const));
  const rank = (g: string) => order.get(g) ?? groups.length;
  return [...ws.monthlyReports]
    .sort(
      (a, b) =>
        a.period.localeCompare(b.period) || rank(a.reportGroup) - rank(b.reportGroup) || a.reportGroup.localeCompare(b.reportGroup),
    )
    .map((r) => toRow(r, ws));
}

function toRow(r: WorkspaceMonthlyReport, ws: Pick<Workspace, "linkId" | "linkLabels">): MonthlyReportRow {
  const when = shortDateTime(r.updatedAt);
  return {
    key: reportKey(r.reportGroup, r.period),
    reportGroup: r.reportGroup,
    period: r.period,
    periodLabel: periodLabel(r.period),
    dueOn: r.dueOn ?? null,
    receivedOn: r.receivedOn ?? null,
    activeStaff: num(r.activeStaff),
    compliantStaff: num(r.compliantStaff),
    complaints: num(r.complaints),
    responded: r.responded ?? null,
    satisfaction: num(r.satisfaction),
    notes: r.notes ?? null,
    changed: r.updatedAt ? `${changedVia(r, ws)}${when ? `, ${when}` : ""}` : null,
  };
}

export type Filters = { group: string | null; period: string | null };

/** ?cabang= and ?periode= checked against what the rows hold; anything else is "semua". */
export function parseFilters(rows: MonthlyReportRow[], cabang: string | undefined, periode: string | undefined): Filters {
  const group = cabang && rows.some((r) => r.reportGroup === cabang) ? cabang : null;
  const period = periodFromMonth(periode);
  return { group, period: period && rows.some((r) => r.period === period) ? period : null };
}

export function applyFilters(rows: MonthlyReportRow[], filters: Filters): MonthlyReportRow[] {
  return rows.filter((r) => (!filters.group || r.reportGroup === filters.group) && (!filters.period || r.period === filters.period));
}

/** Cabang that hold a report, in row order (station order), for the filter. */
export function groupsWithReports(rows: MonthlyReportRow[], groups: string[]): string[] {
  const present = new Set(rows.map((r) => r.reportGroup));
  return [...groups.filter((g) => present.has(g)), ...[...present].filter((g) => !groups.includes(g)).sort()];
}

/** Periods that hold a report, newest first, for the filter. */
export function periodsWithReports(rows: MonthlyReportRow[]): string[] {
  return [...new Set(rows.map((r) => r.period))].sort((a, b) => b.localeCompare(a));
}

export type PeriodSummary = {
  period: string;
  label: string;
  /** Rows (Cabang) for this period. */
  reports: number;
  received: number;
  onTime: number;
  /** Received late, or still missing after the due date. */
  late: number;
  /** "% Sesuai" known. */
  measured: number;
  targetMet: number;
  complaints: number;
  /** Rows whose complaints are not all answered within 1×24 jam ("Belum" or "Tidak"). */
  unresponded: number;
};

/** One line per period, oldest first: received, on time, meeting the ≥ 90% target. */
export function periodSummaries(rows: MonthlyReportRow[], today: IsoDate): PeriodSummary[] {
  const byPeriod = new Map<string, MonthlyReportRow[]>();
  for (const r of rows) byPeriod.set(r.period, [...(byPeriod.get(r.period) ?? []), r]);
  return [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, list]) => ({
      period,
      label: periodLabel(period),
      reports: list.length,
      received: list.filter((r) => r.receivedOn).length,
      onTime: list.filter((r) => monthlyOnTime(r, today) === "Ya").length,
      late: list.filter((r) => monthlyOnTime(r, today) === "Terlambat").length,
      measured: list.filter((r) => monthlyTargetMet(r) !== null).length,
      targetMet: list.filter((r) => monthlyTargetMet(r) === "Ya").length,
      complaints: list.reduce((n, r) => n + (r.complaints ?? 0), 0),
      unresponded: list.filter((r) => r.responded === "Belum" || r.responded === "Tidak").length,
    }));
}

/** True when a KNO / BPN satisfaction index is below 4,25 (the only Cabang with that target). */
export function satisfactionBelowTarget(row: Pick<MonthlyReportRow, "reportGroup">, value: number | null): boolean {
  return value !== null && SATISFACTION_GROUPS.includes(row.reportGroup) && value < SATISFACTION_TARGET;
}

/** Month choices for a new report: "01" Jan .. "12" Des. */
export const MONTH_OPTIONS = BULAN_SINGKAT.map((label, i) => ({ value: String(i + 1).padStart(2, "0"), label }));

/** Years offered for a new report: last year to next year, plus any year already reported. */
export function yearOptions(today: IsoDate, rows: Pick<MonthlyReportRow, "period">[]): string[] {
  const year = Number(today.slice(0, 4));
  const years = new Set([year - 1, year, year + 1, ...rows.map((r) => Number(r.period.slice(0, 4)))]);
  return [...years].sort((a, b) => a - b).map(String);
}
