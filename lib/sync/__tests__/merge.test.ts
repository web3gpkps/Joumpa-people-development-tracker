/**
 * Merge engine on plain row-1 tabs (rowOneSpecs): the v2 tables with their keys, types and absence
 * rules, without the workbook layout. Workbook layouts are covered in layouts.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { countPlan, isPlanEmpty, merge, mergeCell } from "../merge";
import { rowOneSpecs, specFor } from "../tables";
import { World } from "../testing/fakes";
import { TEST_STATIONS, bmiRow, manyStaff, monthlyRow, planRow, replacementRow, settingsRow, smallDb, staffRow } from "../testing/fixtures";
import type { DbSnapshot, Plan, SyncTable, TableSpec } from "../types";

// ------------------------------------------------------------------ helpers

const TS = "Tracker Staf";
const CB = "Cek BMI";
const PG = "Penggantian SDM";
const RA = "Rencana Aksi";
const LB = "Laporan Bulanan";
const PB = "Parameter BMI";

/** What a plan still wants to do, for readable failures. */
function pending(plan: Plan): string[] {
  const out: string[] = [];
  for (const t of plan.tables) {
    const c = countPlan(plan)[t.table];
    const parts = Object.entries(c).filter(([k, v]) => v && k !== "openIssues");
    if (parts.length || t.sheet.notes.length) {
      out.push(`${t.table}: ${JSON.stringify(Object.fromEntries(parts))} notes=${t.sheet.notes.length}`);
    }
  }
  return out;
}

function expectSteady(w: World) {
  const p = w.plan();
  expect(pending(p)).toEqual([]);
  expect(isPlanEmpty(p)).toBe(true);
}

function seeded(db = smallDb(), specs?: TableSpec[]): World {
  const w = new World(db, specs);
  w.sync();
  expectSteady(w);
  return w;
}

/** 1-based sheet row of the first data row whose `header` equals `value`. */
function rowOf(w: World, tab: string, header: string, value: unknown): number {
  const i = w.sheet.rows(tab).findIndex((r) => r[header] === value);
  if (i < 0) throw new Error(`no row with ${header}=${String(value)} in ${tab}`);
  return i + 2;
}

/** A DB row as a row-1 sheet row (by header). */
function sheetRow(table: SyncTable, row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(specFor(table).columns.map((c) => [c.header, row[c.db] ?? ""]));
}

function tableValues(table: SyncTable, rows: Record<string, unknown>[]): unknown[][] {
  const header = specFor(table).columns.map((c) => c.header);
  return [header, ...rows.map((r) => header.map((h) => r[h] ?? ""))];
}

const tp = (plan: Plan, table: SyncTable) => plan.tables.find((t) => t.table === table)!;
const staff = (w: World, code: string) => w.db.find("pd_staff", { code })!;
const plan = (w: World, id: number) => w.db.find("pd_action_plans", { id })!;
const report = (w: World, report_group: string, period = "2026-10-01") => w.db.find("pd_monthly_reports", { report_group, period });
const withSpec = (table: SyncTable, patch: Partial<TableSpec>) => rowOneSpecs().map((s) => (s.table === table ? { ...s, ...patch } : s));
const live = (w: World) => w.db.snapshot().pd_action_plans!;

// ------------------------------------------------------------------ mergeCell

describe("mergeCell (3-way, per cell)", () => {
  const cases: [string, number | undefined, number | null, number | null, string, number | null, boolean][] = [
    // name, base, sheet, db, policy, value, conflict
    ["nothing changed", 4, 4, 4, "db-wins", 4, false],
    ["only sheet changed", 4, 5, 4, "db-wins", 5, false],
    ["only db changed", 4, 4, 2, "db-wins", 2, false],
    ["both changed to the same value", 4, 5, 5, "db-wins", 5, false],
    ["both changed differently, db-wins", 4, 5, 2, "db-wins", 2, true],
    ["both changed differently, sheet-wins", 4, 5, 2, "sheet-wins", 5, true],
    ["sheet cleared, db unchanged", 4, null, 4, "db-wins", null, false],
    ["no baseline, sheet empty: db fills", undefined, null, 3, "db-wins", 3, false],
    ["no baseline, db empty: sheet fills", undefined, 3, null, "db-wins", 3, false],
    ["no baseline, both set differently, db-wins", undefined, 3, 5, "db-wins", 5, true],
    ["no baseline, both set differently, sheet-wins", undefined, 3, 5, "sheet-wins", 3, true],
  ];
  for (const [name, b, s, d, policy, value, conflict] of cases) {
    test(name, () => {
      const r = mergeCell(b, s, d, policy as "db-wins" | "sheet-wins");
      expect(r.value).toBe(value);
      expect(r.conflict).toBe(conflict);
    });
  }
  test("direction flags", () => {
    expect(mergeCell(4, 5, 4, "db-wins")).toMatchObject({ toDb: true, toSheet: false });
    expect(mergeCell(4, 4, 5, "db-wins")).toMatchObject({ toDb: false, toSheet: true });
    expect(mergeCell(4, 5, 2, "db-wins")).toMatchObject({ toDb: false, toSheet: true });
    expect(mergeCell(4, 5, 2, "sheet-wins")).toMatchObject({ toDb: true, toSheet: false });
  });
});

// ------------------------------------------------------------------ first run

describe("first run (empty baseline)", () => {
  test("sheet empty, DB has data: tabs created and filled from DB, nothing written to DB", () => {
    const w = new World(smallDb());
    const p = w.sync();
    for (const t of p.tables) {
      expect(t.sheet.create).toBe(true);
      expect(t.db).toEqual({ inserts: [], updates: [], deletes: [], pending: [] });
      expect(t.conflicts).toEqual([]);
    }
    expect(tp(p, "pd_settings").sheet.appends.length).toBe(8);
    expect(w.sheet.rows(TS).map((r) => r["ID SDM"])).toEqual(["DPS-01", "SUB-01", "SUB-02"]);
    expect(w.sheet.rows(CB)).toEqual([{ "ID SDM": "SUB-01", "Cek Ke": 1, "Tgl Cek": 46307, "Tinggi (cm)": 170, "Berat (kg)": 65.5 }]);
    expect(w.sheet.rows(PG)[0]["ID Sistem"]).toBe(1);
    expect(w.sheet.rows(RA).map((r) => [r["ID Sistem"], r.No, r["% Progres"]])).toEqual([[1, "1", 0], [2, "6a", 0]]);
    // Laporan Bulanan per period in the workbook's Cabang order (CGK & HLP before SUB).
    expect(w.sheet.rows(LB).map((r) => r.Cabang)).toEqual(["CGK & HLP", "SUB"]);
    expectSteady(w);
  });

  test("both sides already have data: union, nulls filled, differing cells resolved db-wins and logged, no deletes", () => {
    const w = new World(smallDb());
    const db = smallDb().pd_staff!;
    w.sheet.addTab(
      TS,
      tableValues("pd_staff", [
        // Same as DB except: NIPP empty (DB fills it), Catatan progres set (DB takes it).
        { ...sheetRow("pd_staff", db[0]), NIPP: "", "Catatan progres": "dari sheet" },
        // Name differs: conflict.
        { ...sheetRow("pd_staff", db[1]), Nama: "Nama Versi Sheet" },
        // Only in the sheet: inserted, the DB assigns the code.
        { "ID SDM": "KNO-01", Stn: "KNO", Cabang: "KNO", Nama: "Petugas KNO-01", "Status tindakan utama": "Belum Mulai" },
      ]),
    );
    const p = w.sync();
    const s = tp(p, "pd_staff");
    expect(s.db.pending).toMatchObject([{ ref: 1, values: { name: "Petugas KNO-01", station: "KNO", main_status: "Belum Mulai" } }]);
    expect(s.db.updates).toEqual([{ key: { code: "SUB-01" }, set: { progress_notes: "dari sheet" } }]);
    expect(s.db.deletes).toEqual([]);
    expect(s.conflicts).toEqual([
      { table: "pd_staff", rowKey: "SUB-02", column: "name", baseline: null, sheet: "Nama Versi Sheet", db: "Petugas SUB-02", resolution: "db-wins" },
    ]);
    expect(w.sheet.cell(TS, rowOf(w, TS, "ID SDM", "SUB-02"), "Nama")).toBe("Petugas SUB-02");
    expect(w.sheet.cell(TS, rowOf(w, TS, "ID SDM", "SUB-01"), "NIPP")).toBe("1001");
    expect(w.sheet.rows(TS).map((r) => r["ID SDM"]).sort()).toEqual(["DPS-01", "KNO-01", "SUB-01", "SUB-02"]);
    expect(w.db.rows("pd_staff").length).toBe(4);
    expectSteady(w);
  });

  test("both sides have data, sheet-wins: the sheet value is written to the DB and logged", () => {
    const w = new World(smallDb());
    w.sheet.addTab(LB, tableValues("pd_monthly_reports", [{ ...sheetRow("pd_monthly_reports", monthlyRow("CGK & HLP", "2026-10-01")), Catatan: "Versi sheet" }]));
    const p = w.sync({ conflictPolicy: "sheet-wins" });
    expect(tp(p, "pd_monthly_reports").conflicts).toMatchObject([
      { rowKey: "CGK & HLP|2026-10-01", column: "notes", resolution: "sheet-wins", sheet: "Versi sheet", db: "Laporan gabungan" },
    ]);
    expect(report(w, "CGK & HLP")!.notes).toBe("Versi sheet");
    expect(w.sheet.rows(LB).map((r) => r.Cabang)).toEqual(["CGK & HLP", "SUB"]);
    expectSteady(w);
  });
});

// ------------------------------------------------------------------ cell changes

describe("cell changes against the baseline", () => {
  test("only the sheet changed: DB updated", () => {
    const w = seeded();
    w.sheet.setCell(TS, rowOf(w, TS, "ID SDM", "SUB-01"), "Praktik awal", 4.5);
    const p = w.sync();
    expect(tp(p, "pd_staff").db.updates).toEqual([{ key: { code: "SUB-01" }, set: { initial_practice: 4.5 } }]);
    expect(staff(w, "SUB-01").initial_practice).toBe(4.5);
    expect(w.baseline!.tables.pd_staff!["SUB-01"].initial_practice).toBe(4.5);
    expectSteady(w);
  });

  test("only the DB changed: sheet cell updated", () => {
    const w = seeded();
    staff(w, "SUB-02").nipp = "9999";
    const p = w.sync();
    expect(tp(p, "pd_staff").db.updates).toEqual([]);
    expect(w.sheet.cell(TS, rowOf(w, TS, "ID SDM", "SUB-02"), "NIPP")).toBe("9999");
    expectSteady(w);
  });

  test("both changed to the same value: nothing written, no conflict", () => {
    const w = seeded();
    staff(w, "SUB-01").progress_notes = "sama";
    w.sheet.setCell(TS, rowOf(w, TS, "ID SDM", "SUB-01"), "Catatan progres", "sama");
    const p = w.sync();
    expect(pending(p)).toEqual([]);
    expect(w.baseline!.tables.pd_staff!["SUB-01"].progress_notes).toBe("sama");
  });

  test("both changed differently: db-wins by default, DB value written over the sheet, conflict logged", () => {
    const w = seeded();
    const r = rowOf(w, TS, "ID SDM", "SUB-01");
    staff(w, "SUB-01").initial_practice = 5;
    w.sheet.setCell(TS, r, "Praktik awal", 2);
    const p = w.sync();
    expect(tp(p, "pd_staff").conflicts).toEqual([
      { table: "pd_staff", rowKey: "SUB-01", column: "initial_practice", baseline: 3, sheet: 2, db: 5, resolution: "db-wins" },
    ]);
    expect(tp(p, "pd_staff").db.updates).toEqual([]);
    expect(w.sheet.cell(TS, r, "Praktik awal")).toBe(5);
    expect(staff(w, "SUB-01").initial_practice).toBe(5);
    expectSteady(w);
  });

  test("both changed differently with sheet-wins: sheet value written to DB, conflict logged", () => {
    const w = seeded();
    const r = rowOf(w, TS, "ID SDM", "SUB-01");
    staff(w, "SUB-01").initial_practice = 5;
    w.sheet.setCell(TS, r, "Praktik awal", 2);
    const p = w.sync({ conflictPolicy: "sheet-wins" });
    expect(tp(p, "pd_staff").conflicts[0]).toMatchObject({ column: "initial_practice", sheet: 2, db: 5, resolution: "sheet-wins" });
    expect(staff(w, "SUB-01").initial_practice).toBe(2);
    expect(w.sheet.cell(TS, r, "Praktik awal")).toBe(2);
    expectSteady(w);
  });

  test("independent edits to different cells of one row both apply", () => {
    const w = seeded();
    const r = rowOf(w, TS, "ID SDM", "SUB-01");
    w.sheet.setCell(TS, r, "Catatan progres", "dari sheet");
    staff(w, "SUB-01").bmi_note = "dari web";
    w.sync();
    expect(staff(w, "SUB-01").progress_notes).toBe("dari sheet");
    expect(w.sheet.cell(TS, r, "Catatan / Program Penyesuaian BB")).toBe("dari web");
    expectSteady(w);
  });

  test("a value the DB rewrites (Cabang follows the station) comes back to the sheet on the next run", () => {
    const w = seeded();
    const r = rowOf(w, TS, "ID SDM", "SUB-01");
    w.sheet.setCell(TS, r, "Cabang", "DPS");
    let p = w.sync();
    expect(tp(p, "pd_staff").db.updates).toEqual([{ key: { code: "SUB-01" }, set: { report_group: "DPS" } }]);
    expect(staff(w, "SUB-01").report_group).toBe("SUB");
    p = w.sync();
    expect(tp(p, "pd_staff").conflicts).toEqual([]);
    expect(w.sheet.cell(TS, r, "Cabang")).toBe("SUB");
    expectSteady(w);
  });
});

// ------------------------------------------------------------------ inserts and deletes

describe("row inserts and deletes", () => {
  test("new sheet row is inserted into the DB; empty required columns get the DB default written back", () => {
    const w = seeded();
    const n = w.sheet.rows(RA).length + 2;
    w.sheet.setCell(RA, n, "No", "3");
    w.sheet.setCell(RA, n, "Area", "BMI");
    w.sheet.setCell(RA, n, "Tindakan", "Timbang ulang");
    w.sheet.setCell(RA, n, "Cabang", "SUB");
    const p = w.sync();
    expect(tp(p, "pd_action_plans").db.pending).toHaveLength(1);
    expect(plan(w, 3)).toMatchObject({ item_no: "3", area: "BMI", action: "Timbang ulang", status: "Belum Mulai", progress: 0 });
    expect([w.sheet.cell(RA, n, "Status"), w.sheet.cell(RA, n, "% Progres"), w.sheet.cell(RA, n, "ID Sistem")]).toEqual(["Belum Mulai", 0, 3]);
    expectSteady(w);
  });

  test("new sheet row with a natural key is inserted as typed", () => {
    const w = seeded();
    const n = w.sheet.rows(LB).length + 2;
    w.sheet.setCell(LB, n, "Cabang", "DPS");
    w.sheet.setCell(LB, n, "Periode", "2026-11-01");
    w.sheet.setCell(LB, n, "Total staf aktif", 7);
    const p = w.sync();
    expect(tp(p, "pd_monthly_reports").db.inserts).toEqual([
      { report_group: "DPS", period: "2026-11-01", due_on: null, received_on: null, active_staff: 7, compliant_staff: null, complaints: null, responded: null, satisfaction: null, notes: null },
    ]);
    expectSteady(w);
  });

  test("new DB row is appended to the sheet", () => {
    const w = seeded();
    w.db.rows("pd_action_plans").push(planRow(3, { report_group: "KNO" }));
    const p = w.sync();
    expect(tp(p, "pd_action_plans").sheet.appends).toHaveLength(1);
    expect(w.sheet.rows(RA).map((r) => r["ID Sistem"])).toEqual([1, 2, 3]);
    expectSteady(w);
  });

  test("row deleted in the sheet is deleted in the DB (children cascade and leave the sheet, references nulled)", () => {
    const db = smallDb();
    db.pd_replacements = [replacementRow(1, { staff_code: "SUB-01", name: "Petugas SUB-01" })];
    const w = seeded(db);
    w.sheet.tabs.get(TS)!.values.splice(rowOf(w, TS, "ID SDM", "SUB-01") - 1, 1);
    const p = w.sync();
    expect(tp(p, "pd_staff").db.deletes).toEqual([{ code: "SUB-01" }]);
    expect(tp(p, "pd_bmi_checks").sheet.deleteRows).toEqual([2]);
    expect(staff(w, "SUB-01")).toBeUndefined();
    expect(w.db.rows("pd_bmi_checks")).toEqual([]);
    expect(w.sheet.rows(CB)).toEqual([]);
    expect(w.db.find("pd_replacements", { id: 1 })!.staff_code).toBeNull();
    expect(w.sheet.cell(PG, 2, "ID SDM")).toBe("");
    expectSteady(w);
  });

  test("clearing a staff member's name counts as removing the record (no name = absent)", () => {
    const w = seeded();
    const r = rowOf(w, TS, "ID SDM", "DPS-01");
    w.sheet.setCell(TS, r, "Nama", "");
    const p = w.sync();
    expect(tp(p, "pd_staff").db.deletes).toEqual([{ code: "DPS-01" }]);
    expect(w.sheet.cell(TS, r, "Stn")).toBe("");
    expectSteady(w);
  });

  test("row deleted in the DB clears that record's input cells in the sheet (natural key kept)", () => {
    const w = seeded();
    const r = rowOf(w, LB, "Cabang", "SUB");
    w.db.remove("pd_monthly_reports", (x) => x.report_group === "SUB");
    const p = w.sync();
    expect(tp(p, "pd_monthly_reports").sheet.deleteRows).toEqual([]);
    expect([w.sheet.cell(LB, r, "Cabang"), w.sheet.cell(LB, r, "Periode"), w.sheet.cell(LB, r, "Total staf aktif")]).toEqual(["SUB", 46296, ""]);
    expectSteady(w);
  });

  test("deleted on both sides: dropped from the baseline, nothing written", () => {
    const w = seeded();
    w.db.remove("pd_monthly_reports", (x) => x.report_group === "SUB");
    w.sheet.tabs.get(LB)!.values.splice(rowOf(w, LB, "Cabang", "SUB") - 1, 1);
    const p = w.sync();
    expect(pending(p)).toEqual([]);
    expect(w.baseline!.tables.pd_monthly_reports!["SUB|2026-10-01"]).toBeUndefined();
  });
});

describe("Rencana Aksi: archived, never deleted", () => {
  test("archived in the app: the row disappears from the sync and its sheet row is cleared, id included", () => {
    const w = seeded();
    const r = rowOf(w, RA, "ID Sistem", 2);
    plan(w, 2).archived_at = "2026-10-20T08:00:00Z";
    const p = w.sync();
    expect(tp(p, "pd_action_plans").db).toEqual({ inserts: [], updates: [], deletes: [], pending: [] });
    expect(["ID Sistem", "No", "Tindakan", "Status"].map((h) => w.sheet.cell(RA, r, h))).toEqual(["", "", "", ""]);
    expect(w.baseline!.tables.pd_action_plans!["2"]).toBeUndefined();
    expectSteady(w);

    plan(w, 2).archived_at = null;
    w.sync();
    expect(w.sheet.rows(RA).find((x) => x["ID Sistem"] === 2)!.No).toBe("6a");
    expectSteady(w);
  });

  test("deleted in the sheet: the store archives the row (still there, archived_at set)", () => {
    const w = seeded();
    w.sheet.tabs.get(RA)!.values.splice(rowOf(w, RA, "ID Sistem", 1) - 1, 1);
    const p = w.sync();
    expect(tp(p, "pd_action_plans").db.deletes).toEqual([{ id: 1 }]);
    expect(plan(w, 1).archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(live(w).map((x) => x.id)).toEqual([2]);
    expectSteady(w);
  });
});

describe("delete vs edit races (whole-row conflicts)", () => {
  function sheetDeletedDbEdited(policy?: "db-wins" | "sheet-wins") {
    const w = seeded();
    w.sheet.tabs.get(LB)!.values.splice(rowOf(w, LB, "Cabang", "SUB") - 1, 1);
    report(w, "SUB")!.responded = "Belum";
    return { w, p: w.sync({ conflictPolicy: policy }) };
  }
  function dbDeletedSheetEdited(policy?: "db-wins" | "sheet-wins") {
    const w = seeded();
    w.sheet.setCell(LB, rowOf(w, LB, "Cabang", "SUB"), "Keluhan sikap / komunikasi", 3);
    w.db.remove("pd_monthly_reports", (x) => x.report_group === "SUB");
    return { w, p: w.sync({ conflictPolicy: policy }) };
  }

  test("sheet deleted, DB edited, db-wins: row restored to the sheet", () => {
    const { w, p } = sheetDeletedDbEdited();
    const c = tp(p, "pd_monthly_reports").conflicts;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ rowKey: "SUB|2026-10-01", column: null, sheet: null, resolution: "db-wins" });
    expect(tp(p, "pd_monthly_reports").db.deletes).toEqual([]);
    expect(w.sheet.rows(LB).find((r) => r.Cabang === "SUB")!["Semua direspons ≤ 1×24 jam?"]).toBe("Belum");
    expectSteady(w);
  });

  test("sheet deleted, DB edited, sheet-wins: DB row deleted", () => {
    const { w, p } = sheetDeletedDbEdited("sheet-wins");
    expect(tp(p, "pd_monthly_reports").conflicts[0]).toMatchObject({ column: null, resolution: "sheet-wins" });
    expect(report(w, "SUB")).toBeUndefined();
    expectSteady(w);
  });

  test("DB deleted, sheet edited, db-wins: the sheet record is cleared", () => {
    const { w, p } = dbDeletedSheetEdited();
    expect(tp(p, "pd_monthly_reports").conflicts[0]).toMatchObject({ column: null, db: null, resolution: "db-wins" });
    expect(w.sheet.rows(LB).find((r) => r.Cabang === "SUB")!["Keluhan sikap / komunikasi"]).toBe("");
    expectSteady(w);
  });

  test("DB deleted, sheet edited, sheet-wins: row re-inserted into the DB", () => {
    const { w, p } = dbDeletedSheetEdited("sheet-wins");
    expect(tp(p, "pd_monthly_reports").conflicts[0]).toMatchObject({ column: null, resolution: "sheet-wins" });
    expect(report(w, "SUB")!.complaints).toBe(3);
    expectSteady(w);
  });

  test("archive races: sheet deleted + DB edited with sheet-wins archives; DB archived + sheet edited with sheet-wins re-inserts as a new row", () => {
    const a = seeded();
    a.sheet.tabs.get(RA)!.values.splice(rowOf(a, RA, "ID Sistem", 1) - 1, 1);
    plan(a, 1).status = "Proses";
    a.sync({ conflictPolicy: "sheet-wins" });
    expect(plan(a, 1).status).toBe("Proses");
    expect(plan(a, 1).archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expectSteady(a);

    const b = seeded();
    const r = rowOf(b, RA, "ID Sistem", 1);
    b.sheet.setCell(RA, r, "Status", "Selesai");
    plan(b, 1).archived_at = "2026-10-20T08:00:00Z";
    const p = b.sync({ conflictPolicy: "sheet-wins" });
    expect(tp(p, "pd_action_plans").conflicts[0]).toMatchObject({ rowKey: "1", column: null, resolution: "sheet-wins" });
    expect(plan(b, 1).archived_at).toBe("2026-10-20T08:00:00Z");
    expect(live(b).find((x) => x.action === "Tindakan 1")).toMatchObject({ id: 3, status: "Selesai" });
    expect(b.sheet.cell(RA, r, "ID Sistem")).toBe(3);
    expectSteady(b);
  });
});

// ------------------------------------------------------------------ deletion guard

describe("deletion guard: max(10 rows, 50%)", () => {
  const bigDb = (n: number): DbSnapshot => ({ ...smallDb(), pd_staff: manyStaff(n), pd_bmi_checks: [] });
  const dropSheetRows = (w: World, tab: string, count: number) => w.sheet.tabs.get(tab)!.values.splice(1, count);

  test("removing many sheet rows skips the DB deletes and logs once", () => {
    const w = seeded(bigDb(30));
    dropSheetRows(w, TS, 16);
    const p = w.sync();
    const s = tp(p, "pd_staff");
    expect(s.db.deletes).toEqual([]);
    expect(s.issues.filter((i) => i.kind === "deletes_skipped").map((i) => i.isNew)).toEqual([true]);
    expect(w.db.rows("pd_staff")).toHaveLength(30);
    expect(Object.keys(w.baseline!.tables.pd_staff!)).toHaveLength(30);
    const again = w.sync();
    expect(tp(again, "pd_staff").issues.filter((i) => i.kind === "deletes_skipped").map((i) => i.isNew)).toEqual([false]);
    expect(pending(again)).toEqual([]);
  });

  test("allowMassDelete lifts the guard for that table", () => {
    const w = seeded(bigDb(30));
    dropSheetRows(w, TS, 16);
    w.sync();
    w.sync({ allowMassDelete: ["pd_staff"] });
    expect(w.db.rows("pd_staff")).toHaveLength(14);
    expectSteady(w);
  });

  test("up to 10 rows (or half the table) is allowed", () => {
    const w = seeded(bigDb(20));
    dropSheetRows(w, TS, 10);
    w.sync();
    expect(w.db.rows("pd_staff")).toHaveLength(10);
    expectSteady(w);
  });

  test("threshold is 50% for big tables: 50 of 100 allowed, 51 of 100 held back", () => {
    const w = seeded(bigDb(100));
    dropSheetRows(w, TS, 50);
    w.sync();
    expect(w.db.rows("pd_staff")).toHaveLength(50);
    const w2 = seeded(bigDb(100));
    dropSheetRows(w2, TS, 51);
    w2.sync();
    expect(w2.db.rows("pd_staff")).toHaveLength(100);
  });

  test("DB-side mass delete skips the sheet deletes", () => {
    const w = seeded(bigDb(30));
    w.db.tables.set("pd_staff", w.db.rows("pd_staff").slice(16));
    const p = w.sync();
    expect(tp(p, "pd_staff").sheet.updates).toEqual([]);
    expect(w.sheet.rows(TS).every((r) => r.Nama !== "")).toBe(true);
    expect(tp(p, "pd_staff").issues.some((i) => i.kind === "deletes_skipped" && i.column === "sheet")).toBe(true);
  });
});

// ------------------------------------------------------------------ validation

describe("invalid sheet values", () => {
  test("score 7: not written, noted, baseline unchanged; fixed value syncs and note clears", () => {
    const w = seeded();
    const r = rowOf(w, TS, "ID SDM", "SUB-01");
    w.sheet.setCell(TS, r, "Praktik awal", 7);
    const p = w.sync();
    const s = tp(p, "pd_staff");
    expect(s.db.updates).toEqual([]);
    expect(s.issues).toHaveLength(1);
    expect(s.issues[0]).toMatchObject({ kind: "invalid_value", rowKey: "SUB-01", column: "initial_practice", sheetValue: 7, isNew: true });
    expect(w.sheet.note(TS, r, "Praktik awal")).toContain("Di luar rentang 1–5");
    expect(staff(w, "SUB-01").initial_practice).toBe(3);
    expect(w.baseline!.tables.pd_staff!["SUB-01"].initial_practice).toBe(3);
    expectSteady(w);

    w.sheet.setCell(TS, r, "Praktik awal", 5);
    w.sync();
    expect(staff(w, "SUB-01").initial_practice).toBe(5);
    expect(w.sheet.note(TS, r, "Praktik awal")).toBeUndefined();
    expectSteady(w);
  });

  test("height 300 is rejected; DB keeps its value", () => {
    const w = seeded();
    const r = rowOf(w, CB, "ID SDM", "SUB-01");
    w.sheet.setCell(CB, r, "Tinggi (cm)", 300);
    const p = w.sync();
    expect(tp(p, "pd_bmi_checks").db.updates).toEqual([]);
    expect(tp(p, "pd_bmi_checks").issues[0]).toMatchObject({ kind: "invalid_value", column: "height_cm" });
    expect(w.db.find("pd_bmi_checks", { staff_code: "SUB-01", period: 1 })!.height_cm).toBe(170);
    expect(w.sheet.cell(CB, r, "Tinggi (cm)")).toBe(300);
    expectSteady(w);
  });

  test("an invalid sheet value never wins: if the DB changed meanwhile its value replaces the cell", () => {
    const w = seeded();
    const r = rowOf(w, TS, "ID SDM", "SUB-01");
    w.sheet.setCell(TS, r, "Praktik awal", 7);
    w.sync();
    staff(w, "SUB-01").initial_practice = 2;
    const p = w.sync({ conflictPolicy: "sheet-wins" });
    expect(tp(p, "pd_staff").conflicts).toEqual([]);
    expect(w.sheet.cell(TS, r, "Praktik awal")).toBe(2);
    expect(w.sheet.note(TS, r, "Praktik awal")).toBeUndefined();
    expectSteady(w);
  });

  test("clearing a required cell keeps the DB value and notes the cell", () => {
    const w = seeded();
    const r = rowOf(w, TS, "ID SDM", "SUB-02");
    w.sheet.setCell(TS, r, "Stn", "");
    const p = w.sync();
    expect(tp(p, "pd_staff").db.updates).toEqual([]);
    expect(tp(p, "pd_staff").issues[0]).toMatchObject({ kind: "required_missing", column: "station" });
    expect(w.sheet.note(TS, r, "Stn")).toContain("wajib diisi");
    expectSteady(w);
  });

  test("a new row with an invalid value is not inserted until fixed", () => {
    const w = seeded();
    const n = w.sheet.rows(CB).length + 2;
    w.sheet.setCell(CB, n, "ID SDM", "SUB-02");
    w.sheet.setCell(CB, n, "Cek Ke", 1);
    w.sheet.setCell(CB, n, "Tinggi (cm)", 168);
    w.sheet.setCell(CB, n, "Berat (kg)", "berat");
    let p = w.sync();
    expect(tp(p, "pd_bmi_checks").db.inserts).toEqual([]);
    expect(w.sheet.note(CB, n, "Berat (kg)")).toBeDefined();
    w.sheet.setCell(CB, n, "Berat (kg)", "58,5");
    p = w.sync();
    expect(w.db.find("pd_bmi_checks", { staff_code: "SUB-02", period: 1 })).toMatchObject({ height_cm: 168, weight_kg: 58.5 });
    expect(w.sheet.note(CB, n, "Berat (kg)")).toBeUndefined();
    expectSteady(w);
  });

  test("BMI: height without weight is rejected; a date alone is an incomplete row", () => {
    const w = seeded();
    const n = w.sheet.rows(CB).length + 2;
    w.sheet.setCell(CB, n, "ID SDM", "SUB-02");
    w.sheet.setCell(CB, n, "Cek Ke", 2);
    w.sheet.setCell(CB, n, "Tinggi (cm)", 168);
    w.sheet.setCell(CB, n + 1, "ID SDM", "SUB-02");
    w.sheet.setCell(CB, n + 1, "Cek Ke", 3);
    w.sheet.setCell(CB, n + 1, "Tgl Cek", "09/11/2026");
    const p = w.sync();
    const t = tp(p, "pd_bmi_checks");
    expect(t.db.inserts).toEqual([]);
    expect(t.issues.map((i) => `${i.kind}:${i.column}`).sort()).toEqual(["incomplete_row:height_cm", "required_missing:weight_kg"]);
    expect(w.sheet.note(CB, n + 1, "Tinggi (cm)")).toContain("Baris belum lengkap");
  });

  test("enum values match case-insensitively; unknown values are rejected", () => {
    const w = seeded();
    const r = rowOf(w, TS, "ID SDM", "SUB-01");
    w.sheet.setCell(TS, r, "Status tindakan utama", "selesai");
    w.sheet.setCell(TS, r, "Usulan", "Kadang");
    w.sheet.setCell(TS, r, "L/P", "p");
    const p = w.sync();
    expect(tp(p, "pd_staff").db.updates).toEqual([{ key: { code: "SUB-01" }, set: { main_status: "Selesai", gender: "P" } }]);
    expect(tp(p, "pd_staff").issues.map((i) => i.column)).toEqual(["proposal"]);
  });

  test("Cek BMI row for an unknown staff code is not inserted", () => {
    const w = seeded();
    const n = w.sheet.rows(CB).length + 2;
    w.sheet.setCell(CB, n, "ID SDM", "XXX-99");
    w.sheet.setCell(CB, n, "Cek Ke", 2);
    w.sheet.setCell(CB, n, "Tinggi (cm)", 160);
    w.sheet.setCell(CB, n, "Berat (kg)", 60);
    const p = w.sync();
    expect(tp(p, "pd_bmi_checks").db.inserts).toEqual([]);
    expect(tp(p, "pd_bmi_checks").issues[0]).toMatchObject({ kind: "unknown_parent", column: "staff_code" });
    expect(w.sheet.note(CB, n, "ID SDM")).toContain("tidak ada di Tracker Staf");
    expectSteady(w);
  });

  test("a row whose (natural) key cell is empty is reported, not synced", () => {
    const w = seeded();
    const n = w.sheet.rows(LB).length + 2;
    w.sheet.setCell(LB, n, "Periode", "2026-11-01");
    w.sheet.setCell(LB, n, "Catatan", "Tanpa Cabang");
    const p = w.sync();
    expect(tp(p, "pd_monthly_reports").db.inserts).toEqual([]);
    expect(tp(p, "pd_monthly_reports").issues[0]).toMatchObject({ kind: "missing_key", column: "report_group" });
  });

  test("Area must be a pd_areas name: matched in any case and stored as the DB spells it; unknown is rejected", () => {
    const w = seeded();
    const r1 = rowOf(w, RA, "ID Sistem", 1);
    const r2 = rowOf(w, RA, "ID Sistem", 2);
    w.sheet.setCell(RA, r1, "Area", "  komunikasi   TOUCH point");
    w.sheet.setCell(RA, r2, "Area", "Kebersihan");
    const p = w.sync();
    expect(tp(p, "pd_action_plans").db.updates).toEqual([{ key: { id: 1 }, set: { area: "Komunikasi touch point" } }]);
    expect(tp(p, "pd_action_plans").issues).toMatchObject([{ kind: "invalid_value", rowKey: "2", column: "area" }]);
    expect(w.sheet.note(RA, r2, "Area")).toContain("tidak ada di daftar area");
    expect(plan(w, 2).area).toBe("BMI");
    expectSteady(w);
  });

  test("without a known area list (no pd_areas read) any area text passes through", () => {
    const w = seeded();
    const snapshot = w.db.snapshot();
    delete snapshot.areas;
    w.sheet.setCell(RA, rowOf(w, RA, "ID Sistem", 1), "Area", "Kebersihan");
    const p = merge({ baseline: w.baseline, sheet: w.sheet.snapshot(), db: snapshot, specs: w.specs });
    expect(tp(p, "pd_action_plans").db.updates).toEqual([{ key: { id: 1 }, set: { area: "Kebersihan" } }]);
  });
});

// ------------------------------------------------------------------ formula cells, placement, clearing

describe("layout rules in the engine", () => {
  test("a locked (formula) cell is never read as input nor written; the DB value stands", () => {
    const w = seeded();
    const r = rowOf(w, RA, "ID Sistem", 1);
    w.sheet.lock(RA, r, "Batas waktu");
    w.sheet.setCell(RA, r, "Batas waktu", 46400); // a recalculated formula value
    plan(w, 1).due_date = "2026-11-30";
    const p = w.sync();
    expect(tp(p, "pd_action_plans").db.updates).toEqual([]);
    expect(tp(p, "pd_action_plans").sheet.updates).toEqual([]);
    expect(w.baseline!.tables.pd_action_plans!["1"].due_date).toBe("2026-11-30");
    expectSteady(w);
  });

  test("appendMode none: a DB row without a sheet row is reported once, never placed or deleted", () => {
    const w = seeded();
    w.specs = withSpec("pd_staff", { appendMode: "none", noRowMessage: "Tidak ada baris kosong di Tracker Staf" });
    w.db.rows("pd_staff").push(staffRow("BPN-09", 9));
    let p = w.sync();
    const s = tp(p, "pd_staff");
    expect(s.sheet.appends).toEqual([]);
    expect(s.issues[0]).toMatchObject({ kind: "no_sheet_row", rowKey: "BPN-09", isNew: true, message: "Tidak ada baris kosong di Tracker Staf" });
    expect(w.baseline!.tables.pd_staff!["BPN-09"]).toBeUndefined();
    p = w.sync();
    expect(tp(p, "pd_staff").issues[0].isNew).toBe(false);
    expect(tp(p, "pd_staff").db.deletes).toEqual([]);
    expect(staff(w, "BPN-09")).toBeDefined();
  });

  test("deleteMode clear: deleting never removes rows, a generated id is cleared too", () => {
    const specs = withSpec("pd_replacements", { deleteMode: "clear" });
    const w = seeded(smallDb(), specs);
    w.db.tables.set("pd_replacements", []);
    const p = w.sync();
    const t = tp(p, "pd_replacements");
    expect(t.sheet.deleteRows).toEqual([]);
    expect(t.sheet.updates.some((u) => u.col === 0 && u.value === null)).toBe(true); // ID Sistem cleared
    expect(w.sheet.cell(PG, 2, "ID Sistem")).toBe("");
    expect(w.sheet.cell(PG, 2, "Nama")).toBe("");
    expectSteady(w);
  });

  test("orphan child rows are removed, other deletes only clear (rows with an emptyRowIsAbsent rule)", () => {
    const w = seeded();
    w.db.remove("pd_bmi_checks", () => true);
    const p = w.sync();
    expect(tp(p, "pd_bmi_checks").sheet.deleteRows).toEqual([]);
    expect(w.sheet.rows(CB)).toEqual([{ "ID SDM": "SUB-01", "Cek Ke": 1, "Tgl Cek": "", "Tinggi (cm)": "", "Berat (kg)": "" }]);
    expectSteady(w);
  });
});

// ------------------------------------------------------------------ headers and tabs

describe("header and tab problems", () => {
  test("renamed header: hard error for that table only, nothing touched, other tables still sync", () => {
    const w = seeded();
    const col = w.sheet.tabs.get(TS)!.values[0].indexOf("Nama");
    w.sheet.tabs.get(TS)!.values[0][col] = "Nama Lengkap";
    staff(w, "SUB-01").progress_notes = "dari web";
    w.sheet.setCell(RA, rowOf(w, RA, "ID Sistem", 1), "PIC", "PIC Baru");
    const before = JSON.stringify(w.sheet.tabs.get(TS)!.values);
    const p = w.sync();
    const s = tp(p, "pd_staff");
    expect(s.error).toContain('"Nama"');
    expect(s.db).toEqual({ inserts: [], updates: [], deletes: [], pending: [] });
    expect(s.sheet.updates).toEqual([]);
    expect(JSON.stringify(w.sheet.tabs.get(TS)!.values)).toBe(before);
    expect(plan(w, 1).pic).toBe("PIC Baru");
    expect(tp(p, "pd_bmi_checks").error).toBeNull();

    w.sheet.tabs.get(TS)!.values[0][col] = "Nama";
    w.sync();
    expect(w.sheet.cell(TS, rowOf(w, TS, "ID SDM", "SUB-01"), "Catatan progres")).toBe("dari web");
    expectSteady(w);
  });

  test("missing column and duplicate column are hard errors", () => {
    const w = seeded();
    for (const row of w.sheet.tabs.get(RA)!.values) row.splice(3, 1); // drop "Tindakan"
    expect(tp(w.plan(), "pd_action_plans").error).toContain('"Tindakan"');

    const w2 = seeded();
    w2.sheet.tabs.get(LB)!.values[0].push("Cabang");
    expect(tp(w2.plan(), "pd_monthly_reports").error).toContain("kolom ganda");
  });

  test("a layout error from the sheet adapter is a hard error for that table", () => {
    const w = seeded();
    const p = merge({
      baseline: w.baseline,
      sheet: { ...w.sheet.snapshot(), errors: { [RA]: 'Tab "Rencana Aksi": kolom tidak ditemukan.' } },
      db: w.db.snapshot(),
      specs: w.specs,
    });
    expect(tp(p, "pd_action_plans").error).toContain("kolom tidak ditemukan");
    expect(tp(p, "pd_action_plans").issues[0].kind).toBe("header_error");
  });

  test("extra and reordered columns are fine; writes land in the right column", () => {
    const w = new World(smallDb());
    const header = ["Catatan pribadi", ...specFor("pd_monthly_reports").columns.map((c) => c.header).reverse()];
    const sub = sheetRow("pd_monthly_reports", monthlyRow("SUB", "2026-10-01", { notes: "Versi sheet" }));
    w.sheet.addTab(LB, [header, header.map((h) => (h === "Catatan pribadi" ? "x" : (sub[h] ?? "")))]);
    w.sync();
    const rows = w.sheet.tabs.get(LB)!.values.slice(1);
    expect(rows.map((r) => [r[0], r[header.indexOf("Cabang")], r[header.indexOf("Catatan")]])).toEqual([
      ["x", "SUB", "Versi sheet"],
      ["", "CGK & HLP", "Laporan gabungan"],
    ]);
    expect(report(w, "SUB")!.notes).toBe("Versi sheet");
    expectSteady(w);
  });

  test("deleted tab: recreated and refilled from the DB, nothing deleted in the DB", () => {
    const w = seeded();
    w.sheet.tabs.delete(LB);
    const p = w.sync();
    expect(tp(p, "pd_monthly_reports").sheet.create).toBe(true);
    expect(tp(p, "pd_monthly_reports").db.deletes).toEqual([]);
    expect(w.sheet.rows(LB)).toHaveLength(2);
    expectSteady(w);
  });

  test("tab cleared completely (header too): header rewritten and refilled", () => {
    const w = seeded();
    w.sheet.tabs.get(LB)!.values = [];
    const p = w.sync();
    expect(tp(p, "pd_monthly_reports").sheet.writeHeader).toBe(true);
    expect(tp(p, "pd_monthly_reports").db.deletes).toEqual([]);
    expect(w.sheet.rows(LB)).toHaveLength(2);
    expectSteady(w);
  });
});

// ------------------------------------------------------------------ duplicates and empty rows

describe("duplicate keys and empty rows", () => {
  test("duplicate keys in the sheet: every copy is a validation error and the key is left alone", () => {
    const w = seeded();
    const r = rowOf(w, CB, "ID SDM", "SUB-01");
    const t = w.sheet.tabs.get(CB)!;
    const copy = [...t.values[r - 1]];
    copy[specFor("pd_bmi_checks").columns.findIndex((c) => c.header === "Tinggi (cm)")] = 171;
    t.values.push(copy);
    w.db.find("pd_bmi_checks", { staff_code: "SUB-01", period: 1 })!.check_date = "2026-10-13";
    const p = w.sync();
    const bc = tp(p, "pd_bmi_checks");
    expect(bc.issues.filter((i) => i.kind === "duplicate_key")).toHaveLength(2);
    expect(bc.db.updates).toEqual([]);
    expect(bc.sheet.updates).toEqual([]);
    expect(w.db.find("pd_bmi_checks", { staff_code: "SUB-01", period: 1 })!.height_cm).toBe(170);
    expectSteady(w);

    t.values.pop();
    w.sync();
    expect(w.sheet.cell(CB, r, "Tgl Cek")).toBe(46308);
    expectSteady(w);
  });

  test("pre-filled empty entry rows count as absent; filling one inserts, clearing it deletes", () => {
    const w = seeded();
    const n = w.sheet.rows(CB).length + 2;
    for (const [i, period] of [2, 3].entries()) {
      w.sheet.setCell(CB, n + i, "ID SDM", "SUB-01");
      w.sheet.setCell(CB, n + i, "Cek Ke", period);
    }
    let p = w.sync();
    expect(tp(p, "pd_bmi_checks").db.inserts).toEqual([]);
    expectSteady(w);

    w.sheet.setCell(CB, n, "Tinggi (cm)", 170);
    w.sheet.setCell(CB, n, "Berat (kg)", 64);
    p = w.sync();
    expect(tp(p, "pd_bmi_checks").db.inserts).toHaveLength(1);
    expect(w.db.find("pd_bmi_checks", { staff_code: "SUB-01", period: 2 })!.weight_kg).toBe(64);
    expectSteady(w);

    w.sheet.setCell(CB, n, "Tinggi (cm)", "");
    w.sheet.setCell(CB, n, "Berat (kg)", "");
    p = w.sync();
    expect(tp(p, "pd_bmi_checks").db.deletes).toEqual([{ staff_code: "SUB-01", period: 2 }]);
    expect(w.sheet.cell(CB, n, "ID SDM")).toBe("SUB-01");
    expectSteady(w);
  });

  test("a DB row lands in its pre-filled entry row instead of being appended", () => {
    const w = seeded();
    const n = w.sheet.rows(CB).length + 2;
    w.sheet.setCell(CB, n, "ID SDM", "SUB-02");
    w.sheet.setCell(CB, n, "Cek Ke", 3);
    w.sync();
    w.db.rows("pd_bmi_checks").push(bmiRow(9, "SUB-02", 3, { weight_kg: 59 }));
    const p = w.sync();
    expect(tp(p, "pd_bmi_checks").sheet.appends).toEqual([]);
    expect(w.sheet.cell(CB, n, "Berat (kg)")).toBe(59);
    expectSteady(w);
  });

  test("blank rows between data rows are ignored", () => {
    const w = seeded();
    w.sheet.tabs.get(RA)!.values.splice(2, 0, [], ["", "", "", ""]);
    expect(pending(w.plan())).toEqual([]);
  });
});

// ------------------------------------------------------------------ normalization in the merge

describe("equivalent representations cause no phantom diffs", () => {
  test('"3" vs 3.0, date text vs serial, padded text, dash in empty number/date cells', () => {
    const w = seeded();
    const ts = rowOf(w, TS, "ID SDM", "SUB-01");
    w.sheet.setCell(TS, ts, "Praktik awal", "3,00");
    w.sheet.setCell(TS, ts, "Nama", "  Petugas SUB-01 ");
    w.sheet.setCell(TS, ts, "Batas waktu", "30 Okt 2026");
    w.sheet.setCell(TS, ts, "Praktik ulang (1–5)", "–");
    w.sheet.setCell(TS, ts, "Batas tambahan", "-");
    w.sheet.setCell(TS, ts, "Tgl penilaian ulang", " — ");
    const cb = rowOf(w, CB, "ID SDM", "SUB-01");
    w.sheet.setCell(CB, cb, "Tgl Cek", "12/10/2026");
    w.sheet.setCell(CB, cb, "Berat (kg)", "65.50");
    w.sheet.setCell(LB, rowOf(w, LB, "Cabang", "SUB"), "Indeks kepuasan JOUMPA", "4,50");
    expect(pending(w.plan())).toEqual([]);
  });

  test("DB numeric strings and floats normalize too", () => {
    const db = smallDb();
    (db.pd_bmi_checks![0] as Record<string, unknown>).weight_kg = "65.5";
    const w = new World(db);
    w.sync();
    w.db.find("pd_bmi_checks", { staff_code: "SUB-01", period: 1 })!.weight_kg = 65.50000000001;
    expect(pending(w.plan())).toEqual([]);
  });
});

// ------------------------------------------------------------------ generated keys

describe("Tracker Staf: codes come from the database", () => {
  test("a new sheet row without ID SDM gets the station's next code written back", () => {
    const w = seeded();
    const n = w.sheet.rows(TS).length + 2;
    w.sheet.setCell(TS, n, "Nama", "Petugas Tambahan");
    w.sheet.setCell(TS, n, "Stn", "sub");
    w.sheet.setCell(TS, n + 1, "Nama", "Petugas Pertama BPN");
    w.sheet.setCell(TS, n + 1, "Stn", "BPN");
    const p = w.sync();
    expect(tp(p, "pd_staff").db.pending.map((x) => x.values.station)).toEqual(["SUB", "BPN"]);
    expect(tp(p, "pd_staff").sheet.idWrites).toEqual([
      { ref: 1, row: n, col: 0 },
      { ref: 2, row: n + 1, col: 0 },
    ]);
    expect([w.sheet.cell(TS, n, "ID SDM"), w.sheet.cell(TS, n + 1, "ID SDM")]).toEqual(["SUB-03", "BPN-01"]);
    expect(staff(w, "SUB-03")).toMatchObject({ name: "Petugas Tambahan", report_group: "SUB" });
    expect(w.baseline!.tables.pd_staff!["SUB-03"]).toMatchObject({ code: "SUB-03", name: "Petugas Tambahan" });
    // Cabang was left empty: the DB fills it from the station and it comes back on the next run.
    w.sync();
    expect(w.sheet.cell(TS, n + 1, "Cabang")).toBe("BPN");
    expectSteady(w);
  });

  test("first run: id-less sheet rows are matched to existing DB rows by station + name", () => {
    const w = new World(smallDb());
    const db = smallDb().pd_staff!;
    w.sheet.addTab(
      TS,
      tableValues("pd_staff", [
        { ...sheetRow("pd_staff", db[2]), "ID SDM": "" },
        { ...sheetRow("pd_staff", db[0]), "ID SDM": "", Stn: "sub", Nama: " petugas  SUB-01", PIC: "Lain" },
      ]),
    );
    const p = w.sync();
    expect(tp(p, "pd_staff").db.pending).toEqual([]);
    expect(w.sheet.rows(TS).map((r) => r["ID SDM"])).toEqual(["DPS-01", "SUB-01", "SUB-02"]);
    expect(tp(p, "pd_staff").conflicts.map((c) => `${c.rowKey}:${c.column}`)).toEqual(["SUB-01:name", "SUB-01:pic"]);
    expectSteady(w);
  });

  test("an ID SDM cleared by hand is re-linked, not duplicated", () => {
    const w = seeded();
    const r = rowOf(w, TS, "ID SDM", "SUB-02");
    w.sheet.setCell(TS, r, "ID SDM", "");
    w.sync();
    expect(w.db.rows("pd_staff")).toHaveLength(3);
    expect(w.sheet.cell(TS, r, "ID SDM")).toBe("SUB-02");
    expectSteady(w);
  });
});

describe("Penggantian SDM: ID Sistem written back after insert", () => {
  test("new sheet row without id gets the DB id written back", () => {
    const w = seeded();
    const n = w.sheet.rows(PG).length + 2;
    w.sheet.setCell(PG, n, "Cabang", "KNO");
    w.sheet.setCell(PG, n, "Nama", "Orang Baru");
    const p = w.sync();
    expect(tp(p, "pd_replacements").db.pending).toHaveLength(1);
    expect(tp(p, "pd_replacements").sheet.idWrites).toEqual([{ ref: 1, row: n, col: 0 }]);
    expect(w.sheet.cell(PG, n, "ID Sistem")).toBe(2);
    expect(w.baseline!.tables.pd_replacements!["2"]).toMatchObject({ id: 2, name: "Orang Baru", report_group: "KNO" });
    expectSteady(w);
  });

  test("first run: id-less sheet rows are matched to existing DB rows by name", () => {
    const w = new World({ ...smallDb(), pd_replacements: [replacementRow(7), replacementRow(8, { report_group: "KNO" })] });
    w.sheet.addTab(
      PG,
      tableValues("pd_replacements", [
        { Nama: "Diganti 7", Cabang: "SUB", "Persetujuan Direksi": "Ya" },
        { Nama: " diganti  8" },
      ]),
    );
    const p = w.sync();
    expect(tp(p, "pd_replacements").db.pending).toEqual([]);
    expect(w.sheet.rows(PG).map((r) => r["ID Sistem"])).toEqual([7, 8]);
    expect(tp(p, "pd_replacements").conflicts[0]).toMatchObject({ rowKey: "7", column: "director_approval", sheet: "Ya", db: "Belum", resolution: "db-wins" });
    expect(tp(p, "pd_replacements").conflicts[1]).toMatchObject({ rowKey: "8", column: "name", resolution: "db-wins" });
    expect(w.sheet.cell(PG, 3, "Cabang")).toBe("KNO");
    expectSteady(w);
  });

  test("an id cell cleared by hand is re-linked, not duplicated", () => {
    const w = seeded();
    w.sheet.setCell(PG, 2, "ID Sistem", "");
    w.sync();
    expect(w.db.rows("pd_replacements")).toHaveLength(1);
    expect(w.sheet.cell(PG, 2, "ID Sistem")).toBe(1);
    expectSteady(w);
  });

  test("ID SDM must name an existing staff member; the DB then copies Nama/Cabang; deleting that staff nulls it", () => {
    const w = seeded();
    const r = rowOf(w, PG, "ID Sistem", 1);
    w.sheet.setCell(PG, r, "ID SDM", "XXX-01");
    let p = w.sync();
    expect(tp(p, "pd_replacements").issues[0]).toMatchObject({ kind: "unknown_parent", column: "staff_code" });
    expect(w.db.find("pd_replacements", { id: 1 })!.staff_code).toBeNull();

    w.sheet.setCell(PG, r, "ID SDM", "SUB-02");
    p = w.sync();
    expect(w.db.find("pd_replacements", { id: 1 })).toMatchObject({ staff_code: "SUB-02", name: "Petugas SUB-02" });
    expect(w.sheet.note(PG, r, "ID SDM")).toBeUndefined();
    w.sync();
    expect(w.sheet.cell(PG, r, "Nama")).toBe("Petugas SUB-02");
    expectSteady(w);

    w.sheet.tabs.get(TS)!.values.splice(rowOf(w, TS, "ID SDM", "SUB-02") - 1, 1);
    w.sync();
    expect(w.db.find("pd_replacements", { id: 1 })!.staff_code).toBeNull();
    expect(w.sheet.cell(PG, r, "ID SDM")).toBe("");
    expectSteady(w);
  });
});

// ------------------------------------------------------------------ Laporan Bulanan (Cabang + Periode)

describe("Laporan Bulanan keyed by (Cabang, Periode)", () => {
  test("same period, different Cabang are separate rows; a new Cabang row from the sheet is inserted", () => {
    const w = seeded();
    const n = w.sheet.rows(LB).length + 2;
    w.sheet.setCell(LB, n, "Cabang", "dps");
    w.sheet.setCell(LB, n, "Periode", "2026-10-01");
    w.sheet.setCell(LB, n, "Catatan", "Laporan DPS");
    const p = w.sync();
    expect(tp(p, "pd_monthly_reports").db.inserts).toMatchObject([{ report_group: "DPS", period: "2026-10-01", notes: "Laporan DPS" }]);
    expect(w.db.rows("pd_monthly_reports")).toHaveLength(3);
    expectSteady(w);
  });

  test("duplicate (Cabang, Periode) is a validation error; unknown Cabang is rejected", () => {
    const w = seeded();
    const n = w.sheet.rows(LB).length + 2;
    w.sheet.setCell(LB, n, "Cabang", "SUB");
    w.sheet.setCell(LB, n, "Periode", "2026-10-01");
    w.sheet.setCell(LB, n, "Catatan", "lagi");
    w.sheet.setCell(LB, n + 1, "Cabang", "Pusat");
    w.sheet.setCell(LB, n + 1, "Periode", "2026-11-01");
    w.sheet.setCell(LB, n + 1, "Catatan", "x");
    const p = w.sync();
    const t = tp(p, "pd_monthly_reports");
    expect(t.issues.map((i) => i.kind).sort()).toEqual(["duplicate_key", "duplicate_key", "invalid_value"]);
    expect(t.db).toEqual({ inserts: [], updates: [], deletes: [], pending: [] });
  });
});

describe("attribution and DB-only columns are not synced", () => {
  test("changes to updated_by_* / updated_at / sort_order / created_at alone produce an empty plan", () => {
    const w = seeded();
    for (const t of ["pd_staff", "pd_replacements", "pd_action_plans", "pd_monthly_reports"] as SyncTable[]) {
      for (const r of w.db.rows(t)) Object.assign(r, { updated_by_link: "00000000-0000-0000-0000-0000000000ff", updated_at: "2027-01-01T00:00:00Z", sort_order: 99, created_at: "2027-01-01T00:00:00Z" });
    }
    for (const r of w.db.rows("pd_bmi_checks")) Object.assign(r, { updated_by_user: "x", updated_by_link: "y", updated_at: "2027-01-01T00:00:00Z" });
    w.db.rows("pd_settings")[0].updated_at = "2027-01-01T00:00:00Z";
    expectSteady(w);
  });
});

// ------------------------------------------------------------------ settings (Parameter BMI)

describe("Parameter BMI (settings as key/value rows)", () => {
  const rowOfKey = (w: World, key: string) => rowOf(w, PB, "Parameter", key);

  test("edit in the sheet updates the settings row", () => {
    const w = seeded();
    w.sheet.setCell(PB, rowOfKey(w, "bmi_first_check"), "Nilai", "19/10/2026");
    const p = w.sync();
    expect(tp(p, "pd_settings").db.updates).toEqual([{ key: { key: "bmi_first_check" }, set: { value: "2026-10-19" } }]);
    expect(w.db.rows("pd_settings")[0].bmi_first_check).toBe("2026-10-19");
    expectSteady(w);
  });

  test("cross-field rule (Normal s.d. <= Overweight s.d.) rejects the edit", () => {
    const w = seeded();
    const r = rowOfKey(w, "bmi_normal_max");
    w.sheet.setCell(PB, r, "Nilai", 30);
    const p = w.sync();
    expect(tp(p, "pd_settings").db.updates).toEqual([]);
    expect(w.db.rows("pd_settings")[0].bmi_normal_max).toBe(25);
    expect(w.sheet.note(PB, r, "Nilai")).toContain("berurutan");
    expectSteady(w);
  });

  test("a deleted parameter row is restored, never deleted in the DB", () => {
    const w = seeded();
    w.sheet.tabs.get(PB)!.values.splice(rowOfKey(w, "bmi_periods") - 1, 1);
    w.sync();
    expect(w.db.rows("pd_settings")[0].bmi_periods).toBe(5);
    expect(w.sheet.rows(PB).find((r) => r.Parameter === "bmi_periods")!.Nilai).toBe(5);
    expectSteady(w);
  });

  test("unknown key and invalid value", () => {
    const w = seeded();
    const n = w.sheet.rows(PB).length + 2;
    w.sheet.setCell(PB, n, "Parameter", "foo");
    w.sheet.setCell(PB, n, "Nilai", 1);
    w.sheet.setCell(PB, rowOfKey(w, "bmi_periods"), "Nilai", 99);
    const p = w.sync();
    expect(tp(p, "pd_settings").issues.map((i) => i.kind).sort()).toEqual(["invalid_value", "unknown_setting"]);
    expect(w.db.rows("pd_settings")[0].bmi_periods).toBe(5);
  });

  test("optional value can be set and cleared; a required one cannot be cleared", () => {
    const w = seeded();
    w.sheet.setCell(PB, rowOfKey(w, "min_height_female"), "Nilai", 155);
    w.sync();
    expect(w.db.rows("pd_settings")[0].min_height_female).toBe(155);
    w.sheet.setCell(PB, rowOfKey(w, "min_height_female"), "Nilai", "");
    w.sheet.setCell(PB, rowOfKey(w, "bmi_interval_days"), "Nilai", "");
    const p = w.sync();
    expect(w.db.rows("pd_settings")[0].min_height_female).toBeNull();
    expect(w.db.rows("pd_settings")[0].bmi_interval_days).toBe(14);
    expect(tp(p, "pd_settings").issues).toMatchObject([{ kind: "required_missing", rowKey: "bmi_interval_days" }]);
  });

  test("settings row missing in the DB is a hard error", () => {
    const w = new World({ ...smallDb(), pd_settings: [] });
    expect(tp(w.plan(), "pd_settings").error).not.toBeNull();
  });
});

// ------------------------------------------------------------------ idempotency

describe("idempotency", () => {
  test("a long mixed sequence always settles: re-merging after each run yields an empty plan", () => {
    const w = seeded();
    const steps: ((w: World) => void)[] = [
      (w) => w.sheet.setCell(TS, rowOf(w, TS, "ID SDM", "SUB-01"), "Catatan progres", "a"),
      (w) => (staff(w, "SUB-02").reassess_practice = 4),
      (w) => w.db.rows("pd_staff").push(staffRow("KNO-01", 4)),
      (w) => w.sheet.setCell(CB, 2, "Berat (kg)", 64),
      (w) => w.db.rows("pd_bmi_checks").push(bmiRow(10, "KNO-01", 2)),
      (w) => (plan(w, 2).progress = 50),
      (w) => w.sheet.setCell(RA, rowOf(w, RA, "ID Sistem", 1), "Status", "Selesai"),
      (w) => (plan(w, 1).archived_at = "2026-10-21T00:00:00Z"),
      (w) => w.sheet.setCell(LB, rowOf(w, LB, "Cabang", "SUB"), "Catatan", "baru"),
      (w) => w.db.rows("pd_replacements").push(replacementRow(5, { report_group: "DPS" })),
      (w) => w.sheet.setCell(PG, 2, "Post-test pengganti", 85),
      (w) => w.sheet.setCell(PB, rowOf(w, PB, "Parameter", "bmi_interval_days"), "Nilai", 7),
      (w) => {
        staff(w, "SUB-01").name = "Nama Web";
        w.sheet.setCell(TS, rowOf(w, TS, "ID SDM", "SUB-01"), "Nama", "Nama Sheet");
      },
    ];
    for (const step of steps) {
      step(w);
      w.sync();
      expectSteady(w);
    }
    expect(staff(w, "SUB-01").name).toBe("Nama Web");
    expect(report(w, "SUB")!.notes).toBe("baru");
    expect(plan(w, 1)).toMatchObject({ status: "Selesai", archived_at: "2026-10-21T00:00:00Z" });
    expect(w.sheet.rows(RA).some((r) => r["ID Sistem"] === 1)).toBe(false);
    expect(w.sheet.rows(TS).some((r) => r["ID SDM"] === "KNO-01")).toBe(true);
  });

  test("merge is deterministic for identical inputs", () => {
    const w = seeded();
    w.sheet.setCell(TS, 2, "Catatan progres", "x");
    const input = { baseline: w.baseline, sheet: w.sheet.snapshot(), db: w.db.snapshot(), specs: w.specs };
    expect(JSON.stringify(merge(input))).toBe(JSON.stringify(merge(input)));
  });

  test("settings values come from the DB on the first run", () => {
    const w = new World({ ...smallDb(), pd_settings: [settingsRow({ bmi_periods: 12 })] });
    w.sync();
    expect(w.sheet.rows(PB).find((r) => r.Parameter === "bmi_periods")!.Nilai).toBe(12);
  });
});

// ------------------------------------------------------------------ stations from the database

describe("stations come from public.stations", () => {
  const withUpg = (): DbSnapshot => ({ ...smallDb(), stations: [...TEST_STATIONS, { code: "UPG", report_group: "UPG" }] });

  test("a listed station is accepted in any case; an unknown code is noted and not written", () => {
    const w = seeded(withUpg());
    const n = w.sheet.rows(TS).length + 2;
    w.sheet.setCell(TS, n, "Stn", "upg");
    w.sheet.setCell(TS, n, "Nama", "Petugas UPG");
    w.sheet.setCell(TS, n + 1, "Stn", "JKT");
    w.sheet.setCell(TS, n + 1, "Nama", "Petugas JKT");
    w.sync();
    expect(staff(w, "UPG-01")).toMatchObject({ station: "UPG", report_group: "UPG" });
    expect(w.db.rows("pd_staff").some((s) => s.name === "Petugas JKT")).toBe(false);
    expect(w.sheet.note(TS, n + 1, "Stn")).toContain("tidak ada di daftar stasiun");
  });

  test("Cabang must be the report group of some station", () => {
    const w = seeded(withUpg());
    const r1 = rowOf(w, RA, "ID Sistem", 1);
    const r2 = rowOf(w, RA, "ID Sistem", 2);
    w.sheet.setCell(RA, r1, "Cabang", "upg");
    w.sheet.setCell(RA, r2, "Cabang", "XYZ");
    w.sync();
    expect(plan(w, 1).report_group).toBe("UPG");
    expect(plan(w, 2).report_group).toBe("DPS");
    expect(w.sheet.note(RA, r2, "Cabang")).toContain("tidak dikenal");
  });

  test("the shared CGK & HLP report group is accepted in any case", () => {
    const w = seeded(withUpg());
    const n = w.sheet.rows(LB).length + 2;
    w.sheet.setCell(LB, n, "Cabang", "cgk & hlp");
    w.sheet.setCell(LB, n, "Periode", "2026-11-01");
    w.sheet.setCell(LB, n, "Total staf aktif", 20);
    w.sync();
    expect(report(w, "CGK & HLP", "2026-11-01")).toMatchObject({ active_staff: 20 });
  });
});
