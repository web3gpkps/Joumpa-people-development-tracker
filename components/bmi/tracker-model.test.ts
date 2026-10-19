import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/rules";
import {
  CATEGORY_FILTERS,
  applyEdit,
  filterViews,
  idOf,
  isCategoryFilter,
  isCheckedIn,
  summarizeRow,
  summaryOf,
  trackerMetrics,
  type BmiRowView,
  type BmiTrackerRow,
} from "./tracker-model";

// 6 is only the fixture here; the model takes the length from the settings (see "another number of periods").
const settings: Settings = { ...DEFAULT_SETTINGS, bmiFirstCheck: "2026-10-12", bmiIntervalDays: 14, bmiPeriods: 6 };
// 3 Nov: the first window (12–25 Okt) has closed; the second (26 Okt–8 Nov) closes within a week.
const today = "2026-11-03";

function emptyChecks(periods: number): BmiTrackerRow["checks"] {
  return Array.from({ length: periods }, () => null);
}

function row(code: string, name: string, patch: Partial<BmiTrackerRow> = {}): BmiTrackerRow {
  return {
    code,
    name,
    station: "AAA",
    gender: "L",
    fitnessNote: null,
    assignmentStatus: "Aktif",
    changed: null,
    checks: emptyChecks(settings.bmiPeriods),
    ...patch,
  };
}

const withCheck = (period: number, heightCm: number, weightKg: number, date: string, periods = settings.bmiPeriods) => {
  const checks = emptyChecks(periods);
  checks[period - 1] = { date, heightCm, weightKg };
  return checks;
};

// T-01: normal in period 1 (next check due by 8 Nov, due soon). T-02: obese, checked 19 Okt
// (next check due by 15 Nov, scheduled). T-03: never checked (late since 25 Okt).
const rows = [
  row("T-01", "Petugas Satu", { checks: withCheck(1, 170, 60, "2026-10-12") }),
  row("T-02", "Petugas Dua", { checks: withCheck(1, 160, 90, "2026-10-19"), gender: "P" }),
  row("T-03", "Petugas Tiga"),
];
const views: BmiRowView[] = rows.map((r) => ({ row: r, summary: summarizeRow(r, settings, today) }));
const base = { query: "", status: "all" as const, category: "all" as const, period: 1 };
const codes = (list: BmiRowView[]) => list.map((v) => v.row.code);

describe("summarizeRow", () => {
  test("builds the BMI summary from the stored checks", () => {
    expect(views[0].summary.latestBmi).toBe(20.8);
    expect(views[0].summary.latestCategory).toBe("Normal");
    expect(views[1].summary.latestCategory).toBe("Obesitas");
    expect(views[2].summary.latestBmi).toBeNull();
    expect(isCheckedIn(views[0].summary, 1)).toBe(true);
    expect(isCheckedIn(views[0].summary, 2)).toBe(false);
  });

  test("everyone is checked on the same rhythm: the next check is one interval after the last", () => {
    expect(views[0].summary.nextCheck).toBe("2026-10-26");
    expect(views[1].summary.nextCheck).toBe("2026-11-02");
    expect(views[2].summary.nextCheck).toBe("2026-10-12");
  });

  test("Syarat Tinggi Badan follows L/P and the minimum heights in Parameter", () => {
    const s = { ...settings, minHeightMale: 165, minHeightFemale: 155 };
    expect(summarizeRow(rows[0], s, today).heightRequirement).toBe("Memenuhi");
    expect(summarizeRow({ ...rows[0], gender: "P", checks: withCheck(1, 150, 50, "2026-10-12") }, s, today).heightRequirement).toBe("Tidak Memenuhi");
    expect(summarizeRow({ ...rows[0], gender: null }, s, today).heightRequirement).toBeNull();
  });
});

describe("summaryOf", () => {
  test("is the same summary object for the same row, a new one for an edited row", () => {
    const first = summaryOf(rows[0], settings, today);
    expect(summaryOf(rows[0], settings, today)).toBe(first);
    const [edited] = applyEdit(rows, { type: "check", code: "T-01", period: 2, check: { date: "2026-10-26", heightCm: 170, weightKg: 62 } });
    expect(summaryOf(edited, settings, today)).not.toBe(first);
    expect(summaryOf(edited, settings, today).checks).toBe(2);
    expect(summaryOf(rows[0], settings, "2026-10-21")).not.toBe(first);
  });
});

describe("filterViews", () => {
  test("search matches the name or the ID, any case, and trims", () => {
    expect(codes(filterViews(views, { ...base, query: "  dua " }))).toEqual(["T-02"]);
    expect(codes(filterViews(views, { ...base, query: "t-03" }))).toEqual(["T-03"]);
    expect(filterViews(views, { ...base, query: "tidak ada" })).toEqual([]);
  });

  test("the category filter keeps the people whose latest check is in that category", () => {
    // T-01 Normal, T-02 Obesitas, T-03 no check yet.
    expect(codes(filterViews(views, { ...base, category: "Normal" }))).toEqual(["T-01"]);
    expect(codes(filterViews(views, { ...base, category: "Obesitas" }))).toEqual(["T-02"]);
    expect(filterViews(views, { ...base, category: "Overweight" })).toEqual([]);
    expect(filterViews(views, { ...base, category: "Kurus" })).toEqual([]);
    expect(codes(filterViews(views, { ...base, category: "all" }))).toEqual(["T-01", "T-02", "T-03"]);
  });

  test("the category filter combines with the other filters", () => {
    expect(codes(filterViews(views, { ...base, category: "Obesitas", query: "dua" }))).toEqual(["T-02"]);
    expect(filterViews(views, { ...base, category: "Obesitas", query: "satu" })).toEqual([]);
    expect(codes(filterViews(views, { ...base, category: "Normal", status: "due" }))).toEqual(["T-01"]);
  });

  test("a category the person had before the latest check no longer counts", () => {
    const moved = { ...rows[0], checks: [rows[0].checks[0], { date: "2026-10-19", heightCm: 170, weightKg: 90 }, ...rows[0].checks.slice(2)] };
    const v = [{ row: moved, summary: summarizeRow(moved, settings, today) }];
    expect(filterViews(v, { ...base, category: "Normal" })).toEqual([]);
    expect(filterViews(v, { ...base, category: "Obesitas" })).toHaveLength(1);
  });

  test("the filter options are the four categories after \"all\"", () => {
    expect(CATEGORY_FILTERS.map((f) => f.value)).toEqual(["all", "Normal", "Kurus", "Overweight", "Obesitas"]);
    expect(isCategoryFilter("Overweight")).toBe(true);
    expect(isCategoryFilter("Gemuk")).toBe(false);
  });

  test("a branch account's view searches the employee number, not the staff code", () => {
    const branch: BmiRowView[] = views.map((v, i) => ({ ...v, row: { ...v.row, displayId: ["198001", "198002", ""][i] } }));
    expect(codes(filterViews(branch, { ...base, query: "198002" }))).toEqual(["T-02"]);
    expect(codes(filterViews(branch, { ...base, query: "t-02" }))).toEqual([]);
    expect(codes(filterViews(branch, { ...base, query: "tiga" }))).toEqual(["T-03"]);
    expect(idOf(branch[0].row)).toBe("198001");
    expect(idOf(branch[2].row)).toBe("");
    expect(idOf(views[0].row)).toBe("T-01");
  });

  test("status filters follow the schedule and the chosen period", () => {
    expect(codes(filterViews(views, { ...base, status: "late" }))).toEqual(["T-03"]);
    expect(codes(filterViews(views, { ...base, status: "due" }))).toEqual(["T-01"]);
    expect(codes(filterViews(views, { ...base, status: "checked" }))).toEqual(["T-01", "T-02"]);
    expect(codes(filterViews(views, { ...base, status: "pending" }))).toEqual(["T-03"]);
    expect(codes(filterViews(views, { ...base, status: "checked", period: 2 }))).toEqual([]);
    expect(codes(filterViews(views, { ...base, status: "pending", period: 2 }))).toEqual(["T-01", "T-02", "T-03"]);
  });

  test("search keeps the order", () => {
    expect(codes(filterViews(views, base))).toEqual(["T-01", "T-02", "T-03"]);
  });
});

describe("trackerMetrics", () => {
  test("counts the chosen period, late checks and the latest BMI above normal", () => {
    expect(trackerMetrics(views, 1)).toEqual({ total: 3, checked: 2, checkedPct: 67, late: 1, aboveNormal: 1 });
    expect(trackerMetrics(views, 2).checked).toBe(0);
  });
  test("nobody means zeros, never NaN", () => {
    expect(trackerMetrics([], 1)).toEqual({ total: 0, checked: 0, checkedPct: 0, late: 0, aboveNormal: 0 });
  });
});

describe("applyEdit", () => {
  test("a saved check replaces one period and leaves other rows untouched", () => {
    const next = applyEdit(rows, {
      type: "check",
      code: "T-03",
      period: 2,
      check: { date: "2026-10-26", heightCm: 165, weightKg: 70 },
    });
    expect(next[2].checks[1]).toEqual({ date: "2026-10-26", heightCm: 165, weightKg: 70 });
    expect(next[0]).toBe(rows[0]);
    expect(rows[2].checks[1]).toBeNull();
    expect(summarizeRow(next[2], settings, today).latestBmi).toBe(25.7);
  });

  test("deleting a check empties the period", () => {
    const next = applyEdit(rows, { type: "check", code: "T-01", period: 1, check: null });
    expect(next[0].checks[0]).toBeNull();
    expect(summarizeRow(next[0], settings, today).latestBmi).toBeNull();
  });

  test("a profile edit changes only the given fields", () => {
    const next = applyEdit(rows, { type: "profile", code: "T-02", patch: { fitnessNote: "Kurangi gula" } });
    expect(next[1].fitnessNote).toBe("Kurangi gula");
    expect(next[1].gender).toBe("P");
    expect(next[1].name).toBe("Petugas Dua");
  });

  test("a profile correction changes the name, NIPP, L/P and the id shown", () => {
    const branch = [{ ...rows[0], displayId: "180501" }];
    const [next] = applyEdit(branch, {
      type: "profile",
      code: "T-01",
      patch: { name: "Nama Benar", employeeNo: "190001", gender: "P", displayId: "190001" },
    });
    expect(next).toMatchObject({ name: "Nama Benar", employeeNo: "190001", gender: "P", displayId: "190001" });
    expect(idOf(next)).toBe("190001");
    expect(next.checks).toBe(branch[0].checks);
  });
});

describe("another number of periods", () => {
  // Parameter allows 1 to 52 checks; the model must not care.
  for (const periods of [1, 8, 26, 52]) {
    const s: Settings = { ...settings, bmiPeriods: periods };

    test(`${periods} periods: summary, metrics, filters and edits work on the last period`, () => {
      const last = periods;
      const person = row("L-01", "Petugas Akhir", { checks: withCheck(last, 170, 60, "2027-03-01", periods) });
      const never = row("L-02", "Petugas Baru", { checks: emptyChecks(periods) });
      const list = [person, never].map((r) => ({ row: r, summary: summarizeRow(r, s, "2027-03-02") }));

      expect(list[0].summary.periods).toHaveLength(periods);
      expect(isCheckedIn(list[0].summary, last)).toBe(true);
      expect(isCheckedIn(list[0].summary, 1)).toBe(periods === 1);
      expect(trackerMetrics(list, last).checked).toBe(1);
      expect(codes(filterViews(list, { ...base, status: "checked", period: last }))).toEqual(["L-01"]);
      expect(codes(filterViews(list, { ...base, status: "pending", period: last }))).toEqual(["L-02"]);

      const next = applyEdit([person, never], { type: "check", code: "L-02", period: last, check: { date: "2027-03-02", heightCm: 160, weightKg: 50 } });
      expect(next[1].checks).toHaveLength(periods);
      expect(next[1].checks[last - 1]).toEqual({ date: "2027-03-02", heightCm: 160, weightKg: 50 });
      expect(summarizeRow(next[1], s, "2027-03-02").checks).toBe(1);
    });
  }

  test("a stored check beyond the periods in Parameter is not counted", () => {
    const s: Settings = { ...settings, bmiPeriods: 8 };
    const long = row("L-03", "Petugas Panjang", { checks: withCheck(10, 170, 60, "2027-02-01", 12) });
    expect(summarizeRow(long, s, "2027-03-02").checks).toBe(0);
  });
});
