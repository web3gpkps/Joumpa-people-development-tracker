/*
 * Row model and pure view logic of the Cek BMI tracker (no React, no server code), covered
 * by tracker-model.test.ts. Formulas stay in lib/rules; this only shapes rows, filters
 * them, counts them and applies an edit to a row so the screen can show a save at once.
 */
import type { BmiCategory, BmiCheckRow, Settings } from "@/lib/rules";
import { trackerSummary, type BmiSummary } from "./schedule";
import type { CheckField } from "./entry";

/** One stored check: the database refuses a check without both height and weight. */
export type BmiStoredCheck = {
  date: string | null;
  heightCm: number;
  weightKg: number;
};

/** One staff member as the tracker needs them (plain data, sent from the server screen). */
export type BmiTrackerRow = {
  /** The staff code (ID SDM): the key of every save, never shown in a branch account's view. */
  code: string;
  /**
   * What the first identity column shows and the search matches: the staff code, or the NIPP
   * (No Pegawai) in a branch account's view. Empty means the staff member has none.
   */
  displayId?: string;
  /** NIPP as stored, for the profile form. Not shown in the table of a link or the owner. */
  employeeNo?: string | null;
  name: string;
  /** Station code, shown in the Stasiun column. */
  station: string | null;
  gender: string | null;
  /** Catatan / Program Penyesuaian BB (sheet column AK). */
  fitnessNote: string | null;
  assignmentStatus: string | null;
  /** "tautan ini, 8 Okt 07.55": who last changed one of this person's checks. */
  changed: string | null;
  /** Index 0 is period 1. null when that period has no check. */
  checks: Array<BmiStoredCheck | null>;
};

export type BmiRowView = { row: BmiTrackerRow; summary: BmiSummary };

export function summarizeRow(row: BmiTrackerRow, settings: Settings, today: string): BmiSummary {
  const checks: BmiCheckRow[] = [];
  row.checks.forEach((check, i) => {
    if (check) {
      checks.push({
        staffCode: row.code,
        period: i + 1,
        checkDate: check.date,
        heightCm: check.heightCm,
        weightKg: check.weightKg,
      });
    }
  });
  return trackerSummary(checks, row.gender, settings, today);
}

const summaryCache = new WeakMap<BmiTrackerRow, { settings: Settings; today: string; summary: BmiSummary }>();

/**
 * summarizeRow, remembered per row object: an edit replaces only its own row, so the other
 * 700 rows keep their summary (and their identity, which keeps the table rows from redrawing).
 */
export function summaryOf(row: BmiTrackerRow, settings: Settings, today: string): BmiSummary {
  const hit = summaryCache.get(row);
  if (hit && hit.settings === settings && hit.today === today) return hit.summary;
  const summary = summarizeRow(row, settings, today);
  summaryCache.set(row, { settings, today, summary });
  return summary;
}

/** True when period `period` (1-based) holds a complete check, so it has a BMI. */
export function isCheckedIn(summary: BmiSummary, period: number): boolean {
  return summary.periods[period - 1]?.bmi != null;
}

export type StatusFilter = "all" | "late" | "checked" | "pending" | "due";

export const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Semua status" },
  { value: "late", label: "Terlambat cek" },
  { value: "checked", label: "Sudah dicek" },
  { value: "pending", label: "Belum dicek" },
  { value: "due", label: "Segera dijadwalkan" },
];

export function isStatusFilter(value: string): value is StatusFilter {
  return STATUS_FILTERS.some((f) => f.value === value);
}

/** The id a row shows: its displayId when the screen sets one, otherwise the staff code. */
export function idOf(row: Pick<BmiTrackerRow, "code" | "displayId">): string {
  return row.displayId ?? row.code;
}

/** The BMI category filter: every category, or one of the four (matched on the latest check, the Kategori Terakhir column). */
export type CategoryFilter = "all" | BmiCategory;

export const CATEGORY_FILTERS: ReadonlyArray<{ value: CategoryFilter; label: string }> = [
  { value: "all", label: "Semua kategori" },
  { value: "Normal", label: "Normal" },
  { value: "Kurus", label: "Kurus" },
  { value: "Overweight", label: "Overweight" },
  { value: "Obesitas", label: "Obesitas" },
];

export function isCategoryFilter(value: string): value is CategoryFilter {
  return CATEGORY_FILTERS.some((f) => f.value === value);
}

export type RowFilters = {
  /** Name or ID (No Pegawai in a branch account's view), any case. */
  query: string;
  status: StatusFilter;
  /** Latest BMI category; "all" leaves everybody in, including people with no check yet. */
  category: CategoryFilter;
  /** The chosen period, 1-based: "Sudah dicek" and "Belum dicek" are about this one. */
  period: number;
};

/** Rows that pass the search, the status and the category filter, in their original order. */
export function filterViews(views: readonly BmiRowView[], f: RowFilters): BmiRowView[] {
  const query = f.query.trim().toLowerCase();
  return views.filter(({ row, summary }) => {
    if (query && !`${idOf(row)} ${row.name}`.toLowerCase().includes(query)) return false;
    if (f.category !== "all" && summary.latestCategory !== f.category) return false;
    if (f.status === "late" && summary.scheduleStatus !== "Terlambat cek") return false;
    if (f.status === "due" && summary.scheduleStatus !== "Cek ≤ 7 hari") return false;
    const checked = isCheckedIn(summary, f.period);
    if (f.status === "checked" && !checked) return false;
    if (f.status === "pending" && checked) return false;
    return true;
  });
}

export type TrackerMetrics = {
  total: number;
  /** Checked in the chosen period. */
  checked: number;
  /** checked / total as a whole percentage, 0 when there is nobody. */
  checkedPct: number;
  late: number;
  /** Latest BMI category is Overweight or Obesitas. */
  aboveNormal: number;
};

export function trackerMetrics(views: readonly BmiRowView[], period: number): TrackerMetrics {
  let checked = 0;
  let late = 0;
  let aboveNormal = 0;
  for (const { summary } of views) {
    if (isCheckedIn(summary, period)) checked += 1;
    if (summary.scheduleStatus === "Terlambat cek") late += 1;
    if (summary.latestCategory === "Overweight" || summary.latestCategory === "Obesitas") aboveNormal += 1;
  }
  const total = views.length;
  return { total, checked, checkedPct: total === 0 ? 0 : Math.round((checked / total) * 100), late, aboveNormal };
}

/** The cell a person clicked to change. */
export type EditTarget =
  | { kind: "fitnessNote"; code: string }
  | { kind: "check"; code: string; period: number; field: CheckField };

export type RowEdit =
  | { type: "check"; code: string; period: number; check: BmiStoredCheck | null }
  | {
      type: "profile";
      code: string;
      patch: Partial<Pick<BmiTrackerRow, "fitnessNote" | "name" | "gender" | "employeeNo" | "displayId">>;
    };

/** The rows with one edit applied (a new array; only the edited row is a new object). */
export function applyEdit(rows: readonly BmiTrackerRow[], edit: RowEdit): BmiTrackerRow[] {
  return rows.map((row) => {
    if (row.code !== edit.code) return row;
    if (edit.type === "profile") return { ...row, ...edit.patch };
    const checks = [...row.checks];
    checks[edit.period - 1] = edit.check;
    return { ...row, checks };
  });
}
