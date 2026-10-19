/**
 * In-memory Sheet and DB that apply a Plan with the same semantics as the real adapters
 * (dates come back as serials, cleared cells as "", rows deleted bottom-up, FK cascade, archive on
 * delete, generated ids and staff codes).
 * Used by unit tests and by the local Supabase integration test as the "mocked sheet".
 */
import { finalizeBaseline, merge, type MergeInput } from "../merge";
import { isoToSerial } from "../normalize";
import { TEST_AREAS, TEST_STATIONS } from "./fixtures";
import { SYNC_TABLES, rowOneSpecs, specFor } from "../tables";
import type { Baseline, Canon, CellFormat, DbSnapshot, Plan, SheetSnapshot, SyncTable, TableSpec } from "../types";

export function encodeCell(value: Canon, fmt: CellFormat): unknown {
  if (value === null) return "";
  if (fmt === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return isoToSerial(value);
  return value;
}

interface FakeTab {
  sheetId: number;
  values: unknown[][];
  notes: Map<string, string>;
}

export class FakeSheet {
  tabs = new Map<string, FakeTab>();
  locale = "in_ID";
  private nextId = 100;

  addTab(title: string, values: unknown[][] = []) {
    this.tabs.set(title, { sheetId: this.nextId++, values: values.map((r) => [...r]), notes: new Map() });
  }

  /** Mark a cell as holding a formula (never read as input, never written). */
  lock(title: string, row: number, header: string) {
    const t = this.tabs.get(title)!;
    const col = t.values[0].findIndex((h) => h === header);
    if (!this.locks.has(title)) this.locks.set(title, new Set());
    this.locks.get(title)!.add(`${row}:${col}`);
  }
  locks = new Map<string, Set<string>>();

  snapshot(): SheetSnapshot {
    const tabs: SheetSnapshot["tabs"] = {};
    for (const [title, t] of this.tabs) {
      tabs[title] = { title, sheetId: t.sheetId, values: trimValues(t.values), locked: this.locks.get(title) };
    }
    return { tabs, locale: this.locale, timeZone: "Asia/Jakarta" };
  }

  /** Row objects (by header) of a tab, data rows only. */
  rows(title: string): Record<string, unknown>[] {
    const t = this.tabs.get(title);
    if (!t) return [];
    const [header = [], ...rest] = t.values;
    return rest.map((r) => Object.fromEntries(header.map((h, i) => [String(h), r[i] ?? ""])));
  }

  cell(title: string, row: number, header: string): unknown {
    const t = this.tabs.get(title)!;
    const col = t.values[0].findIndex((h) => h === header);
    return t.values[row - 1]?.[col] ?? "";
  }

  setCell(title: string, row: number, header: string, value: unknown) {
    const t = this.tabs.get(title)!;
    const col = t.values[0].findIndex((h) => h === header);
    if (col < 0) throw new Error(`no header ${header}`);
    while (t.values.length < row) t.values.push([]);
    t.values[row - 1][col] = value;
  }

  note(title: string, row: number, header: string): string | undefined {
    const t = this.tabs.get(title)!;
    const col = t.values[0].findIndex((h) => h === header);
    return t.notes.get(`${row}:${col}`);
  }

  apply(plan: Plan, ids: Map<number, number | string>) {
    for (const tp of plan.tables) {
      if (tp.error) continue;
      const s = tp.sheet;
      if (s.create) this.addTab(s.tab, [s.header]);
      else if (s.writeHeader) this.tabs.get(s.tab)!.values = [s.header];
      const t = this.tabs.get(s.tab)!;
      const set = (row: number, col: number, v: unknown) => {
        while (t.values.length < row) t.values.push([]);
        const r = t.values[row - 1];
        while (r.length < col) r.push("");
        r[col] = v;
      };
      for (const u of s.updates) {
        if (this.locks.get(s.tab)?.has(`${u.row}:${u.col}`)) throw new Error(`write to locked cell ${s.tab} ${u.row}:${u.col}`);
        set(u.row, u.col, encodeCell(u.value, u.fmt));
      }
      for (const w of s.idWrites) {
        const id = ids.get(w.ref);
        // Identity ids are numbers; pd_staff codes stay text.
        if (id !== undefined) set(w.row, w.col, typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id);
      }
      for (const n of s.notes) {
        if (n.text) t.notes.set(`${n.row}:${n.col}`, n.text);
        else t.notes.delete(`${n.row}:${n.col}`);
      }
      for (const row of [...s.deleteRows].sort((a, b) => b - a)) {
        t.values.splice(row - 1, 1);
        const moved = new Map<string, string>();
        for (const [k, v] of t.notes) {
          const [r, c] = k.split(":").map(Number);
          if (r === row) continue;
          moved.set(`${r > row ? r - 1 : r}:${c}`, v);
        }
        t.notes = moved;
      }
      const last = lastNonEmptyRow(t.values);
      t.values.length = last;
      for (const cells of s.appends) t.values.push(cells.map((c) => encodeCell(c.value, c.fmt)));
    }
  }
}

function lastNonEmptyRow(values: unknown[][]): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if ((values[i] ?? []).some((c) => c !== "" && c !== null && c !== undefined)) return i + 1;
  }
  return 0;
}

/** What values.batchGet returns: trailing empty rows and trailing empty cells dropped. */
function trimValues(values: unknown[][]): unknown[][] {
  const out = values.slice(0, lastNonEmptyRow(values)).map((r) => {
    const row = [...(r ?? [])];
    while (row.length && (row[row.length - 1] === "" || row[row.length - 1] == null)) row.pop();
    return row;
  });
  return out;
}

export interface FakeDbOptions {
  /** Emulate the pd_ triggers (staff report group, replacement name/Cabang copied from staff). Default on. */
  triggers?: boolean;
}

/**
 * The v2 store in memory, with the semantics of SupabaseSyncStore + the pd_ schema:
 * - snapshot() is readAll(): stations, areas, and every table without its archived rows;
 * - pending inserts get identity ids (max + 1), or for pd_staff the station's next code (`SUB-03`);
 * - deletes on a table with an archive column archive instead (archived_at set);
 * - deleting a staff member cascades to pd_bmi_checks and nulls pd_replacements.staff_code;
 * - triggers: pd_staff.report_group = the station's report group; a replacement linked to a staff
 *   member carries that member's name and Cabang.
 */
export class FakeDb {
  tables = new Map<SyncTable, Record<string, unknown>[]>();
  /** public.stations (read, never synced). */
  stations: { code: string; report_group: string }[];
  /** pd_areas names. */
  areas: string[];
  triggers: boolean;
  private nextIds = new Map<SyncTable, number>();
  private archiveSeq = 0;

  constructor(init: DbSnapshot = {}, opts: FakeDbOptions = {}) {
    const { stations, areas, ...tables } = init;
    this.stations = (stations ?? TEST_STATIONS).map((s) => ({ ...s }));
    this.areas = [...(areas ?? TEST_AREAS)];
    this.triggers = opts.triggers ?? true;
    for (const [t, rows] of Object.entries(tables)) this.tables.set(t as SyncTable, ((rows ?? []) as Record<string, unknown>[]).map((r) => ({ ...r })));
  }

  /** What SupabaseSyncStore.readAll returns (archived rows left out). */
  snapshot(specs: TableSpec[] = SYNC_TABLES): DbSnapshot {
    const out: DbSnapshot = { stations: this.stations.map((s) => ({ ...s })), areas: [...this.areas] };
    for (const [t, rows] of this.tables) {
      const archive = specs.find((s) => s.table === t)?.archiveColumn;
      out[t] = rows.filter((r) => !archive || r[archive] === null || r[archive] === undefined).map((r) => ({ ...r }));
    }
    return out;
  }

  /** All rows of a table, archived ones included. */
  rows(t: SyncTable) {
    if (!this.tables.has(t)) this.tables.set(t, []);
    return this.tables.get(t)!;
  }

  find(t: SyncTable, key: Record<string, unknown>) {
    return this.rows(t).find((r) => Object.entries(key).every(([k, v]) => r[k] === v));
  }

  /** Remove rows matching `pred` (a delete made in the app, bypassing the sync). */
  remove(t: SyncTable, pred: (r: Record<string, unknown>) => boolean) {
    this.tables.set(t, this.rows(t).filter((r) => !pred(r)));
  }

  private groupOf(station: unknown): string | null {
    return this.stations.find((s) => s.code === station)?.report_group ?? null;
  }

  private nextStaffCode(station: string): string {
    const used = this.rows("pd_staff")
      .map((r) => String(r.code ?? ""))
      .filter((c) => c.startsWith(`${station}-`))
      .map((c) => Number(/-(\d+)$/.exec(c)?.[1] ?? 0));
    return `${station}-${String(Math.max(0, ...used) + 1).padStart(2, "0")}`;
  }

  private touch(table: SyncTable, row: Record<string, unknown>) {
    if (!this.triggers) return;
    if (table === "pd_staff") row.report_group = this.groupOf(row.station);
    if (table === "pd_replacements" && row.staff_code !== null && row.staff_code !== undefined) {
      const s = this.find("pd_staff", { code: row.staff_code });
      if (s) Object.assign(row, { name: s.name, report_group: s.report_group });
    }
  }

  /** Apply in adapter order: parents first for writes, children first for deletes. */
  apply(plan: Plan, specs: TableSpec[] = SYNC_TABLES): Map<number, number | string> {
    const ids = new Map<number, number | string>();
    const order = specs.map((s) => s.table);
    const byTable = new Map(plan.tables.map((t) => [t.table, t]));
    for (const table of order) {
      const tp = byTable.get(table);
      if (!tp || tp.error) continue;
      const spec = specFor(table, specs);
      const rows = this.rows(table);
      if (spec.kv) {
        for (const u of tp.db.updates) rows[0][String(u.key.key)] = u.set.value;
        continue;
      }
      const match = (r: Record<string, unknown>, key: Record<string, unknown>) => spec.key.every((k) => r[k] === key[k]);
      for (const ins of tp.db.inserts) {
        const i = rows.findIndex((r) => match(r, ins));
        if (i >= 0) rows[i] = { ...rows[i], ...ins };
        else rows.push({ ...ins });
        this.touch(table, rows[i >= 0 ? i : rows.length - 1]);
      }
      for (const u of tp.db.updates) {
        const r = rows.find((x) => match(x, u.key));
        if (!r) throw new Error(`update of missing row ${JSON.stringify(u.key)}`);
        const renamed = table === "pd_staff" && ("name" in u.set || "station" in u.set || "report_group" in u.set);
        Object.assign(r, u.set);
        this.touch(table, r);
        if (renamed && this.triggers) for (const x of this.rows("pd_replacements")) if (x.staff_code === r.code) this.touch("pd_replacements", x);
      }
      for (const p of tp.db.pending) {
        let id: number | string;
        if (table === "pd_staff") id = this.nextStaffCode(String(p.values.station));
        else {
          const next = this.nextIds.get(table) ?? Math.max(0, ...rows.map((r) => Number(r.id) || 0)) + 1;
          this.nextIds.set(table, next + 1);
          id = next;
        }
        const row = { ...p.values, [spec.key[0]]: id };
        rows.push(row);
        this.touch(table, row);
        ids.set(p.ref, id);
      }
    }
    for (const table of [...order].reverse()) {
      const tp = byTable.get(table);
      if (!tp || tp.error) continue;
      const spec = specFor(table, specs);
      for (const del of tp.db.deletes) {
        const rows = this.rows(table);
        const i = rows.findIndex((r) => spec.key.every((k) => r[k] === del[k]));
        if (i < 0) continue;
        if (spec.archiveColumn) {
          rows[i][spec.archiveColumn] = `2026-10-19T00:00:${String(this.archiveSeq++ % 60).padStart(2, "0")}Z`;
          continue;
        }
        rows.splice(i, 1);
        // FK actions: children cascade, nullable references are set null.
        for (const child of specs) {
          if (child.parent?.table === table) {
            this.tables.set(child.table, this.rows(child.table).filter((r) => r[child.parent!.column] !== del[spec.key[0]]));
          }
          for (const ref of child.refs ?? []) {
            if (ref.table !== table) continue;
            for (const r of this.rows(child.table)) if (r[ref.column] === del[spec.key[0]]) r[ref.column] = null;
          }
        }
      }
    }
    return ids;
  }
}

export type WorldOptions = Partial<Omit<MergeInput, "baseline" | "sheet" | "db">>;

/**
 * Merge-engine test world: row-1 tabs (no workbook layout), a DB, and the stored baseline.
 * Workbook layouts are exercised by WorkbookWorld (testing/workbook.ts).
 */
export class World {
  sheet = new FakeSheet();
  db: FakeDb;
  baseline: Baseline | null = null;
  specs: TableSpec[];

  constructor(db: DbSnapshot, specs: TableSpec[] = rowOneSpecs(), dbOpts: FakeDbOptions = {}) {
    this.db = new FakeDb(db, dbOpts);
    this.specs = specs;
  }

  plan(opts: WorldOptions = {}): Plan {
    return merge({
      baseline: this.baseline,
      sheet: this.sheet.snapshot(),
      db: this.db.snapshot(this.specs),
      specs: this.specs,
      ...opts,
    });
  }

  sync(opts: WorldOptions = {}): Plan {
    const plan = this.plan(opts);
    const ids = this.db.apply(plan, this.specs);
    this.sheet.apply(plan, ids);
    this.baseline = finalizeBaseline(plan, ids, this.specs);
    return plan;
  }
}
