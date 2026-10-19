import { describe, expect, test } from "bun:test";
import { projectAll, type RealOps } from "../layouts";
import { isPlanEmpty, merge } from "../merge";
import { parsePolicy, runSync } from "../run";
import type { SheetsPort } from "../sheets";
import type { DbApplyResult, SyncLogEntry, SyncStore } from "../supabase";
import { FakeDb } from "../testing/fakes";
import { smallDb } from "../testing/fixtures";
import { FakeWorkbook, TABS, buildWorkbook } from "../testing/workbook";
import type { Baseline, Plan, SyncTable } from "../types";

class FakeStore implements SyncStore {
  lease: string | null = null;
  baseline: Baseline | null = null;
  lastError: string | null = null;
  logs: SyncLogEntry[] = [];
  failTables = new Set<SyncTable>();
  claims = 0;
  constructor(public db: FakeDb) {}
  async claimLease() {
    this.claims++;
    if (this.lease) return null;
    this.lease = `lease-${this.claims}`;
    return this.lease;
  }
  async releaseLease(token: string, baseline: Baseline | null, error: string | null) {
    if (token !== this.lease) return false;
    this.lease = null;
    if (baseline) this.baseline = JSON.parse(JSON.stringify(baseline));
    this.lastError = error;
    return true;
  }
  async readBaseline() {
    return this.baseline;
  }
  async readAll() {
    return this.db.snapshot();
  }
  async apply(plan: Plan): Promise<DbApplyResult> {
    const failed = new Map<SyncTable, string>();
    const ok: Plan = { ...plan, tables: plan.tables.filter((t) => !this.failTables.has(t.table)) };
    for (const t of this.failTables) failed.set(t, "23514: check violation");
    return { ids: this.db.apply(ok), failed };
  }
  async log(entries: SyncLogEntry[]) {
    this.logs.push(...entries);
  }
}

class WorkbookPort implements SheetsPort {
  failApply = false;
  constructor(public book: FakeWorkbook) {}
  async read() {
    return this.book.snapshot();
  }
  async apply(ops: RealOps, ids: Map<number, number | string>, opts: { skipTables?: Set<string> } = {}) {
    if (this.failApply) throw new Error("Google Sheets POST failed (403 PERMISSION_DENIED)");
    this.book.apply(ops, ids, opts.skipTables);
  }
}

function setup() {
  const data = smallDb();
  const db = new FakeDb(data);
  const book = buildWorkbook(data);
  const store = new FakeStore(db);
  const sheets = new WorkbookPort(book);
  const deps = { store, sheets };
  const steady = () => isPlanEmpty(merge({ baseline: store.baseline, sheet: projectAll(book.snapshot()).sheet, db: db.snapshot() }));
  /**
   * The first two runs on the imported workbook, logs cleared. Two, because without ID SDM in W the
   * first run cannot see Cek BMI yet (the import fills W; this fixture does not).
   */
  const settle = async () => {
    await runSync(deps);
    await runSync(deps);
    store.logs.length = 0;
  };
  return { db, book, store, sheets, deps, steady, settle };
}

const TS = TABS.staff;
const RA = TABS.plans;

describe("runSync", () => {
  test("first run on the imported workbook: only setup, baseline stored, lease released", async () => {
    const { store, book, deps, steady } = setup();
    const s = await runSync(deps);
    expect(s.status).toBe("ok");
    expect(s.policy).toBe("db-wins");
    expect(Object.values(s.tables!).every((t) => t.dbInserts + t.dbUpdates + t.dbDeletes === 0)).toBe(true);
    expect(s.sheet).toMatchObject({ createTabs: [], headerCells: 4, cellWrites: 6, setLocale: true });
    expect(store.lease).toBeNull();
    expect(store.lastError).toBeNull();
    expect(store.baseline!.tables.pd_staff!["SUB-01"]).toBeDefined();
    expect(book.get(TS, "W5")).toBe("SUB-01");
    expect(book.get("Penggantian SDM", "S5")).toBe(1);
    expect(steady()).toBe(true);
    const again = await runSync(deps);
    expect(again.status).toBe("ok");
    expect(again.sheet).toMatchObject({ cellWrites: 0, headerCells: 0, createTabs: [], setLocale: false });
  });

  // scripts/v2-import.ts writes ID SDM (Tracker Staf W) before the first sync, so Cek BMI is visible.
  test("first run after the import (ID SDM in W) logs nothing", async () => {
    const { store, book, db, deps } = setup();
    book.set(TS, "W4", "ID SDM");
    for (const st of db.snapshot().pd_staff!) book.set(TS, `W${book.findRow(TS, "B", st.name)}`, st.code);
    book.recalc();
    await runSync(deps);
    expect(store.logs).toEqual([]);
  });

  test("busy when another run holds the lease; nothing read or written", async () => {
    const { store, book, deps } = setup();
    store.lease = "someone-else";
    const s = await runSync(deps);
    expect(s.status).toBe("busy");
    expect(book.written.size).toBe(0);
  });

  test("dry run: no lease, no writes on either side, counts and planned setup returned", async () => {
    const { store, book, db, deps } = setup();
    const before = JSON.stringify(db.snapshot());
    const s = await runSync(deps, { dryRun: true });
    expect(s.status).toBe("dry-run");
    expect(s.tables!.pd_staff).toMatchObject({ dbInserts: 0, sheetCellUpdates: 3, createTab: false });
    expect(s.sheet).toMatchObject({ createTabs: [], headerCells: 4, cellWrites: 6, tabsWritten: [TS, "Penggantian SDM", RA], setLocale: true });
    expect(store.claims).toBe(0);
    expect(store.baseline).toBeNull();
    expect(book.written.size).toBe(0);
    expect(book.locale).toBe("en_US");
    expect(JSON.stringify(db.snapshot())).toBe(before);
  });

  test("conflicts are logged with the policy as resolution (db-wins by default)", async () => {
    const { store, book, db, deps, settle } = setup();
    await settle();
    const r = book.findRow(TS, "W", "SUB-01");
    db.find("pd_staff", { code: "SUB-01" })!.initial_practice = 5;
    book.set(TS, `H${r}`, 2);
    await runSync(deps);
    expect(store.logs).toEqual([
      { table_name: "pd_staff", row_key: "SUB-01", column_name: "initial_practice", baseline: 3, sheet_value: 2, db_value: 5, resolution: "db-wins" },
    ]);
    expect(book.get(TS, `H${r}`)).toBe(5);
    db.find("pd_staff", { code: "SUB-01" })!.pic = "Web";
    book.set(TS, `K${r}`, "Sheet");
    await runSync(deps, { conflictPolicy: "sheet-wins" });
    expect(store.logs[1]).toMatchObject({ column_name: "pic", resolution: "sheet-wins", sheet_value: "Sheet", db_value: "Web" });
    expect(db.find("pd_staff", { code: "SUB-01" })!.pic).toBe("Sheet");
  });

  test("validation problems are logged once with a rejected:<kind> resolution", async () => {
    const { store, book, deps, settle } = setup();
    await settle();
    book.set(TS, `H${book.findRow(TS, "W", "SUB-01")}`, 7);
    await runSync(deps);
    await runSync(deps);
    expect(store.logs).toEqual([
      { table_name: "pd_staff", row_key: "SUB-01", column_name: "initial_practice", baseline: null, sheet_value: 7, db_value: 3, resolution: "rejected:invalid_value" },
    ]);
  });

  test("sheet write failure: error recorded, baseline kept, sheet-wins conflict already logged, next run converges", async () => {
    const { store, book, db, sheets, deps, steady, settle } = setup();
    await settle();
    const baseline = JSON.stringify(store.baseline);
    const r = book.findRow(TS, "W", "SUB-02");
    db.find("pd_staff", { code: "SUB-02" })!.progress_notes = "web";
    book.set(TS, `U${r}`, "sheet");
    sheets.failApply = true;
    const s = await runSync(deps, { conflictPolicy: "sheet-wins" });
    expect(s.status).toBe("error");
    expect(s.errors![0]).toContain("403");
    expect(store.lastError).toContain("403");
    expect(store.lease).toBeNull();
    expect(JSON.stringify(store.baseline)).toBe(baseline);
    expect(db.find("pd_staff", { code: "SUB-02" })!.progress_notes).toBe("sheet");
    expect(store.logs.map((l) => l.resolution)).toEqual(["sheet-wins"]);

    sheets.failApply = false;
    expect((await runSync(deps)).status).toBe("ok");
    expect(store.logs).toHaveLength(1);
    expect(steady()).toBe(true);
  });

  test("one table's DB failure: that table is skipped (sheet + baseline), others sync, status partial", async () => {
    const { store, book, db, deps, steady, settle } = setup();
    await settle();
    const ra = book.findRow(RA, "N", 1);
    book.set(RA, `G${ra}`, "Baru");
    book.set(TS, `U${book.findRow(TS, "W", "SUB-01")}`, "ok");
    db.find("pd_action_plans", { id: 1 })!.evidence = "bukti";
    store.failTables.add("pd_action_plans");
    const s = await runSync(deps);
    expect(s.status).toBe("partial");
    expect(s.tables!.pd_action_plans.dbFailed).toBe(true);
    expect(store.lastError).toContain("DB pd_action_plans: 23514");
    expect(db.find("pd_staff", { code: "SUB-01" })!.progress_notes).toBe("ok");
    expect(book.get(RA, `K${ra}`)).toBe("");
    expect(store.baseline!.tables.pd_action_plans!["1"].pic).toBe("Supervisor");

    store.failTables.clear();
    expect((await runSync(deps)).status).toBe("ok");
    expect(db.find("pd_action_plans", { id: 1 })!.pic).toBe("Baru");
    expect(book.get(RA, `K${ra}`)).toBe("bukti");
    expect(steady()).toBe(true);
  });

  test("a person typed into Tracker Staf gets the DB's code written back; a cleared plan is archived", async () => {
    const { book, db, deps, steady, settle } = setup();
    await settle();
    book.set(TS, "B8", "Petugas Baru");
    book.set(TS, "C8", "DPS");
    book.set(TS, "D8", "DPS");
    const ra = book.findRow(RA, "N", 2);
    for (const c of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) book.set(RA, `${c}${ra}`, undefined);
    const s = await runSync(deps);
    expect(s.tables!.pd_staff).toMatchObject({ dbInserts: 1, sheetCellUpdates: 1 });
    expect(s.tables!.pd_action_plans).toMatchObject({ dbDeletes: 1 });
    expect(book.get(TS, "W8")).toBe("DPS-02");
    expect(db.find("pd_staff", { code: "DPS-02" })!.name).toBe("Petugas Baru");
    expect(db.find("pd_action_plans", { id: 2 })!.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(steady()).toBe(true);
  });

  test("header error makes the run partial and names the tab", async () => {
    const { store, book, deps, settle } = setup();
    await settle();
    book.set(TS, "B4", "Nama Lengkap");
    const s = await runSync(deps);
    expect(s.status).toBe("partial");
    expect(s.tables!.pd_staff.error).toBe(true);
    expect(store.lastError).toContain('Tab "Tracker Staf"');
  });

  test("parsePolicy defaults to db-wins", () => {
    expect(parsePolicy(undefined)).toBe("db-wins");
    expect(parsePolicy("nonsense")).toBe("db-wins");
    expect(parsePolicy("sheet-wins")).toBe("sheet-wins");
  });
});
