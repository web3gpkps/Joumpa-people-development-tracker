import { describe, expect, test } from "bun:test";
import type { WorkspaceActionPlan } from "@/lib/workspace";
import {
  activeFilterCount,
  compareItemNo,
  daysLeftLabel,
  filterPlans,
  filterQuery,
  parseFilters,
  percentLabel,
  sortPlans,
  summarize,
  toPlanView,
  type PlanView,
} from "./plan-view";

const TODAY = "2026-10-19";
const ws = { linkId: "link-1", linkLabels: { "link-2": "Tautan DPS" } };

function row(over: Partial<WorkspaceActionPlan> = {}): WorkspaceActionPlan {
  return {
    id: 1,
    itemNo: "1",
    area: "Grooming",
    action: "Grooming check harian",
    reportGroup: "SUB",
    target: null,
    dueDate: null,
    pic: null,
    status: "Belum Mulai",
    progress: 0,
    doneOn: null,
    evidence: null,
    notes: null,
    sortOrder: 1,
    archivedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-18T07:55:00Z",
    updatedByLink: null,
    ...over,
  };
}

const view = (over: Partial<WorkspaceActionPlan> = {}) => toPlanView(row(over), TODAY, ws);

describe("toPlanView", () => {
  test("flag from lib/pd-rules planFlag, days left only while open", () => {
    expect(view({ dueDate: "2026-10-17" }).flag).toBe("Terlambat");
    expect(view({ dueDate: "2026-10-17" }).daysLeft).toBe(-2);
    expect(view({ dueDate: "2026-10-24" }).flag).toBe("Jatuh tempo ≤ 7 hari");
    expect(view({ dueDate: "2026-11-30" }).flag).toBe("On track");
    expect(view({ dueDate: "2026-10-17", status: "Selesai" }).flag).toBe("Selesai");
    expect(view({ dueDate: "2026-10-17", status: "Batal / N.A." }).daysLeft).toBeNull();
    expect(view().daysLeft).toBeNull();
  });

  test("who changed the row last", () => {
    expect(view({ updatedByLink: "link-1" }).changedLabel).toStartWith("Diubah lewat tautan ini, 18 Okt");
    expect(view({ updatedByLink: "link-2" }).changedLabel).toStartWith("Diubah lewat Tautan DPS");
    expect(view().changedLabel).toStartWith("Diubah lewat pengelola, akun cabang, atau Google Sheet");
  });
});

describe("compareItemNo", () => {
  test("workbook reading order, blanks last", () => {
    const list = ["10", "6b", "", "2", "6a", "1", "A", null];
    expect([...list].sort(compareItemNo)).toEqual(["1", "2", "6a", "6b", "10", "A", "", null]);
  });
});

describe("sortPlans", () => {
  test("area order, then No, then Cabang order", () => {
    const rows: PlanView[] = [
      view({ id: 1, area: "Bahasa", itemNo: "2", reportGroup: "SUB" }),
      view({ id: 2, area: "Grooming", itemNo: "10", reportGroup: "DPS" }),
      view({ id: 3, area: "Grooming", itemNo: "6a", reportGroup: "SUB" }),
      view({ id: 4, area: "Grooming", itemNo: "6a", reportGroup: "CGK & HLP" }),
      view({ id: 5, area: "Lainnya", itemNo: "1", reportGroup: "SUB" }),
    ];
    const sorted = sortPlans(rows, ["Grooming", "Bahasa"], ["CGK & HLP", "DPS", "SUB"]);
    expect(sorted.map((r) => r.id)).toEqual([4, 3, 2, 1, 5]);
  });
});

describe("parseFilters", () => {
  const ctx = { isKps: true, groups: ["CGK & HLP", "SUB"], areas: ["Grooming"] };

  test("keeps known values only", () => {
    expect(parseFilters({ cabang: "SUB", area: "Grooming", flag: "Terlambat", q: "  bmi " }, ctx)).toEqual({
      cabang: "SUB",
      area: "Grooming",
      flag: "Terlambat",
      status: null,
      q: "bmi",
    });
    expect(parseFilters({ cabang: "XXX", area: "Nope", flag: "late", status: "Proses" }, ctx)).toEqual({
      cabang: null,
      area: null,
      flag: null,
      status: "Proses",
      q: "",
    });
  });

  test("a station scope never filters by Cabang; a flag wins over a status", () => {
    expect(parseFilters({ cabang: "SUB" }, { ...ctx, isKps: false }).cabang).toBeNull();
    expect(parseFilters({ flag: "Selesai", status: "Proses" }, ctx)).toMatchObject({ flag: "Selesai", status: null });
  });

  test("first value of a repeated param", () => {
    expect(parseFilters({ area: ["Grooming", "x"] }, ctx).area).toBe("Grooming");
  });
});

describe("filterPlans", () => {
  const rows = [
    view({ id: 1, reportGroup: "SUB", area: "Grooming", action: "Grooming check harian", pic: "Kepala Stasiun" }),
    view({ id: 2, reportGroup: "DPS", area: "Bahasa", action: "Kelas bahasa Inggris", dueDate: "2026-10-01" }),
    view({ id: 3, reportGroup: "SUB", area: "Bahasa", action: "Reservasi", status: "Proses", notes: "Menunggu jadwal" }),
  ];
  const none = { cabang: null, area: null, flag: null, status: null, q: "" };

  test("each filter narrows", () => {
    expect(filterPlans(rows, none).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(filterPlans(rows, { ...none, cabang: "SUB" }).map((r) => r.id)).toEqual([1, 3]);
    expect(filterPlans(rows, { ...none, area: "Bahasa" }).map((r) => r.id)).toEqual([2, 3]);
    expect(filterPlans(rows, { ...none, flag: "Terlambat" }).map((r) => r.id)).toEqual([2]);
    expect(filterPlans(rows, { ...none, status: "Proses" }).map((r) => r.id)).toEqual([3]);
  });

  test("search matches every word, case-insensitive, across fields", () => {
    expect(filterPlans(rows, { ...none, q: "kepala grooming" }).map((r) => r.id)).toEqual([1]);
    expect(filterPlans(rows, { ...none, q: "JADWAL" }).map((r) => r.id)).toEqual([3]);
    expect(filterPlans(rows, { ...none, q: "dps inggris" }).map((r) => r.id)).toEqual([2]);
    expect(filterPlans(rows, { ...none, q: "tidak ada" })).toEqual([]);
  });
});

describe("filter helpers", () => {
  const f = { cabang: "SUB", area: "Grooming", flag: null, status: "Proses", q: "" };
  test("activeFilterCount leaves Cabang out", () => {
    expect(activeFilterCount(f)).toBe(2);
    expect(activeFilterCount({ ...f, area: null, status: null })).toBe(0);
  });
  test("filterQuery overrides single keys", () => {
    expect(filterQuery(f, { area: null, q: "bmi" })).toEqual({
      cabang: "SUB",
      area: null,
      flag: null,
      status: "Proses",
      q: "bmi",
    });
  });
});

describe("summarize", () => {
  test("counts per flag, average progress, due within 7 days", () => {
    const s = summarize([
      view({ id: 1, dueDate: "2026-10-10", progress: 20 }),
      view({ id: 2, dueDate: "2026-10-19", progress: 50 }),
      view({ id: 3, dueDate: "2026-10-26", progress: 10 }),
      view({ id: 4, dueDate: "2026-10-27" }),
      view({ id: 5, status: "Selesai", progress: 100, dueDate: "2026-10-20" }),
    ]);
    expect(s.total).toBe(5);
    expect(s.byFlag).toEqual({ Selesai: 1, Terlambat: 1, "Jatuh tempo ≤ 7 hari": 2, "On track": 1 });
    expect(s.avgProgress).toBe(36);
    expect(s.dueSoon).toBe(2);
  });

  test("no rows: no average", () => {
    expect(summarize([]).avgProgress).toBeNull();
  });
});

describe("labels", () => {
  test("percent with decimal comma", () => {
    expect(percentLabel(42)).toBe("42%");
    expect(percentLabel(12.345)).toBe("12,3%");
    expect(percentLabel(null)).toBe("–");
  });
  test("days left in words", () => {
    expect(daysLeftLabel(-3)).toBe("Lewat 3 hari");
    expect(daysLeftLabel(0)).toBe("Hari ini");
    expect(daysLeftLabel(5)).toBe("5 hari lagi");
    expect(daysLeftLabel(null)).toBeNull();
  });
});
