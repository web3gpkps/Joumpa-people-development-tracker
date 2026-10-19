import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { DEFAULT_SETTINGS } from "@/lib/rules";
import { summarizeRow, trackerMetrics, type BmiRowView, type BmiTrackerRow } from "./tracker-model";
import { bmiExportInput, exportedLabel, shownPeriods, xlsxFilename, type BmiExportState } from "./xlsx-export";
import { THRESHOLD_NAMES, blockBar, bmiFormula, buildBmiWorkbook, categoryFormula, colLetter, excelDate } from "@/lib/xlsx/bmi";

const settings = {
  ...DEFAULT_SETTINGS,
  bmiFirstCheck: "2026-10-12",
  bmiIntervalDays: 14,
  bmiPeriods: 2,
  minHeightMale: 160,
  minHeightFemale: 155,
};
const today = "2026-10-20";
const rowA: BmiTrackerRow = {
  code: "T-01",
  name: "Petugas uji",
  station: "AAA",
  gender: "P",
  fitnessNote: "=1+1",
  assignmentStatus: "Aktif",
  changed: null,
  checks: [{ date: "2026-10-12", heightCm: 170, weightKg: 60 }, null],
};
const rowB: BmiTrackerRow = {
  ...rowA,
  code: "T-02",
  name: "Petugas dua",
  gender: "L",
  fitnessNote: null,
  checks: [
    { date: "2026-10-12", heightCm: 165, weightKg: 75 },
    { date: "2026-10-26", heightCm: 165, weightKg: 72.5 },
  ],
};
const views: BmiRowView[] = [rowA, rowB].map((row) => ({ row, summary: summarizeRow(row, settings, today) }));
const labels = ["BMI Cek ke-1 (Periode 12-25 Oct 2026)", "BMI Cek ke-2 (Periode 26 Oct-8 Nov 2026)"];

const state = (patch: Partial<BmiExportState> = {}): BmiExportState => ({
  views,
  filtered: views,
  metrics: trackerMetrics(views, 1),
  settings,
  labels,
  period: 1,
  currentPeriod: 1,
  viewAll: true,
  query: "",
  status: "all",
  category: "all",
  station: null,
  idLabel: "ID SDM",
  scope: { chip: "Stasiun AAA", foot: "Petugas di Stasiun AAA" },
  now: new Date("2026-10-15T15:31:00Z"),
  ...patch,
});

async function roundTrip(s: BmiExportState) {
  const bytes = await buildBmiWorkbook(ExcelJS, { ...bmiExportInput(s), logos: [] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  return wb;
}

const text = (v: unknown) => (v && typeof v === "object" && "richText" in v ? (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("") : v);

describe("helpers", () => {
  test("file name, export time and small formatters", () => {
    expect(xlsxFilename("SUB", "2026-10-14")).toBe("JOUMPA_BMI_SUB_2026-10-14.xlsx");
    expect(xlsxFilename("a/b c", "2026-10-14")).toBe("JOUMPA_BMI_a-b-c_2026-10-14.xlsx");
    expect(exportedLabel(new Date("2026-10-15T15:31:00Z"))).toBe("15 Okt 2026 22.31 WIB");
    expect(colLetter(1)).toBe("A");
    expect(colLetter(27)).toBe("AA");
    expect(blockBar(30)).toBe("▰▰▰▱▱▱▱▱▱▱");
    expect(excelDate("2026-10-12")?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  test("the formulas are the app's rules", () => {
    expect(bmiFormula("G15", "H15")).toBe('IF(OR(G15="",H15=""),"",ROUND(H15/(G15/100)^2,1))');
    expect(categoryFormula("I15")).toContain(`I15<${THRESHOLD_NAMES.underweightBelow},"Kurus"`);
  });

  test("Fokus periode shows only the chosen check", () => {
    expect(shownPeriods(state())).toEqual([1, 2]);
    expect(shownPeriods(state({ viewAll: false, period: 2 }))).toEqual([2]);
  });
});

describe("the workbook matches the screen", () => {
  test("sheets, banner, counts, filters and frozen columns", async () => {
    const wb = await roundTrip(state({ query: "dua", filtered: [views[1]], status: "late" }));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Cek BMI", "Keterangan"]);
    const ws = wb.getWorksheet("Cek BMI")!;
    expect(ws.getCell("D2").value).toBe("BMI Monitoring Tracker");
    expect(ws.getCell(8, 1).value).toBe(2); // Total SDM counts everybody in scope, like the card
    const filters = String(text(ws.getCell(11, 1).value));
    expect(filters).toContain("“dua”");
    expect(filters).toContain("Terlambat cek");
    expect(filters).toContain("Semua periode");
    expect(filters).toContain("· sekarang");
    expect(String(text(ws.getCell(11, ws.columnCount - 2).value) ?? "")).toBe("1 dari 2 petugas");
    expect(ws.views[0]).toMatchObject({ state: "frozen", xSplit: 3, ySplit: 14 });
    expect(ws.autoFilter).toBeTruthy();
  });

  test("headers: identity, one group per check (chosen one marked), summary", async () => {
    const ws = (await roundTrip(state({ period: 2 }))).getWorksheet("Cek BMI")!;
    const fields = (ws.getRow(14).values as unknown[]).slice(1);
    expect(fields).toHaveLength(5 + 5 * 2 + 9);
    expect(fields.slice(0, 5)).toEqual(["No", "ID SDM", "Nama Petugas", "Stasiun", "L/P"]);
    expect(fields.slice(5, 10)).toEqual(["Tgl Cek", "Tinggi (cm)", "Berat (kg)", "BMI", "Kategori"]);
    expect(fields.at(-1)).toBe("Catatan / Program Penyesuaian BB");
    expect(ws.getCell(13, 6).value).toBe(labels[0]);
    expect(ws.getCell(13, 11).value).toBe(`◆  ${labels[1]}`);
  });

  test("values equal the screen; BMI and Kategori are live formulas with the screen's results", async () => {
    const ws = (await roundTrip(state())).getWorksheet("Cek BMI")!;
    const a = ws.getRow(15);
    expect([a.getCell(1).value, a.getCell(2).value, a.getCell(3).value, a.getCell(4).value, a.getCell(5).value]).toEqual([1, "T-01", "Petugas uji", "AAA", "P"]);
    expect((a.getCell(6).value as Date).toISOString().slice(0, 10)).toBe("2026-10-12");
    expect([a.getCell(7).value, a.getCell(8).value]).toEqual([170, 60]);
    expect(a.getCell(9).value).toMatchObject({ formula: bmiFormula("G15", "H15"), result: 20.8 });
    expect(a.getCell(10).value).toMatchObject({ formula: categoryFormula("I15"), result: "Normal" });
    expect(a.getCell(11).value).toBeNull(); // no second check
    const summary = (a.values as unknown[]).slice(16);
    expect(summary.slice(0, 6)).toEqual([170, 60, 0, 20.8, "Normal", "Memenuhi"]);
    // A note that looks like a formula stays text.
    expect(a.getCell(24).value).toBe("=1+1");
    const b = ws.getRow(16);
    expect(b.getCell(14).value).toMatchObject({ result: 26.6 }); // 72.5 / 1.65²
    expect(b.getCell(15).value).toMatchObject({ result: "Overweight" });
    expect(b.getCell(18).value).toBe(-2.5);
  });

  test("Fokus periode exports only the chosen check's columns", async () => {
    const ws = (await roundTrip(state({ viewAll: false, period: 2 }))).getWorksheet("Cek BMI")!;
    const fields = (ws.getRow(14).values as unknown[]).slice(1);
    expect(fields).toHaveLength(5 + 5 + 9);
    expect(ws.getCell(13, 6).value).toBe(`◆  ${labels[1]}`);
    expect(ws.getRow(16).getCell(7).value).toBe(165);
  });

  test("a branch account's view: No Pegawai in the id column", async () => {
    const ws = (await roundTrip(state({ idLabel: "No Pegawai" }))).getWorksheet("Cek BMI")!;
    expect(ws.getCell(14, 2).value).toBe("No Pegawai");
  });

  test("thresholds are named ranges on Keterangan; inputs are validated", async () => {
    const wb = await roundTrip(state());
    const names = wb.definedNames.model.map((d) => d.name);
    for (const name of Object.values(THRESHOLD_NAMES)) expect(names).toContain(name);
    const legend = wb.getWorksheet("Keterangan")!;
    const values = legend.getColumn(3).values.filter((v) => typeof v === "number");
    for (const v of [settings.bmiUnderweightBelow, settings.bmiNormalMax, settings.bmiOverweightMax]) expect(values).toContain(v);
    const ws = wb.getWorksheet("Cek BMI")!;
    expect(ws.getCell(15, 7).dataValidation).toMatchObject({ type: "decimal", formulae: [120, 210] });
    expect(ws.getCell(15, 8).dataValidation).toMatchObject({ type: "decimal", formulae: [30, 200] });
  });
});

describe("row height for wrapped text", () => {
  test("one line stays 20pt; a long note grows the row", async () => {
    const { rowHeight } = await import("@/lib/xlsx/bmi");
    const cols = [{ kind: "wrap" as const, width: 40 }];
    expect(rowHeight(["pendek"], cols)).toBe(20);
    expect(rowHeight(["x".repeat(120)], cols)).toBe(3 * 13 + 7); // 43 characters a line
    expect(rowHeight([null], cols)).toBe(20);
  });
});
