/**
 * Workbook layouts end to end: project -> merge -> translate -> apply on an in-memory copy of the v2
 * workbook (testing/workbook.ts), against a fake v2 store.
 */
import { describe, expect, test } from "bun:test";
import { LayoutViolation, PERCENT, PERIOD, projectAll, tabsToRead, translate } from "../layouts";
import { countPlan, isPlanEmpty, merge } from "../merge";
import { isoToSerial } from "../normalize";
import { a1Column } from "../sheets";
import { UNTOUCHED_TABS } from "../tables";
import { TEST_STATIONS, bmiRow, monthlyRow, planRow, replacementRow, smallDb, staffRow } from "../testing/fixtures";
import { TABS, WorkbookWorld, bmiPeriodCol, type FakeWorkbook, type WorkbookOptions } from "../testing/workbook";
import type { DbSnapshot, Plan, SyncTable } from "../types";

const TS = TABS.staff;
const CB = TABS.bmi;
const PB = TABS.params;
const PG = TABS.replacements;
const RA = TABS.plans;
const LB = TABS.monthly;

/** The fixture plus a staff member whose Praktik awal shows "–" and whose Tindakan tambahan is the text "–". */
function db(): DbSnapshot {
  const d = smallDb();
  d.pd_staff!.push(staffRow("KNO-01", 4, { initial_practice: null, extra_action: "–" }));
  return d;
}

const tp = (plan: Plan, table: SyncTable) => plan.tables.find((t) => t.table === table)!;
const staff = (w: WorkbookWorld, code: string) => w.db.find("pd_staff", { code })!;
/** Cek BMI column letter of period p's Tgl Cek (+0), Tinggi (+1), Berat (+2), BMI (+3). */
const P = (p: number, off = 0) => a1Column(bmiPeriodCol(p) + off);

/**
 * The workbook after its first two syncs. Two, because the first run cannot see Cek BMI yet (see the
 * known bug below): the BMI baseline only exists after run 2.
 */
function world(opts: WorkbookOptions = {}, data = db()) {
  const w = new WorkbookWorld(data, opts);
  w.sync();
  expectSteady(w);
  w.sync();
  expectSteady(w);
  return w;
}

function expectSteady(w: WorkbookWorld) {
  const { plan, counts } = w.prepare();
  const busy = Object.entries(countPlan(plan)).filter(
    ([, c]) => c.dbInserts + c.dbUpdates + c.dbDeletes + c.sheetCellUpdates + c.sheetAppends + c.conflicts + c.newIssues > 0 || c.createTab,
  );
  expect(busy).toEqual([]);
  expect(isPlanEmpty(plan)).toBe(true);
  expect(counts.cellWrites + counts.headerCells + counts.formulaCopies + counts.notes + counts.appends).toBe(0);
}

/** Every formula in the book, as "tab!A1=formula". */
function formulas(b: FakeWorkbook): string[] {
  const out: string[] = [];
  const real = b.snapshot();
  for (const [title, t] of Object.entries(real.tabs)) {
    t!.formulas.forEach((row, r) =>
      row.forEach((f, c) => {
        if (typeof f === "string" && f.startsWith("=")) out.push(`${title}!${a1Column(c)}${r + 1}=${f}`);
      }),
    );
  }
  return out;
}

const writesOf = (ops: { writes: { tab: string; row: number; col: number; value: unknown }[] }) =>
  ops.writes.map((x) => `${x.tab}!${a1Column(x.col)}${x.row}=${JSON.stringify(x.value)}`);

// ------------------------------------------------------------------ first sync

describe("first sync on the imported workbook (same data on both sides)", () => {
  test("no data changes in either direction; only the id columns are added and filled by adoption", () => {
    const w = new WorkbookWorld(db());
    const { plan, ops, counts } = w.sync();
    for (const t of plan.tables) {
      expect(t.error).toBeNull();
      expect(t.db).toEqual({ inserts: [], updates: [], deletes: [], pending: [] });
      expect(t.conflicts).toEqual([]);
    }
    expect(plan.tables.flatMap((t) => t.issues).filter((i) => i.kind !== "no_sheet_row")).toEqual([]);
    expect(counts.createTabs).toEqual([]);
    expect(ops.headerCells.map((h) => `${h.tab}!${a1Column(h.col)}${h.row}=${h.text}${h.hide ? " (hidden)" : ""}`)).toEqual([
      "Tracker Staf!W4=ID SDM",
      "Penggantian SDM!S4=ID Sistem (hidden)",
      "Penggantian SDM!T4=ID SDM",
      "Rencana Aksi!N4=ID Sistem (hidden)",
    ]);
    // Each existing record is linked to its DB row (staff by Stn + Nama, replacements by Nama,
    // plans by Cabang + Area + Tindakan): its key lands in the new column.
    expect(writesOf(ops).sort()).toEqual(
      [
        'Tracker Staf!W5="SUB-01"',
        'Tracker Staf!W6="SUB-02"',
        'Tracker Staf!W7="DPS-01"',
        'Tracker Staf!W8="KNO-01"',
        "Penggantian SDM!S5=1",
        "Rencana Aksi!N5=1",
        "Rencana Aksi!N6=2",
      ].sort(),
    );
    expect(w.book.get(TS, "W6")).toBe("SUB-02");
    expect(w.book.get(CB, "B7")).toBe("SUB-02"); // Cek BMI's ID SDM formula now shows the code
    expect(w.book.hidden(PG, "S")).toBe(true);
    expect(w.book.hidden(PG, "T")).toBe(false);
    expect(w.book.hidden(RA, "N")).toBe(true);
    expect([...w.book.written].sort()).toEqual([PG, RA, TS]);
    expect(w.book.locale).toBe("in_ID");
    expectSteady(w);
  });

  // Cek BMI keys its rows by its ID SDM formula, which reads Tracker Staf W. scripts/v2-import.ts
  // writes W before the first sync, so the first run sees every BMI row.
  test("first run after the import (ID SDM in W): existing BMI checks are seen and enter the baseline", () => {
    const data = db();
    const w = new WorkbookWorld(data);
    w.book.set(TS, "W4", "ID SDM");
    for (const st of data.pd_staff!) w.book.set(TS, `W${w.book.findRow(TS, "B", st.name)}`, st.code);
    w.book.recalc();
    const { plan } = w.sync();
    expect(tp(plan, "pd_bmi_checks").issues).toEqual([]);
    expect(Object.keys(w.baseline!.tables.pd_bmi_checks!)).toEqual(["SUB-01|1"]);
  });

  test("first run without ID SDM in W: BMI rows are reported once and picked up by the next run", () => {
    const w = new WorkbookWorld(db());
    const first = w.sync();
    expect(tp(first.plan, "pd_bmi_checks").issues.map((i) => i.kind)).toContain("no_sheet_row");
    const second = w.sync();
    expect(tp(second.plan, "pd_bmi_checks").issues).toEqual([]);
    expect(Object.keys(w.baseline!.tables.pd_bmi_checks!)).toEqual(["SUB-01|1"]);
  });

  // L/P, NIPP and the BMI note are located by position (Cek BMI row = Tracker Staf row + 1), so the
  // first run compares them even before ID SDM is filled in.
  test("first run: a different L/P in Cek BMI is a db-wins conflict, not a silent sheet edit", () => {
    const w = new WorkbookWorld(db());
    w.book.set(CB, `F${w.book.findRow(CB, "C", "Petugas SUB-01")}`, "P");
    const conflicts = [w.sync(), w.sync()].flatMap(({ plan }) => tp(plan, "pd_staff").conflicts);
    expect(staff(w, "SUB-01").gender).toBe("L");
    expect(conflicts).toMatchObject([{ rowKey: "SUB-01", column: "gender", sheet: "P", db: "L", resolution: "db-wins" }]);
  });

  test("first run: a replacement linked to a staff member gets both S (ID Sistem) and T (ID SDM)", () => {
    const data = db();
    data.pd_replacements = [replacementRow(4, { staff_code: "SUB-02", name: "Petugas SUB-02" })];
    const w = new WorkbookWorld(data);
    const { plan, ops } = w.sync();
    expect(tp(plan, "pd_replacements").db).toEqual({ inserts: [], updates: [], deletes: [], pending: [] });
    expect(writesOf(ops).filter((x) => x.startsWith(PG))).toEqual(["Penggantian SDM!S5=4", 'Penggantian SDM!T5="SUB-02"']);
    expectSteady(w);
  });

  test("a workbook that already has the id columns needs nothing at all", () => {
    const w = new WorkbookWorld(db(), { withIds: true });
    const { plan, ops } = w.sync();
    expect(ops.headerCells).toEqual([]);
    expect(ops.writes).toEqual([]);
    expect(plan.tables.flatMap((t) => t.issues)).toEqual([]);
    expect(w.book.written.size).toBe(0);
    expectSteady(w);
  });

  test("untouched tabs and existing formulas survive a busy sequence of edits", () => {
    const w = world();
    const before = formulas(w.book);
    staff(w, "SUB-01").progress_notes = "web";
    w.book.set(TS, "U6", "sheet");
    w.db.rows("pd_bmi_checks").push(bmiRow(9, "SUB-02", 2));
    w.db.rows("pd_action_plans").push(planRow(3, { report_group: "KNO", area: "BMI" }));
    w.db.rows("pd_replacements").push(replacementRow(2, { report_group: "DPS" }));
    w.db.rows("pd_monthly_reports").push(monthlyRow("DPS", "2026-10-01"));
    w.book.set(PB, `C${w.book.findRow(PB, "B", "Interval cek BMI (hari)")}`, 7);
    w.sync();
    expectSteady(w);
    for (const t of UNTOUCHED_TABS) expect(w.book.written.has(t)).toBe(false);
    expect(formulas(w.book).filter((f) => !before.includes(f))).toEqual([]);
    expect(before.filter((f) => !formulas(w.book).includes(f))).toEqual([]);
  });

  test("the adapter reads the synced tabs (Cek BMI once) and never the untouched ones", () => {
    expect(tabsToRead().sort()).toEqual([CB, LB, PB, PG, RA, TS].sort());
  });
});

// ------------------------------------------------------------------ formula cells

describe("formula cells are never read as input and never written", () => {
  test("a formula in an input cell (Rencana Aksi Batas waktu) is skipped; literals beside it sync", () => {
    const w = world();
    const r1 = w.book.findRow(RA, "N", 1);
    const r2 = w.book.findRow(RA, "N", 2);
    w.book.set(RA, `F${r1}`, isoToSerial("2026-10-23"), "=TODAY()+4");
    w.db.find("pd_action_plans", { id: 1 })!.due_date = "2026-12-01";
    w.book.set(RA, `F${r2}`, isoToSerial("2026-10-15"));
    const { plan, ops } = w.sync();
    expect(tp(plan, "pd_action_plans").db.updates).toEqual([{ key: { id: 2 }, set: { due_date: "2026-10-15" } }]);
    expect(ops.writes.some((x) => x.tab === RA && x.row === r1)).toBe(false);
    expect(w.book.formula(RA, `F${r1}`)).toBe("=TODAY()+4");
    expectSteady(w);
  });

  test("derived columns (Hasil penilaian ulang, Flag, BMI, % Sesuai) are neither read nor written", () => {
    const w = world();
    const r = w.book.findRow(TS, "W", "SUB-01");
    w.book.set(TS, `S${r}`, "Sesuai", w.book.formula(TS, `S${r}`));
    w.book.set(CB, `${P(1, 3)}${r + 1}`, 99, w.book.formula(CB, `${P(1, 3)}${r + 1}`));
    w.book.set(LB, "H5", 0.1, w.book.formula(LB, "H5"));
    expectSteady(w);
  });

  test("translate refuses a plan that would write a formula cell", () => {
    const w = world();
    const r1 = w.book.findRow(RA, "N", 1);
    w.book.set(RA, `F${r1}`, isoToSerial("2026-10-23"), "=TODAY()+4");
    const real = w.book.snapshot();
    const { sheet, projections } = projectAll(real);
    const plan = merge({ baseline: w.baseline, sheet, db: w.db.snapshot() });
    const t = tp(plan, "pd_action_plans");
    t.sheet.updates.push({ row: r1 - 3, col: t.sheet.colIndex.due_date, value: "2026-12-01", fmt: "date" });
    expect(() => translate(plan, projections, real)).toThrow(LayoutViolation);
  });

  test("translate refuses row deletes in a workbook tab", () => {
    const w = world();
    const real = w.book.snapshot();
    const { sheet, projections } = projectAll(real);
    const plan = merge({ baseline: w.baseline, sheet, db: w.db.snapshot() });
    tp(plan, "pd_monthly_reports").sheet.deleteRows.push(2);
    expect(() => translate(plan, projections, real)).toThrow(LayoutViolation);
  });
});

// ------------------------------------------------------------------ Tracker Staf

describe("Tracker Staf (header row 4, W = ID SDM, L/P / NIPP / note in Cek BMI)", () => {
  test("a person typed into a blank row gets the station's next code written to W", () => {
    const w = world();
    const r = 9; // first blank row (4 staff in rows 5..8)
    w.book.set(TS, `B${r}`, "Petugas Sheet");
    w.book.set(TS, `C${r}`, "SUB");
    w.book.set(TS, `D${r}`, "sub");
    w.book.set(TS, `L${r}`, "proses");
    const { plan } = w.sync();
    expect(tp(plan, "pd_staff").db.pending).toMatchObject([{ ref: 1, values: { name: "Petugas Sheet", station: "SUB", report_group: "SUB", main_status: "Proses" } }]);
    expect(w.book.get(TS, `W${r}`)).toBe("SUB-03");
    expect(staff(w, "SUB-03")).toMatchObject({ name: "Petugas Sheet", station: "SUB", report_group: "SUB" });
    expect(w.baseline!.tables.pd_staff!["SUB-03"]).toMatchObject({ code: "SUB-03", name: "Petugas Sheet" });
    expect(w.book.get(CB, `B${r + 1}`)).toBe("SUB-03");
    expectSteady(w);

    // From then on its Cek BMI row is its own: L/P typed there reaches the DB.
    w.book.set(CB, `F${r + 1}`, "p");
    w.sync();
    expect(staff(w, "SUB-03").gender).toBe("P");
    expectSteady(w);
  });

  test("a staff member added on the website fills the first blank row with No, ID SDM and the inputs", () => {
    const w = world();
    w.db.rows("pd_staff").push(staffRow("BPN-01", 9, { name: "Petugas Baru", main_status: "Belum Mulai" }));
    const { plan, ops } = w.sync();
    expect(tp(plan, "pd_staff").issues).toEqual([]);
    expect(ops.formulaCopies).toEqual([]);
    const r = w.book.findRow(TS, "W", "BPN-01");
    expect(r).toBe(9);
    expect(["A", "B", "C", "D", "L", "H"].map((c) => w.book.get(TS, `${c}${r}`))).toEqual([5, "Petugas Baru", "BPN", "BPN", "Belum Mulai", 3]);
    expect(w.book.get(TS, `J${r}`)).toBe(isoToSerial("2026-10-30"));
    expect(w.book.formula(TS, `S${r}`)).toBeDefined();
    expect(w.book.get(CB, `B${r + 1}`)).toBe("BPN-01");
  });

  // BUG (lib/sync/layouts.ts translate, appends: `proj.colOf(colId)` is undefined for the external
  // columns gender / nipp / bmi_note, so they are silently dropped; lib/sync/merge.ts placeInSheet
  // still records them in the baseline). Repro: website adds staff BPN-01 with L/P "P", NIPP "777",
  // BMI note "program BB" -> sync 1 places the row without them -> sync 2 reads the empty Cek BMI
  // cells as "cleared in the sheet" and sets gender, nipp and bmi_note to null in the database.
  test("L/P, NIPP and BMI note of a staff member added on the website survive (written to Cek BMI)", () => {
    const w = world();
    w.db.rows("pd_staff").push(staffRow("BPN-01", 9, { gender: "P", nipp: "777", bmi_note: "program BB" }));
    w.sync();
    w.sync();
    expect(staff(w, "BPN-01")).toMatchObject({ gender: "P", nipp: "777", bmi_note: "program BB" });
    const r = w.book.findRow(CB, "B", "BPN-01");
    expect([w.book.get(CB, `F${r}`), w.book.get(CB, `G${r}`), w.book.get(CB, `AL${r}`)]).toEqual(["P", "777", "program BB"]);
  });

  test("no blank row left: written below the block with S/V formulas copied and the grid grown", () => {
    const w = world({ staffSpare: 0 });
    w.book.setRowCount(TS, 8);
    w.db.rows("pd_staff").push(staffRow("DPS-02", 9, { gender: null, nipp: null }));
    const { ops } = w.sync();
    const r = 9;
    expect(ops.grow).toMatchObject([{ tab: TS }]);
    expect(ops.formulaCopies).toMatchObject([{ tab: TS, fromRow: 5, toRow: r, cols: [18, 21] }]);
    expect(w.book.formula(TS, `S${r}`)).toBe(`=IF(Q${r}="","",IF(Q${r}>=4,"Sesuai","Tidak Sesuai → usulan ganti"))`);
    expect([w.book.get(TS, `A${r}`), w.book.get(TS, `W${r}`), w.book.get(TS, `B${r}`)]).toEqual([5, "DPS-02", "Petugas DPS-02"]);
    expectSteady(w);
  });

  test("no name = absent: clearing Nama removes the staff member; their BMI checks and Cek BMI inputs go too", () => {
    const w = world();
    const r = w.book.findRow(TS, "W", "SUB-01");
    w.book.set(TS, `B${r}`, undefined);
    const { plan } = w.sync();
    expect(tp(plan, "pd_staff").db.deletes).toEqual([{ code: "SUB-01" }]);
    expect(staff(w, "SUB-01")).toBeUndefined();
    expect(w.db.rows("pd_bmi_checks")).toEqual([]);
    // The row's other inputs are cleared, formulas and No stay; Cek BMI's inputs for it are cleared.
    expect(["C", "D", "H", "L"].map((c) => w.book.get(TS, `${c}${r}`))).toEqual(["", "", "", ""]);
    expect(w.book.get(TS, `A${r}`)).toBe(1);
    expect(w.book.formula(TS, `V${r}`)).toBeDefined();
    expect([P(1), P(1, 1), P(1, 2), "F", "G"].map((c) => w.book.get(CB, `${c}${r + 1}`))).toEqual(["", "", "", "", ""]);
    expect(w.book.formula(CB, `${P(1, 3)}${r + 1}`)).toBeDefined();
    expectSteady(w);
  });

  test("L/P, NIPP and the BMI note are read from and written to Cek BMI, on the row showing the ID SDM", () => {
    const w = world();
    const r = w.book.findRow(CB, "B", "SUB-01");
    w.book.set(CB, `F${r}`, "p");
    w.book.set(CB, `AL${r}`, "turunkan 3 kg");
    staff(w, "SUB-02").nipp = "5555";
    const { plan } = w.sync();
    expect(tp(plan, "pd_staff").db.updates).toEqual([{ key: { code: "SUB-01" }, set: { gender: "P", bmi_note: "turunkan 3 kg" } }]);
    expect(w.book.get(CB, `G${w.book.findRow(CB, "B", "SUB-02")}`)).toBe("5555");
    expectSteady(w);

    w.book.set(CB, `F${r}`, "X");
    const bad = w.sync();
    expect(tp(bad.plan, "pd_staff").issues[0]).toMatchObject({ kind: "invalid_value", rowKey: "SUB-01", column: "gender" });
    expect(w.book.note(CB, `F${r}`)).toContain("Pilihan tidak valid");
    expect(staff(w, "SUB-01").gender).toBe("P");
  });

  test("Cabang is the station's report group in the DB: a different sheet value is put back", () => {
    const w = world();
    const r = w.book.findRow(TS, "W", "SUB-01");
    w.book.set(TS, `C${r}`, "DPS");
    w.sync();
    expect(staff(w, "SUB-01").report_group).toBe("SUB");
    w.sync();
    expect(w.book.get(TS, `C${r}`)).toBe("SUB");
    expectSteady(w);
  });

  test("Stn must be a station from public.stations (any case); an unknown code is noted", () => {
    const w = world({}, { ...db(), stations: [...TEST_STATIONS, { code: "UPG", report_group: "UPG" }] });
    w.book.set(TS, "B9", "Petugas UPG");
    w.book.set(TS, "C9", "UPG");
    w.book.set(TS, "D9", "upg");
    w.book.set(TS, "B10", "Petugas JKT");
    w.book.set(TS, "D10", "JKT");
    const { plan } = w.sync();
    expect(tp(plan, "pd_staff").db.pending.map((p) => p.values.station)).toEqual(["UPG"]);
    expect(w.book.get(TS, "W9")).toBe("UPG-01");
    expect(w.book.get(TS, "W10")).toBe("");
    expect(w.book.note(TS, "D10")).toContain("tidak ada di daftar stasiun");
  });

  test('dash reads as empty in number/date cells ("–" in Praktik awal); "–" in a text column is text', () => {
    const w = world();
    const r = w.book.findRow(TS, "W", "KNO-01");
    expect([w.book.get(TS, `H${r}`), w.book.get(TS, `M${r}`)]).toEqual(["–", "–"]);
    expect(staff(w, "KNO-01")).toMatchObject({ initial_practice: null, extra_action: "–" });
    w.book.set(TS, `N${r}`, "-");
    w.book.set(TS, `Q${r}`, "—");
    expectSteady(w);

    w.book.set(TS, `H${r}`, "3,5");
    w.sync();
    expect(staff(w, "KNO-01").initial_practice).toBe(3.5);
    staff(w, "KNO-01").initial_practice = null;
    w.sync();
    expect(w.book.get(TS, `H${r}`)).toBe("");
    expectSteady(w);
  });

  test("renamed header in row 4: Tracker Staf is not synced at all, other tabs continue", () => {
    const w = world();
    w.book.set(TS, "B4", "Nama Lengkap");
    staff(w, "SUB-01").name = "Nama Web";
    w.book.set(RA, `G${w.book.findRow(RA, "N", 1)}`, "PIC Baru");
    const { plan, ops } = w.sync();
    expect(tp(plan, "pd_staff").error).toContain('"Nama"');
    expect(ops.writes.some((x) => x.tab === TS)).toBe(false);
    expect(w.db.find("pd_action_plans", { id: 1 })!.pic).toBe("PIC Baru");
  });
});

// ------------------------------------------------------------------ Cek BMI

describe("Cek BMI (wide in the sheet, long in the DB; data from row 6)", () => {
  test("period columns map to (staff, period) rows both ways", () => {
    const w = world();
    const sub02 = w.book.findRow(CB, "B", "SUB-02");
    w.book.set(CB, `${P(2)}${sub02}`, "26/10/2026");
    w.book.set(CB, `${P(2, 1)}${sub02}`, 165);
    w.book.set(CB, `${P(2, 2)}${sub02}`, "60,5");
    w.db.rows("pd_bmi_checks").push(bmiRow(7, "DPS-01", 3, { check_date: "2026-11-09", height_cm: 158.5, weight_kg: 52 }));
    const { plan } = w.sync();
    expect(tp(plan, "pd_bmi_checks").db.inserts).toEqual([
      { staff_code: "SUB-02", period: 2, check_date: "2026-10-26", height_cm: 165, weight_kg: 60.5 },
    ]);
    const dps = w.book.findRow(CB, "B", "DPS-01");
    expect([w.book.get(CB, `${P(3)}${dps}`), w.book.get(CB, `${P(3, 1)}${dps}`), w.book.get(CB, `${P(3, 2)}${dps}`)]).toEqual([isoToSerial("2026-11-09"), 158.5, 52]);
    expect(w.book.formula(CB, `${P(3, 3)}${dps}`)).toBeDefined();
    expectSteady(w);
  });

  test("a date without height and weight is noted, not saved", () => {
    const w = world();
    const r = w.book.findRow(CB, "B", "SUB-01");
    w.book.set(CB, `${P(4)}${r}`, isoToSerial("2026-11-23"));
    const { plan } = w.sync();
    expect(tp(plan, "pd_bmi_checks").db.inserts).toEqual([]);
    expect(tp(plan, "pd_bmi_checks").issues[0]).toMatchObject({ kind: "incomplete_row", rowKey: "SUB-01|4" });
    expect(w.book.note(CB, `${P(4, 1)}${r}`)).toContain("Baris belum lengkap");
    expectSteady(w);
  });

  test('clearing height and weight (or typing "–") deletes that check; its date is cleared with it', () => {
    const w = world();
    const r = w.book.findRow(CB, "B", "SUB-01");
    w.book.set(CB, `${P(1, 1)}${r}`, undefined);
    w.book.set(CB, `${P(1, 2)}${r}`, "–");
    const { plan } = w.sync();
    expect(tp(plan, "pd_bmi_checks").db.deletes).toEqual([{ staff_code: "SUB-01", period: 1 }]);
    expect(w.db.rows("pd_bmi_checks")).toEqual([]);
    // The date is cleared; the "–" typed as weight already reads as empty and is left as typed.
    expect([w.book.get(CB, `${P(1)}${r}`), w.book.get(CB, `${P(1, 2)}${r}`)]).toEqual(["", "–"]);
    expect(w.book.formula(CB, `${P(1, 3)}${r}`)).toBeDefined();
    expectSteady(w);
  });

  test("an out-of-range height is noted and the DB keeps its value", () => {
    const w = world();
    const r = w.book.findRow(CB, "B", "SUB-01");
    w.book.set(CB, `${P(1, 1)}${r}`, 300);
    const { plan } = w.sync();
    expect(tp(plan, "pd_bmi_checks").db.updates).toEqual([]);
    expect(w.book.note(CB, `${P(1, 1)}${r}`)).toContain("Di luar rentang 120–210");
    expect(w.db.find("pd_bmi_checks", { staff_code: "SUB-01", period: 1 })!.height_cm).toBe(170);
    expectSteady(w);
  });

  test("a DB check for a period the sheet has no columns for is reported, never placed", () => {
    const w = world();
    w.db.rows("pd_bmi_checks").push(bmiRow(8, "SUB-01", 6));
    const { plan, ops } = w.sync();
    expect(tp(plan, "pd_bmi_checks").issues[0]).toMatchObject({ kind: "no_sheet_row", rowKey: "SUB-01|6", isNew: true });
    expect(ops.writes.filter((x) => x.tab === CB)).toEqual([]);
    expect(tp(w.sync().plan, "pd_bmi_checks").issues[0].isNew).toBe(false);
  });
});

// ------------------------------------------------------------------ Parameter BMI

describe("Parameter BMI (label in B, value in C)", () => {
  test("a value edited in C syncs; the TODAY() row is never touched; DB edits are written back", () => {
    const w = world();
    const r = w.book.findRow(PB, "B", "Jumlah periode cek BMI");
    w.book.set(PB, `C${r}`, 6);
    const { ops } = w.sync();
    expect(w.db.rows("pd_settings")[0].bmi_periods).toBe(6);
    expect(ops.writes.some((x) => x.tab === PB)).toBe(false);
    expect(w.book.formula(PB, `C${w.book.findRow(PB, "B", "Tanggal acuan (hari ini)")}`)).toBe("=TODAY()");
    w.db.rows("pd_settings")[0].bmi_interval_days = 7;
    w.db.rows("pd_settings")[0].bmi_first_check = "2026-10-19";
    w.sync();
    expect(w.book.get(PB, `C${w.book.findRow(PB, "B", "Interval cek BMI (hari)")}`)).toBe(7);
    expect(w.book.get(PB, "C5")).toBe(isoToSerial("2026-10-19"));
    expectSteady(w);
  });

  test("thresholds out of order are rejected with a note", () => {
    const w = world();
    const r = w.book.findRow(PB, "B", "BMI Normal s.d.");
    w.book.set(PB, `C${r}`, 30);
    const { plan } = w.sync();
    expect(tp(plan, "pd_settings").db.updates).toEqual([]);
    expect(w.book.note(PB, `C${r}`)).toContain("berurutan");
    expectSteady(w);
  });

  test("a renamed label is reported and its value left alone", () => {
    const w = world();
    w.book.set(PB, `B${w.book.findRow(PB, "B", "Tinggi minimal petugas Perempuan (cm)")}`, "Tinggi min P");
    w.db.rows("pd_settings")[0].min_height_female = 155;
    const { plan, ops } = w.sync();
    expect(tp(plan, "pd_settings").issues[0]).toMatchObject({ kind: "no_sheet_row", rowKey: "min_height_female" });
    expect(ops.writes.some((x) => x.tab === PB)).toBe(false);
    expect(w.db.rows("pd_settings")[0].min_height_female).toBe(155);
  });
});

// ------------------------------------------------------------------ Penggantian SDM

describe("Penggantian SDM (pre-numbered slots, S = ID Sistem hidden, T = ID SDM)", () => {
  test("a replacement typed into a free slot row is inserted and its ID Sistem written back", () => {
    const w = world();
    w.book.set(PG, "B6", "Orang Baru");
    w.book.set(PG, "C6", "kno");
    w.book.set(PG, "D6", "Strong reminder");
    const { plan } = w.sync();
    expect(tp(plan, "pd_replacements").db.pending).toMatchObject([{ ref: 1, values: { name: "Orang Baru", report_group: "KNO", category: "Strong reminder" } }]);
    expect(w.book.get(PG, "S6")).toBe(2);
    expect(w.baseline!.tables.pd_replacements!["2"]).toMatchObject({ id: 2, name: "Orang Baru" });
    expectSteady(w);
  });

  test("linking a staff member in T: the DB copies their Nama and Cabang, which come back to the sheet", () => {
    const w = world();
    w.book.set(PG, "T5", "SUB-02");
    w.sync();
    expect(w.db.find("pd_replacements", { id: 1 })).toMatchObject({ staff_code: "SUB-02", name: "Petugas SUB-02", report_group: "SUB" });
    w.sync();
    expect(w.book.get(PG, "B5")).toBe("Petugas SUB-02");
    expectSteady(w);
  });

  test("a replacement added on the website fills the first free slot (No kept, id and ID SDM written)", () => {
    const w = world();
    w.db.rows("pd_replacements").push(replacementRow(5, { report_group: "DPS", staff_code: "DPS-01", name: "Petugas DPS-01" }));
    w.sync();
    expect(["A6", "B6", "C6", "S6", "T6"].map((a) => w.book.get(PG, a))).toEqual([2, "Petugas DPS-01", "DPS", 5, "DPS-01"]);
    expectSteady(w);
  });

  test("deleted on the website: the slot is cleared (No and formulas stay) and reusable", () => {
    const w = world();
    w.db.remove("pd_replacements", () => true);
    w.sync();
    expect(["A5", "B5", "S5"].map((a) => w.book.get(PG, a))).toEqual([1, "", ""]);
    expect(w.book.formula(PG, "N5")).toBeDefined();
    w.db.rows("pd_replacements").push(replacementRow(9));
    w.sync();
    expect([w.book.get(PG, "B5"), w.book.get(PG, "S5")]).toEqual(["Diganti 9", 9]);
    expectSteady(w);
  });

  test("all slots used: extends below with the next No and the N/R formulas", () => {
    const w = world({ replacementSlots: 1 });
    w.db.rows("pd_replacements").push(replacementRow(2, { report_group: "KNO" }));
    const { ops } = w.sync();
    expect(["A6", "B6", "S6"].map((a) => w.book.get(PG, a))).toEqual([2, "Diganti 2", 2]);
    expect(ops.formulaCopies).toMatchObject([{ tab: PG, fromRow: 5, toRow: 6, cols: [13, 17] }]);
    expect(w.book.formula(PG, "N6")).toBe('=IF(OR(L6="",M6=""),"",IF(AND(L6>=80,M6>=4),"Lulus","Belum lulus"))');
    expectSteady(w);
  });

  test("ID SDM must exist in Tracker Staf; deleting that staff member clears it", () => {
    const w = world();
    w.book.set(PG, "T5", "XXX-01");
    const { plan } = w.sync();
    expect(tp(plan, "pd_replacements").issues[0]).toMatchObject({ kind: "unknown_parent", column: "staff_code" });
    expect(w.book.note(PG, "T5")).toContain("tidak ada di Tracker Staf");

    w.book.set(PG, "T5", "DPS-01");
    w.sync();
    w.sync();
    expect(w.book.note(PG, "T5")).toBeUndefined();
    expectSteady(w);
    w.book.set(TS, `B${w.book.findRow(TS, "W", "DPS-01")}`, undefined);
    w.sync();
    expect(w.db.find("pd_replacements", { id: 1 })!.staff_code).toBeNull();
    expect(w.book.get(PG, "T5")).toBe("");
    expectSteady(w);
  });
});

// ------------------------------------------------------------------ Rencana Aksi

describe("Rencana Aksi (No as data, % as fraction, areas, archive)", () => {
  test("PERCENT transform: fraction in the sheet, 0..100 in the DB", () => {
    expect(PERCENT.read(0.5)).toBe(50);
    expect(PERCENT.read(0.29)).toBe(29);
    expect(PERCENT.read(1)).toBe(100);
    expect(PERCENT.read("75%")).toBe(75);
    expect(PERCENT.read("0,25")).toBe(25);
    expect(PERCENT.read(50)).toBe(5000);
    expect(PERCENT.read("")).toBe("");
    expect(PERCENT.write(75)).toBe(0.75);
    expect(PERCENT.write(null)).toBe("");
  });

  test("% Progres syncs scaled both ways; 50 typed into a % cell (5000%) is rejected", () => {
    const w = world();
    const r1 = w.book.findRow(RA, "N", 1);
    const r2 = w.book.findRow(RA, "N", 2);
    w.book.set(RA, `I${r1}`, 0.5);
    w.db.find("pd_action_plans", { id: 2 })!.progress = 75;
    w.sync();
    expect(w.db.find("pd_action_plans", { id: 1 })!.progress).toBe(50);
    expect(w.book.get(RA, `I${r2}`)).toBe(0.75);
    expectSteady(w);

    w.book.set(RA, `I${r1}`, 50);
    const { plan } = w.sync();
    expect(tp(plan, "pd_action_plans").db.updates).toEqual([]);
    expect(w.book.note(RA, `I${r1}`)).toContain("Di luar rentang 0–100");
  });

  test('No is a text data column ("1", "6a"), not a running number', () => {
    const w = world();
    const r2 = w.book.findRow(RA, "N", 2);
    expect([w.book.get(RA, "A5"), w.book.get(RA, `A${r2}`)]).toEqual([1, "6a"]);
    w.book.set(RA, `A${r2}`, "6b");
    w.db.find("pd_action_plans", { id: 1 })!.item_no = "1a";
    w.sync();
    expect(w.db.find("pd_action_plans", { id: 2 })!.item_no).toBe("6b");
    expect(w.book.get(RA, "A5")).toBe("1a");
    expectSteady(w);
  });

  test("Area must be a pd_areas name: any case is accepted and stored as the DB spells it", () => {
    const w = world();
    const r1 = w.book.findRow(RA, "N", 1);
    const r2 = w.book.findRow(RA, "N", 2);
    w.book.set(RA, `B${r1}`, "  bahasa INGGRIS & reservasi ");
    w.book.set(RA, `B${r2}`, "Lainnya");
    const { plan } = w.sync();
    expect(tp(plan, "pd_action_plans").db.updates).toEqual([{ key: { id: 1 }, set: { area: "Bahasa Inggris & reservasi" } }]);
    expect(tp(plan, "pd_action_plans").issues).toMatchObject([{ kind: "invalid_value", rowKey: "2", column: "area" }]);
    expect(w.book.note(RA, `B${r2}`)).toContain('Area "Lainnya" tidak ada di daftar area');
    expect(w.db.find("pd_action_plans", { id: 2 })!.area).toBe("BMI");
    w.book.set(RA, `B${r2}`, "bmi");
    w.sync();
    expect(w.book.note(RA, `B${r2}`)).toBeUndefined();
    expectSteady(w);
  });

  test("a plan typed into a blank row is inserted: Status and % get their defaults and the id is written", () => {
    const w = world();
    const r = 7; // first blank row (2 plans in rows 5..6)
    w.book.set(RA, `A${r}`, "7");
    w.book.set(RA, `B${r}`, "grooming");
    w.book.set(RA, `C${r}`, "Cek seragam");
    w.book.set(RA, `D${r}`, "cgk & hlp");
    const { plan } = w.sync();
    expect(tp(plan, "pd_action_plans").db.pending).toMatchObject([
      { values: { item_no: "7", area: "Grooming", action: "Cek seragam", report_group: "CGK & HLP", status: "Belum Mulai", progress: 0 } },
    ]);
    expect([w.book.get(RA, `H${r}`), w.book.get(RA, `I${r}`), w.book.get(RA, `N${r}`)]).toEqual(["Belum Mulai", 0, 3]);
    expectSteady(w);
  });

  test("a plan from the website fills the first blank row; when none is left it goes below with the Flag formula", () => {
    const w = world({ planSpare: 1 });
    w.db.rows("pd_action_plans").push(planRow(3, { item_no: "3", progress: 40 }), planRow(4, { item_no: "4", report_group: "BPN" }));
    w.book.setRowCount(RA, 7);
    const { ops } = w.sync();
    expect(["A7", "C7", "I7", "N7"].map((a) => w.book.get(RA, a))).toEqual(["3", "Tindakan 3", 0.4, 3]);
    expect(["A8", "D8", "N8"].map((a) => w.book.get(RA, a))).toEqual(["4", "BPN", 4]);
    expect(ops.formulaCopies).toMatchObject([{ tab: RA, fromRow: 5, toRow: 8, cols: [12] }]);
    expect(w.book.formula(RA, "M8")).toContain("C8");
    expect(ops.grow).toMatchObject([{ tab: RA }]);
    expectSteady(w);
  });

  test("archived on the website: the sheet row is cleared (inputs and ID Sistem; Flag stays)", () => {
    const w = world();
    const r = w.book.findRow(RA, "N", 2);
    w.db.find("pd_action_plans", { id: 2 })!.archived_at = "2026-10-20T08:00:00Z";
    const { plan } = w.sync();
    expect(tp(plan, "pd_action_plans").db).toEqual({ inserts: [], updates: [], deletes: [], pending: [] });
    expect(["A", "B", "C", "D", "H", "I", "N"].map((c) => w.book.get(RA, `${c}${r}`))).toEqual(["", "", "", "", "", "", ""]);
    expect(w.book.formula(RA, `M${r}`)).toBeDefined();
    expect(w.db.find("pd_action_plans", { id: 2 })!.archived_at).toBe("2026-10-20T08:00:00Z");
    expectSteady(w);

    // Restored on the website: it comes back into the first blank row.
    w.db.find("pd_action_plans", { id: 2 })!.archived_at = null;
    w.sync();
    expect(w.book.get(RA, `N${r}`)).toBe(2);
    expect(w.book.get(RA, `A${r}`)).toBe("6a");
    expectSteady(w);
  });

  test("a row cleared in the sheet is archived in the store, never deleted", () => {
    const w = world();
    const r = w.book.findRow(RA, "N", 1);
    for (const c of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) w.book.set(RA, `${c}${r}`, undefined);
    const { plan } = w.sync();
    expect(tp(plan, "pd_action_plans").db.deletes).toEqual([{ id: 1 }]);
    expect(w.db.rows("pd_action_plans")).toHaveLength(2);
    expect(w.db.find("pd_action_plans", { id: 1 })!.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(w.db.snapshot().pd_action_plans!.map((p) => p.id)).toEqual([2]);
    expectSteady(w);
  });
});

// ------------------------------------------------------------------ Laporan Bulanan

describe("Laporan Bulanan (Periode as \"Okt 2026\", key Cabang + Periode)", () => {
  test("PERIOD transform: month text in the sheet, first day of the month in the DB", () => {
    expect(PERIOD.read("Okt 2026")).toBe("2026-10-01");
    expect(PERIOD.read(" oktober 2026 ")).toBe("2026-10-01");
    expect(PERIOD.read("Des-2026")).toBe("2026-12-01");
    expect(PERIOD.read("10/2026")).toBe("2026-10-01");
    expect(PERIOD.read("2026-10-15")).toBe("2026-10-01");
    expect(PERIOD.read(isoToSerial("2026-10-19"))).toBe("2026-10-01");
    expect(PERIOD.read("bulan depan")).toBe("bulan depan");
    expect(PERIOD.read("")).toBe("");
    expect(PERIOD.write("2026-10-01")).toBe("Okt 2026");
    expect(PERIOD.write("2027-05-01")).toBe("Mei 2027");
    expect(PERIOD.write(null)).toBe("");
  });

  test("a report from the website lands in the first blank row with its Periode as text", () => {
    const w = world();
    w.db.rows("pd_monthly_reports").push(monthlyRow("DPS", "2026-11-01", { received_on: "2026-12-03" }));
    const { ops } = w.sync();
    expect(["A7", "B7", "C7", "D7", "F7"].map((a) => w.book.get(LB, a))).toEqual(["DPS", "Nov 2026", isoToSerial("2026-11-05"), isoToSerial("2026-12-03"), 10]);
    expect(ops.writes.some((x) => x.tab === LB && [4, 7, 8].includes(x.col))).toBe(false);
    expectSteady(w);
  });

  test("key-only rows prepared for a month are slots: filling one inserts, a DB report fills its own row", () => {
    const w = world({ monthlySlots: ["2026-11-01"] });
    const kno = w.book.findRow(LB, "A", "KNO", 7);
    const bpn = w.book.findRow(LB, "A", "BPN", 7);
    expect(w.book.get(LB, `B${kno}`)).toBe("Nov 2026");
    w.book.set(LB, `F${kno}`, 12);
    w.book.set(LB, `G${kno}`, 11);
    w.db.rows("pd_monthly_reports").push(monthlyRow("BPN", "2026-11-01", { complaints: 2 }));
    const { plan } = w.sync();
    expect(tp(plan, "pd_monthly_reports").db.inserts).toEqual([
      { report_group: "KNO", period: "2026-11-01", due_on: null, received_on: null, active_staff: 12, compliant_staff: 11, complaints: null, responded: null, satisfaction: null, notes: null },
    ]);
    expect(tp(plan, "pd_monthly_reports").sheet.appends).toEqual([]);
    expect([w.book.get(LB, `J${bpn}`), w.book.get(LB, `L${bpn}`)]).toEqual([2, 4.5]);
    expectSteady(w);
  });

  test('a new row typed with "dps" / "Nov 2026" is inserted under the canonical key; unknown Cabang is rejected', () => {
    const w = world();
    w.book.set(LB, "A7", "dps");
    w.book.set(LB, "B7", "Nov 2026");
    w.book.set(LB, "J7", "–");
    w.book.set(LB, "K7", "ya");
    w.book.set(LB, "A8", "JKT");
    w.book.set(LB, "B8", "Nov 2026");
    w.book.set(LB, "F8", 4);
    const { plan } = w.sync();
    expect(tp(plan, "pd_monthly_reports").db.inserts).toMatchObject([{ report_group: "DPS", period: "2026-11-01", complaints: null, responded: "Ya" }]);
    expect(tp(plan, "pd_monthly_reports").issues).toMatchObject([{ kind: "invalid_value", column: "report_group" }]);
    expect(w.book.note(LB, "A8")).toContain('Cabang "JKT" tidak dikenal');
  });

  test("edits both ways; Periode typed as a date or as month text stays the same key", () => {
    const w = world();
    w.book.set(LB, "D5", "03/11/2026");
    w.book.set(LB, "B5", "Oktober 2026");
    w.db.find("pd_monthly_reports", { report_group: "SUB", period: "2026-10-01" })!.satisfaction = 4.25;
    const { plan } = w.sync();
    const t = tp(plan, "pd_monthly_reports");
    expect(t.db.updates).toEqual([{ key: { report_group: "CGK & HLP", period: "2026-10-01" }, set: { received_on: "2026-11-03" } }]);
    expect(w.book.get(LB, "L6")).toBe(4.25);
    expectSteady(w);
  });

  test("deleted on the website: inputs cleared, Cabang and Periode kept; deleted in the sheet: DB row deleted", () => {
    const w = world();
    w.db.remove("pd_monthly_reports", (r) => r.report_group === "SUB");
    w.sync();
    expect(["A6", "B6", "C6", "F6", "K6"].map((a) => w.book.get(LB, a))).toEqual(["SUB", "Okt 2026", "", "", ""]);
    expect(w.book.formula(LB, "E6")).toBeDefined();
    expectSteady(w);

    for (const c of ["C", "F", "G", "J", "K", "L", "M"]) w.book.set(LB, `${c}5`, undefined);
    const { plan } = w.sync();
    expect(tp(plan, "pd_monthly_reports").db.deletes).toEqual([{ report_group: "CGK & HLP", period: "2026-10-01" }]);
    expect(w.db.rows("pd_monthly_reports")).toEqual([]);
    expectSteady(w);
  });
});

// ------------------------------------------------------------------ idempotence

describe("idempotence", () => {
  test("a mixed sequence across every tab settles after each run", () => {
    const w = world({ monthlySlots: ["2026-11-01"] });
    const steps: ((w: WorkbookWorld) => void)[] = [
      (w) => w.book.set(TS, `U${w.book.findRow(TS, "W", "SUB-01")}`, "catatan sheet"),
      (w) => (staff(w, "SUB-02").pic = "Koordinator"),
      (w) => w.book.set(CB, `${P(2, 1)}${w.book.findRow(CB, "B", "DPS-01")}`, 160),
      (w) => w.book.set(CB, `${P(2, 2)}${w.book.findRow(CB, "B", "DPS-01")}`, 55),
      (w) => w.db.rows("pd_bmi_checks").push(bmiRow(20, "SUB-02", 3)),
      (w) => (w.db.find("pd_action_plans", { id: 1 })!.status = "Selesai"),
      (w) => w.book.set(RA, "I6", 0.3),
      (w) => w.db.rows("pd_action_plans").push(planRow(3, { area: "Training susulan" })),
      (w) => w.book.set(PG, "L5", 85),
      (w) => w.db.rows("pd_replacements").push(replacementRow(4, { report_group: "DPS" })),
      (w) => w.book.set(LB, `F${w.book.findRow(LB, "A", "DPS", 7)}`, 8),
      (w) => w.book.set(PB, "C6", 21),
      (w) => {
        staff(w, "SUB-01").name = "Nama Web";
        w.book.set(TS, `B${w.book.findRow(TS, "W", "SUB-01")}`, "Nama Sheet");
      },
    ];
    for (const step of steps) {
      step(w);
      w.sync();
      expectSteady(w);
    }
    expect(staff(w, "SUB-01")).toMatchObject({ name: "Nama Web", progress_notes: "catatan sheet" });
    expect(w.db.find("pd_bmi_checks", { staff_code: "DPS-01", period: 2 })).toMatchObject({ height_cm: 160, weight_kg: 55 });
    expect(w.db.find("pd_action_plans", { id: 2 })!.progress).toBe(30);
    expect(w.db.find("pd_monthly_reports", { report_group: "DPS", period: "2026-11-01" })!.active_staff).toBe(8);
    expect(w.db.rows("pd_settings")[0].bmi_interval_days).toBe(21);
  });
});
