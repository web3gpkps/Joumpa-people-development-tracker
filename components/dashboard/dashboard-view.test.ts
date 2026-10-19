import { describe, expect, test } from "bun:test";
import { dashboardKpis } from "@/lib/pd-rules";
import type { Workspace } from "@/lib/workspace";
import { dashboardInput, kpiCards, lateBySource, nextTimelineIndex, timelineRows } from "./dashboard-view";

type Source = Parameters<typeof dashboardInput>[0];

const today = "2026-10-19";

const stations = [
  { code: "CGK", reportGroup: "CGK & HLP", sort: 1 },
  { code: "HLP", reportGroup: "CGK & HLP", sort: 2 },
  { code: "DPS", reportGroup: "DPS", sort: 3 },
  { code: "SUB", reportGroup: "SUB", sort: 4 },
  { code: "UPG", reportGroup: "UPG", sort: 5 },
] as Workspace["stations"];

const staff = (over: Partial<Workspace["staff"][number]>) =>
  ({ code: "X", station: "CGK", reportGroup: null, ...over }) as Workspace["staff"][number];

const ws: Source = {
  stations,
  areas: [
    { name: "Grooming", sort: 2 },
    { name: "Product knowledge", sort: 1 },
  ],
  staff: [
    staff({ code: "CGK-01", station: "CGK", proposal: "Coaching intensif", reassessPractice: 4 }),
    staff({ code: "HLP-01", station: "HLP", proposal: "Coaching intensif", reassessPractice: 3, mainDue: "2026-10-10", mainStatus: "Proses" }),
    staff({ code: "SUB-01", station: "SUB", reportGroup: "SUB", proposal: "Pembinaan", mainStatus: "Selesai", extraStatus: "Batal / N.A." }),
  ],
  replacements: [
    { id: 1, reportGroup: "DPS", withdrawStatus: "Selesai", startedOn: "2026-10-15" },
    { id: 2, reportGroup: "DPS", withdrawStatus: "Proses", withdrawDue: "2026-10-01" },
  ] as unknown as Workspace["replacements"],
  actionPlans: [
    { id: 1, reportGroup: "SUB", area: "Grooming", status: "Selesai", progress: 100, dueDate: "2026-10-31", archivedAt: null },
    { id: 2, reportGroup: "SUB", area: "Grooming", status: "Proses", progress: 40, dueDate: "2026-10-12", archivedAt: null },
    // Archived rows (the owner receives them) never count, and their Cabang gets no row.
    { id: 3, reportGroup: "UPG", area: "Grooming", status: "Belum Mulai", progress: 0, dueDate: "2026-10-01", archivedAt: "2026-10-02T00:00:00Z" },
  ] as unknown as Workspace["actionPlans"],
};

describe("dashboardInput", () => {
  const input = dashboardInput(ws);

  test("staff without a Cabang take their station's", () => {
    expect(input.staff.map((s) => s.reportGroup)).toEqual(["CGK & HLP", "CGK & HLP", "SUB"]);
  });

  test("only Cabang with data, in station order", () => {
    expect(input.groups).toEqual(["CGK & HLP", "DPS", "SUB"]);
  });

  test("archived plans are left out", () => {
    expect(input.plans).toHaveLength(2);
  });

  test("areas follow their sort order", () => {
    expect(input.areas).toEqual(["Product knowledge", "Grooming"]);
  });
});

describe("kpiCards", () => {
  const input = dashboardInput(ws);
  const kpis = dashboardKpis(input, today);
  const cards = kpiCards(kpis, input, today);
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));

  test("six cards in workbook order", () => {
    expect(cards.map((c) => c.label)).toEqual([
      "Total staf",
      "Penggantian selesai",
      "Sudah dinilai ulang",
      "% Sesuai",
      "Rencana aksi selesai",
      "Tindak lanjut terlambat",
    ]);
  });

  test("ratios read x / y", () => {
    expect(byKey.penggantian.value).toBe("1 / 2");
    expect(byKey["dinilai-ulang"].value).toBe("2 / 2");
  });

  test("% Sesuai of those re-assessed", () => {
    expect(byKey.sesuai.value).toBe("50%");
    expect(byKey.sesuai.foot).toBe("1 dari 2 yang dinilai ulang");
  });

  test("late items are split by tracker and sum to the KPI", () => {
    const late = lateBySource(input, today);
    expect(late).toEqual({ staff: 1, replacements: 1, plans: 1 });
    expect(byKey.terlambat.value).toBe("3");
    expect(byKey.terlambat.tone).toBe("critical");
  });

  test("cards link to the page behind the figure", () => {
    expect(cards.map((c) => c.sheet ?? null)).toEqual(["trackerStaf", "penggantian", "trackerStaf", "trackerStaf", "rencanaAksi", null]);
  });

  test("a share with nothing to divide by is a dash, not 0%", () => {
    const empty = dashboardInput({ ...ws, staff: [], actionPlans: [], replacements: [] });
    const emptyCards = kpiCards(dashboardKpis(empty, today), empty, today);
    const sesuai = emptyCards.find((c) => c.key === "sesuai")!;
    const plans = emptyCards.find((c) => c.key === "rencana-aksi")!;
    expect(sesuai.value).toBeNull();
    expect(plans.value).toBeNull();
    expect(emptyCards.find((c) => c.key === "penggantian")!.progress).toBeUndefined();
  });
});

describe("timelineRows", () => {
  test("Sisa hari: Lewat, Hari ini, Besok, n hari lagi", () => {
    const rows = timelineRows("2026-10-20", [
      { date: "2026-10-19", agenda: "a" },
      { date: "2026-10-20", agenda: "b" },
      { date: "2026-10-21", agenda: "c" },
      { date: "2026-10-27", agenda: "d" },
      { date: "2026-10-31", agenda: "e" },
    ]);
    expect(rows.map((r) => r.remaining)).toEqual(["Lewat", "Hari ini", "Besok", "7 hari lagi", "11 hari lagi"]);
    expect(rows.map((r) => r.state)).toEqual(["past", "today", "soon", "soon", "later"]);
    expect(rows[0].dateLabel).toBe("19 Okt 2026");
  });

  test("next index skips past dates, or is the length when all passed", () => {
    expect(nextTimelineIndex(timelineRows("2026-11-01"))).toBe(2);
    expect(nextTimelineIndex(timelineRows("2027-01-01"))).toBe(8);
  });
});
