/**
 * Pure 3-way merge: baseline (last synced values) x sheet x database -> plan.
 *
 * The sheet side is a row-1 table per synced table. For workbook tabs, lib/sync/layouts.ts projects
 * the native layout into that shape (and translates the plan back); formula cells arrive as
 * `locked` and are never read as input or written.
 *
 * Per table, per row key, per cell:
 *   only sheet changed -> write DB; only DB changed -> write sheet; both changed to the same value
 *   -> nothing; both changed differently -> conflict, resolved by policy (default db-wins), logged.
 * New row on one side -> insert on the other. Row in baseline but gone from one side -> delete on the
 * other (delete vs edit is a whole-row conflict resolved by the same policy).
 *
 * Guards: deletes apply on the next run, except an extreme one (more than massDeleteLimit() of a table's
 * baseline rows in one direction, e.g. a tab cleared by accident): those are held back until the operator
 * applies them (/admin/sinkronisasi, allowMassDelete). Invalid sheet values are never written to the DB; they get a cell note and the baseline
 * keeps its old value. A header/layout problem is a hard error for that table: nothing is touched.
 *
 * No I/O here. Same inputs -> same plan, and applying a plan then merging again yields an empty plan.
 */
import { eqCanon, normalize } from "./normalize";
import { SYNC_TABLES, columnId, dataColumns, nonKeyDataColumns } from "./tables";
import {
  DEFAULT_CONFLICT_POLICY,
  type AppendCell,
  type Baseline,
  type Canon,
  type CanonRow,
  type CellFormat,
  type CellWrite,
  type ColumnType,
  type ConflictPolicy,
  type ConflictRecord,
  type DataColumn,
  type DbSnapshot,
  type Issue,
  type IssueKind,
  type Plan,
  type SheetSnapshot,
  type SheetTab,
  type SyncTable,
  type TablePlan,
  type TableSpec,
} from "./types";

/**
 * Deletes in one direction above this many rows are held back: more than half of the table and more than
 * 10 rows. Ordinary deletes (a few staff, a cleared week) always go through.
 */
export function massDeleteLimit(baselineRows: number): number {
  return Math.max(10, baselineRows * 0.5);
}

export interface MergeInput {
  baseline: Baseline | null;
  sheet: SheetSnapshot;
  db: DbSnapshot;
  conflictPolicy?: ConflictPolicy;
  /** Tables whose deletion guard is lifted for this run (operator override). */
  allowMassDelete?: SyncTable[];
  specs?: TableSpec[];
}

const KEY_SEP = "|";
const ISSUE_SEP = "::";

export function emptyBaseline(): Baseline {
  return { v: 1, tables: {}, issues: {} };
}

export function rowKeyOf(spec: TableSpec, row: CanonRow): string | null {
  const parts = spec.key.map((k) => row[k]);
  if (parts.some((p) => p === null || p === undefined)) return null;
  return parts.map(String).join(KEY_SEP);
}

const keyValsOf = (spec: TableSpec, row: CanonRow): CanonRow =>
  Object.fromEntries(spec.key.map((k) => [k, row[k] ?? null]));

const isBlankCell = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const normHeader = (h: unknown) => String(h ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export function fmtOfType(t: ColumnType): CellFormat {
  if (t.kind === "date") return "date";
  if (t.kind === "int" || t.kind === "numeric") return "number";
  return "text";
}

export function typeFor(spec: TableSpec, col: DataColumn, rk: string | null): ColumnType {
  if (spec.kv && col.db === "value") return spec.kv.entries.find((e) => e.key === rk)?.type ?? col.type;
  return col.type;
}

function isRequired(spec: TableSpec, col: DataColumn, rk: string | null): boolean {
  if (spec.kv && col.db === "value") return !!spec.kv.entries.find((e) => e.key === rk)?.required;
  return !!col.required;
}

function fallbackCanon(raw: unknown): Canon {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  return String(raw);
}

/** Merge one cell. `b === undefined` means the row has no baseline (new on both sides). */
export function mergeCell(
  b: Canon | undefined,
  s: Canon,
  d: Canon,
  policy: ConflictPolicy,
): { value: Canon; toDb: boolean; toSheet: boolean; conflict: boolean } {
  const res = (value: Canon, toDb = false, toSheet = false, conflict = false) => ({ value, toDb, toSheet, conflict });
  if (b === undefined) {
    if (eqCanon(s, d)) return res(d);
    if (s === null) return res(d, false, true);
    if (d === null) return res(s, true, false);
    return policy === "db-wins" ? res(d, false, true, true) : res(s, true, false, true);
  }
  const sCh = !eqCanon(s, b);
  const dCh = !eqCanon(d, b);
  if (!sCh && !dCh) return res(d);
  if (sCh && !dCh) return res(s, true);
  if (!sCh && dCh) return res(d, false, true);
  if (eqCanon(s, d)) return res(d);
  return policy === "db-wins" ? res(d, false, true, true) : res(s, true, false, true);
}

// ------------------------------------------------------------------ internals

interface SRow {
  row: number;
  rk: string | null;
  keyVals: CanonRow;
  /** Valid non-key values (null when empty, invalid or locked). */
  values: CanonRow;
  invalid: Map<string, { raw: unknown; message: string }>;
  /** Non-key columns whose cell holds a formula in this row. */
  locked: Set<string>;
  absent: boolean;
  /** Absent, but some non-key input is filled (e.g. a date without height and weight). */
  leftovers: boolean;
}

interface Global {
  input: MergeInput;
  policy: ConflictPolicy;
  prevIssues: Record<string, string>;
  /** Keys that will exist in the DB after this plan, per table (for child FK checks). */
  finalKeys: Map<SyncTable, Set<string>>;
  /** Keys this plan deletes from the DB, per table (children cascade). */
  dbDeleted: Map<SyncTable, Set<string>>;
  /** Valid station codes and report groups (DB `stations`), when known. */
  stations: Set<string> | null;
  reportGroups: Set<string> | null;
  /** Rencana Aksi areas (DB `pd_areas`) by lower-case name, when known. */
  areas: Map<string, string> | null;
  nextRef: number;
}

interface TableResult {
  spec: TableSpec;
  plan: TablePlan;
  tab: SheetTab | undefined;
  errored: boolean;
  newBase: Record<string, CanonRow>;
  /** Final DB state per row key. */
  finalByKey: Map<string, CanonRow>;
  appendRows: CanonRow[];
  rowOfKey: Map<string, number>;
  deletedRows: Set<number>;
  pendingBaseline: Plan["pendingBaseline"];
  cellWrites: Map<string, CellWrite>;
}

function emptyTablePlan(spec: TableSpec, tab: SheetTab | undefined): TablePlan {
  return {
    table: spec.table,
    tab: spec.tab,
    error: null,
    db: { inserts: [], updates: [], deletes: [], pending: [] },
    sheet: {
      tab: spec.tab,
      sheetId: tab?.sheetId ?? null,
      create: false,
      writeHeader: false,
      header: [],
      colIndex: {},
      updates: [],
      appends: [],
      deleteRows: [],
      notes: [],
      idWrites: [],
    },
    conflicts: [],
    issues: [],
  };
}

type Layout =
  | { error: string }
  | { create: boolean; writeHeader: boolean; fresh: boolean; header: string[]; colIndex: Record<string, number> };

function resolveLayout(spec: TableSpec, tab: SheetTab | undefined, layoutError: string | undefined): Layout {
  if (layoutError) return { error: layoutError };
  const layoutHeader = spec.columns.map((c) => c.header);
  const layoutIndex = Object.fromEntries(spec.columns.map((c, i) => [columnId(c), i]));
  if (!tab) return { create: true, writeHeader: true, fresh: true, header: layoutHeader, colIndex: layoutIndex };
  const hasContent = tab.values.some((r) => (r ?? []).some((c) => !isBlankCell(c)));
  if (!hasContent) return { create: false, writeHeader: true, fresh: true, header: layoutHeader, colIndex: layoutIndex };

  const headerRow = tab.values[0] ?? [];
  const positions = new Map<string, number[]>();
  headerRow.forEach((h, i) => {
    const k = normHeader(h);
    if (k) positions.set(k, [...(positions.get(k) ?? []), i]);
  });
  const colIndex: Record<string, number> = {};
  const missing: string[] = [];
  const dup: string[] = [];
  for (const c of spec.columns) {
    const hits = positions.get(normHeader(c.header)) ?? [];
    if (hits.length === 1) colIndex[columnId(c)] = hits[0];
    else (hits.length === 0 ? missing : dup).push(c.header);
  }
  if (missing.length || dup.length) {
    const parts = [];
    if (missing.length) parts.push(`kolom tidak ditemukan di baris 1: ${missing.map((m) => `"${m}"`).join(", ")}`);
    if (dup.length) parts.push(`kolom ganda: ${dup.map((m) => `"${m}"`).join(", ")}`);
    return { error: `Tab "${spec.tab}": ${parts.join("; ")}. Tabel ini tidak disinkronkan sampai header diperbaiki.` };
  }
  return { create: false, writeHeader: false, fresh: false, header: headerRow.map((h) => String(h ?? "")), colIndex };
}

function normDbRow(spec: TableSpec, raw: Record<string, unknown>): CanonRow {
  const out: CanonRow = {};
  for (const c of dataColumns(spec)) {
    const n = normalize(raw[c.db], c.type);
    out[c.db] = n.ok ? n.value : fallbackCanon(raw[c.db]);
  }
  return out;
}

function explodeKv(spec: TableSpec, raw: Record<string, unknown>): Map<string, CanonRow> {
  const out = new Map<string, CanonRow>();
  for (const e of spec.kv!.entries) {
    const n = normalize(raw[e.key], e.type);
    out.set(e.key, { key: e.key, value: n.ok ? n.value : fallbackCanon(raw[e.key]) });
  }
  return out;
}

function issueId(table: SyncTable, rowKey: string | null, row: number | null, column: string | null, kind: IssueKind) {
  return [table, rowKey ?? (row !== null ? `#${row}` : "*"), column ?? "*", kind].join(ISSUE_SEP);
}

function compareTuple(a: (string | number)[], b: (string | number)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y), "en", { numeric: true });
  }
  return 0;
}

/** Laporan Bulanan rows per period: the workbook's five Cabang in sheet order, others by name. */
const GROUP_ORDER = ["CGK & HLP", "DPS", "SUB", "KNO", "BPN"];
const groupRank = (group: string) => (GROUP_ORDER.includes(group) ? GROUP_ORDER.indexOf(group) : 50);

function appendOrder(spec: TableSpec, v: CanonRow): (string | number)[] {
  const n = (x: Canon, dflt = 1e9) => (typeof x === "number" ? x : dflt);
  const s = (x: Canon) => (x === null ? "" : String(x));
  switch (spec.table) {
    case "pd_settings":
      return [spec.kv!.entries.findIndex((e) => e.key === v.key)];
    case "pd_bmi_checks":
      return [s(v.staff_code), n(v.period)];
    case "pd_monthly_reports":
      return [s(v.period), groupRank(s(v.report_group)), s(v.report_group)];
    case "pd_replacements":
    case "pd_action_plans":
      return [n(v.id)];
    default:
      return [s(v[spec.key[0]])];
  }
}

// ------------------------------------------------------------------ per table

function mergeTable(spec: TableSpec, g: Global): TableResult {
  const { input, policy } = g;
  const tab = input.sheet.tabs[spec.tab];
  const plan = emptyTablePlan(spec, tab);
  const prevBase = input.baseline?.tables[spec.table] ?? {};
  const res: TableResult = {
    spec,
    plan,
    tab,
    errored: false,
    newBase: {},
    finalByKey: new Map(),
    appendRows: [],
    rowOfKey: new Map(),
    deletedRows: new Set(),
    pendingBaseline: [],
    cellWrites: new Map(),
  };

  const addIssue = (
    kind: IssueKind,
    rowKey: string | null,
    row: number | null,
    column: string | null,
    message: string,
    extra: { sheetValue?: unknown; dbValue?: Canon; noteCell?: boolean } = {},
  ) => {
    const id = issueId(spec.table, rowKey, rowKey === null ? row : null, column, kind);
    const sig = `${message}|${JSON.stringify(extra.sheetValue ?? null)}`;
    const col = column !== null ? plan.sheet.colIndex[column] : undefined;
    const at = row !== null && col !== undefined ? { row, col } : undefined;
    plan.issues.push({
      id,
      kind,
      table: spec.table,
      rowKey,
      column,
      message,
      sheetValue: extra.sheetValue,
      dbValue: extra.dbValue,
      at,
      cell: extra.noteCell === false ? undefined : at,
      isNew: g.prevIssues[id] !== sig,
    });
  };

  // ---- DB rows
  const dbRaw = input.db[spec.table] ?? [];
  let dbRows = new Map<string, CanonRow>();
  if (spec.kv) {
    if (!dbRaw[0]) {
      plan.error = `Baris settings tidak ada di database.`;
      res.errored = true;
      res.newBase = prevBase;
      addIssue("header_error", null, null, null, plan.error);
      return res;
    }
    dbRows = explodeKv(spec, dbRaw[0]);
  } else {
    for (const r of dbRaw) {
      const row = normDbRow(spec, r);
      const rk = rowKeyOf(spec, row);
      if (rk !== null) dbRows.set(rk, row);
    }
  }

  // ---- layout
  const layout = resolveLayout(spec, tab, input.sheet.errors?.[spec.tab]);
  if ("error" in layout) {
    plan.error = layout.error;
    res.errored = true;
    res.newBase = prevBase;
    res.finalByKey = dbRows;
    addIssue("header_error", null, null, null, layout.error);
    return res;
  }
  Object.assign(plan.sheet, {
    create: layout.create,
    writeHeader: layout.writeHeader,
    header: layout.header,
    colIndex: layout.colIndex,
  });
  // A new or blank tab is repopulated from the DB: nothing in the old baseline may be read as a sheet delete.
  const base: Record<string, CanonRow> = layout.fresh ? {} : prevBase;
  const colIndex = layout.colIndex;
  const nonKey = nonKeyDataColumns(spec);
  const locked = tab?.locked ?? new Set<string>();
  const isLocked = (row: number, colId: string) => locked.has(`${row}:${colIndex[colId]}`);
  const presence = nonKey.filter((c) => (spec.absentUnless ?? nonKey.map((x) => x.db)).includes(c.db));

  // ---- cascade from parent deletes
  const cascade = new Set<string>();
  if (spec.parent) {
    const gone = g.dbDeleted.get(spec.parent.table);
    if (gone?.size) {
      for (const [rk, row] of dbRows) {
        if (gone.has(String(row[spec.parent.column]))) {
          dbRows.delete(rk);
          cascade.add(rk);
        }
      }
    }
  }

  // ---- nullable references: the FK's ON DELETE SET NULL happens in this same run
  for (const ref of spec.refs ?? []) {
    const gone = g.dbDeleted.get(ref.table);
    if (!gone?.size) continue;
    for (const [rk, row] of dbRows) {
      if (row[ref.column] !== null && gone.has(String(row[ref.column]))) dbRows.set(rk, { ...row, [ref.column]: null });
    }
  }
  const refProblem = (column: string, value: Canon): string | null => {
    const ref = spec.refs?.find((r) => r.column === column);
    if (!ref || value === null || g.finalKeys.get(ref.table)?.has(String(value))) return null;
    return `ID SDM "${value}" tidak ada di Tracker Staf.`;
  };

  /** Normalize a sheet value; station codes and report groups must also exist in the DB's stations. */
  const normSheet = (raw: unknown, type: ColumnType) => {
    const n = normalize(raw, type);
    if (!n.ok || n.value === null) return n;
    if (type.kind === "station" && g.stations) {
      if ((type.kps && n.value === "KPS") || g.stations.has(String(n.value))) return n;
      return { ok: false as const, message: `Stasiun "${n.value}" tidak ada di daftar stasiun.` };
    }
    if (type.kind === "report-group" && g.reportGroups && !g.reportGroups.has(String(n.value))) {
      return { ok: false as const, message: `Cabang "${n.value}" tidak dikenal. Isi nama cabang, misalnya DPS atau "CGK & HLP".` };
    }
    if (type.kind === "area" && g.areas) {
      const name = g.areas.get(String(n.value).toLowerCase());
      if (!name) return { ok: false as const, message: `Area "${n.value}" tidak ada di daftar area Rencana Aksi.` };
      return { ok: true as const, value: name };
    }
    return n;
  };

  // ---- cell write helper: formula cells are never written
  const writeCell = (row: number, colId: string, value: Canon, rk: string | null) => {
    const col = colIndex[colId];
    if (col === undefined || locked.has(`${row}:${col}`)) return;
    const c = spec.columns.find((x) => columnId(x) === colId)!;
    res.cellWrites.set(`${row}:${col}`, { row, col, value, fmt: fmtOfType(typeFor(spec, c, rk)) });
  };

  // ---- parse sheet rows
  const sheetRows: SRow[] = [];
  if (!layout.fresh && tab) {
    for (let i = 1; i < tab.values.length; i++) {
      const raw = tab.values[i] ?? [];
      const rowNo = i + 1;
      const cell = (c: DataColumn) => raw[colIndex[c.db]];
      const inputCell = (c: DataColumn) => (isLocked(rowNo, c.db) ? undefined : cell(c));
      if (spec.key.every((k) => isBlankCell(raw[colIndex[k]])) && nonKey.every((c) => isBlankCell(inputCell(c)))) continue;

      const keyVals: CanonRow = {};
      let keyEmpty = false;
      let keyBad = false;
      for (const k of spec.key) {
        const kc = dataColumns(spec).find((c) => c.db === k)!;
        // Keys may come from formulas (e.g. Cek BMI's ID SDM): their computed value counts.
        const n = normSheet(cell(kc), kc.type);
        if (!n.ok) {
          addIssue("invalid_value", null, rowNo, kc.db, n.message, { sheetValue: cell(kc) });
          keyBad = true;
          break;
        }
        if (n.value === null) keyEmpty = true;
        keyVals[k] = n.value;
      }
      if (keyBad) continue;
      if (keyEmpty && !spec.generatedKey) {
        const kc = spec.key.find((k) => keyVals[k] === null)!;
        addIssue("missing_key", null, rowNo, kc, "Kolom kunci kosong: baris ini tidak disinkronkan.");
        continue;
      }
      const rk = keyEmpty ? null : rowKeyOf(spec, keyVals);
      if (spec.kv && !spec.kv.entries.some((e) => e.key === rk)) {
        addIssue("unknown_setting", null, rowNo, "key", "Parameter tidak dikenal.", { sheetValue: rk });
        continue;
      }

      const values: CanonRow = {};
      const invalid = new Map<string, { raw: unknown; message: string }>();
      const lockedCols = new Set<string>();
      for (const c of nonKey) {
        if (isLocked(rowNo, c.db)) {
          lockedCols.add(c.db);
          values[c.db] = null;
          continue;
        }
        const n = normSheet(cell(c), typeFor(spec, c, rk));
        if (n.ok) values[c.db] = n.value;
        else {
          values[c.db] = null;
          invalid.set(c.db, { raw: cell(c), message: n.message });
        }
      }
      const empty = (c: DataColumn) => lockedCols.has(c.db) || (values[c.db] === null && !invalid.has(c.db));
      const absent = !!spec.emptyRowIsAbsent && presence.every(empty);
      const leftovers = absent && !nonKey.every(empty);
      sheetRows.push({ row: rowNo, rk, keyVals, values, invalid, locked: lockedCols, absent, leftovers });
    }
  }

  const present = new Map<string, SRow[]>();
  const slots = new Map<string, SRow>();
  let newRows: SRow[] = [];
  for (const r of sheetRows) {
    if (r.rk === null) newRows.push(r);
    else if (r.absent) {
      if (!slots.has(r.rk)) slots.set(r.rk, r);
    } else present.set(r.rk, [...(present.get(r.rk) ?? []), r]);
  }
  const dupKeys = new Set<string>();
  const sheetByKey = new Map<string, SRow>();
  for (const [rk, list] of present) {
    if (list.length > 1) {
      dupKeys.add(rk);
      for (const r of list) {
        addIssue("duplicate_key", null, r.row, spec.key[0], `ID ganda (${rk}) di beberapa baris: baris ini tidak disinkronkan sampai duplikatnya dihapus.`, {
          sheetValue: rk,
        });
      }
    } else {
      sheetByKey.set(rk, list[0]);
      res.rowOfKey.set(rk, list[0].row);
    }
  }
  for (const [rk, r] of slots) if (!res.rowOfKey.has(rk)) res.rowOfKey.set(rk, r.row);

  // ---- adopt id-less sheet rows that match an unknown DB row (first run, or an id lost in a crash)
  if (spec.generatedKey && spec.adoptBy && newRows.length) {
    const akey = (v: CanonRow) =>
      spec.adoptBy!.map((c) => String(v[c] ?? "").replace(/\s+/g, " ").trim().toLowerCase()).join("\u0001");
    const dbGroups = new Map<string, string[]>();
    for (const [rk, row] of dbRows) {
      if (sheetByKey.has(rk) || dupKeys.has(rk)) continue;
      dbGroups.set(akey(row), [...(dbGroups.get(akey(row)) ?? []), rk]);
    }
    const newGroups = new Map<string, SRow[]>();
    for (const r of newRows) newGroups.set(akey(r.values), [...(newGroups.get(akey(r.values)) ?? []), r]);
    const adopted = new Set<SRow>();
    for (const [k, rows] of newGroups) {
      const cands = dbGroups.get(k);
      if (rows.length !== 1 || cands?.length !== 1) continue;
      const rk = cands[0];
      const r = rows[0];
      r.rk = rk;
      r.keyVals = keyValsOf(spec, dbRows.get(rk)!);
      sheetByKey.set(rk, r);
      res.rowOfKey.set(rk, r.row);
      writeCell(r.row, spec.key[0], r.keyVals[spec.key[0]], rk);
      adopted.add(r);
    }
    newRows = newRows.filter((r) => !adopted.has(r));
  }

  // ---- row-level helpers
  const conflicts: ConflictRecord[] = [];
  const sheetRowOf = (r: SRow): CanonRow => ({ ...r.keyVals, ...r.values });

  const filledSlots = new Set<number>();
  /** Put a DB row into the sheet. Returns false when the layout has no row for it (reported). */
  const placeInSheet = (rk: string, values: CanonRow): boolean => {
    const slot = slots.get(rk);
    if (slot) {
      // The slot becomes exactly the DB row: leftovers typed there are replaced or cleared.
      for (const c of nonKey) {
        const v = values[c.db] ?? null;
        if (!eqCanon(slot.values[c.db], v) || slot.invalid.has(c.db)) writeCell(slot.row, c.db, v, rk);
      }
      filledSlots.add(slot.row);
      return true;
    }
    if (spec.appendMode === "none") {
      addIssue("no_sheet_row", rk, null, null, spec.noRowMessage ?? "Tidak ada baris untuk data ini di Sheet.", {
        sheetValue: rk,
      });
      return false;
    }
    res.appendRows.push(values);
    return true;
  };

  const removeFromSheet = (r: SRow) => {
    // Entry rows of a staff member that no longer exists are removed, not just emptied
    // (fixed workbook layouts only ever clear: their rows are referenced by position).
    const orphan =
      !!spec.parent && !g.finalKeys.get(spec.parent.table)?.has(String(r.keyVals[spec.parent.column]));
    if (spec.deleteMode === "clear" || (spec.emptyRowIsAbsent && !orphan)) {
      for (const c of nonKey) if (r.values[c.db] !== null || r.invalid.has(c.db)) writeCell(r.row, c.db, null, r.rk);
      if (spec.generatedKey) writeCell(r.row, spec.key[0], null, r.rk);
    } else {
      plan.sheet.deleteRows.push(r.row);
      res.deletedRows.add(r.row);
    }
  };

  /** Validate a sheet row for insertion into the DB. Returns the full row, or null (issues recorded). */
  const rowForInsert = (r: SRow, rk: string | null): CanonRow | null => {
    const values: CanonRow = { ...r.keyVals };
    const fills: [string, Canon][] = [];
    let ok = true;
    for (const c of nonKey) {
      const inv = r.invalid.get(c.db);
      if (inv) {
        addIssue("invalid_value", rk, r.row, c.db, inv.message, { sheetValue: inv.raw });
        ok = false;
        continue;
      }
      let v = r.values[c.db] ?? null;
      if (v === null && isRequired(spec, c, rk)) {
        if (c.defaultValue !== undefined) {
          v = c.defaultValue;
          fills.push([c.db, v]);
        } else {
          addIssue("required_missing", rk, r.row, c.db, `"${c.header}" wajib diisi. Baris ini belum disimpan ke database.`);
          ok = false;
        }
      }
      values[c.db] = v;
    }
    for (const ref of spec.refs ?? []) {
      const problem = refProblem(ref.column, values[ref.column]);
      if (problem) {
        addIssue("unknown_parent", rk, r.row, ref.column, `${problem} Baris ini belum disimpan ke database.`, {
          sheetValue: values[ref.column],
        });
        ok = false;
      }
    }
    if (spec.parent) {
      const pv = values[spec.parent.column];
      if (!g.finalKeys.get(spec.parent.table)?.has(String(pv))) {
        addIssue("unknown_parent", rk, r.row, spec.parent.column, `ID SDM "${pv}" tidak ada di Tracker Staf. Baris ini belum disimpan ke database.`, {
          sheetValue: pv,
        });
        ok = false;
      }
    }
    if (!ok) return null;
    for (const [c, v] of fills) writeCell(r.row, c, v, rk);
    return values;
  };

  /** Insert a sheet row into the DB (natural key or pending generated id). */
  const insertFromSheet = (r: SRow, rk: string | null): boolean => {
    const values = rowForInsert(r, rk);
    if (!values) return false;
    if (spec.generatedKey) {
      const ref = g.nextRef++;
      const { [spec.key[0]]: _drop, ...rest } = values;
      void _drop;
      plan.db.pending.push({ ref, values: rest });
      plan.sheet.idWrites.push({ ref, row: r.row, col: colIndex[spec.key[0]] });
      res.pendingBaseline.push({ table: spec.table, ref, values: rest });
      return true;
    }
    plan.db.inserts.push(values);
    res.newBase[rk!] = values;
    res.finalByKey.set(rk!, values);
    return true;
  };

  const mergeBoth = (rk: string, B: CanonRow | undefined, S: SRow, D: CanonRow) => {
    const merged: CanonRow = keyValsOf(spec, D);
    const nb: CanonRow = keyValsOf(spec, D);
    const dbSet: CanonRow = {};
    for (const c of nonKey) {
      const d = D[c.db] ?? null;
      const b = B ? (B[c.db] ?? null) : undefined;
      if (S.locked.has(c.db)) {
        // Formula cell: the sheet has no input here. The DB value stands; nothing is written.
        merged[c.db] = d;
        nb[c.db] = d;
        continue;
      }
      const s = S.values[c.db] ?? null;
      const inv = S.invalid.get(c.db);
      let invalid: { raw: unknown; message: string; kind: IssueKind } | undefined = inv && { ...inv, kind: "invalid_value" };
      if (!invalid && s === null && B && b !== null && isRequired(spec, c, rk)) {
        invalid = { raw: null, message: `"${c.header}" wajib diisi; nilai database dipertahankan.`, kind: "required_missing" };
      }
      const problem = invalid ? null : refProblem(c.db, s);
      if (problem && !eqCanon(s, d)) invalid = { raw: s, message: problem, kind: "unknown_parent" };
      if (invalid) {
        const kind = invalid.kind;
        if (B && !eqCanon(d, b)) {
          // DB changed: its value replaces the rejected sheet value.
          writeCell(S.row, c.db, d, rk);
          addIssue(kind, rk, S.row, c.db, invalid.message, { sheetValue: invalid.raw, dbValue: d, noteCell: false });
          merged[c.db] = d;
          nb[c.db] = d;
        } else {
          addIssue(kind, rk, S.row, c.db, invalid.message, { sheetValue: invalid.raw, dbValue: d });
          merged[c.db] = d;
          nb[c.db] = B ? b! : d;
        }
        continue;
      }
      const m = mergeCell(b, s, d, policy);
      merged[c.db] = m.value;
      nb[c.db] = m.value;
      if (m.toDb) dbSet[c.db] = m.value;
      if (m.toSheet) writeCell(S.row, c.db, m.value, rk);
      if (m.conflict) {
        conflicts.push({ table: spec.table, rowKey: rk, column: c.db, baseline: b ?? null, sheet: s, db: d, resolution: policy });
      }
    }
    if (Object.keys(dbSet).length) plan.db.updates.push({ key: keyValsOf(spec, D), set: dbSet });
    res.newBase[rk] = nb;
    res.finalByKey.set(rk, merged);
  };

  const sheetEdited = (S: SRow, B: CanonRow) =>
    nonKey.some((c) => !S.invalid.has(c.db) && !S.locked.has(c.db) && !eqCanon(S.values[c.db], B[c.db]));
  const dbEdited = (D: CanonRow, B: CanonRow) => nonKey.some((c) => !eqCanon(D[c.db], B[c.db]));
  const rowConflict = (rk: string, B: CanonRow, S: CanonRow | null, D: CanonRow | null): ConflictRecord => ({
    table: spec.table,
    rowKey: rk,
    column: null,
    baseline: B,
    sheet: S,
    db: D,
    resolution: policy,
  });

  const dbDeleteCands: { rk: string; D: CanonRow; B: CanonRow; conflict?: ConflictRecord }[] = [];
  const sheetDeleteCands: { rk: string; S: SRow; B: CanonRow; conflict?: ConflictRecord }[] = [];

  // ---- union of keys
  const keys = new Set<string>([...Object.keys(base), ...sheetByKey.keys(), ...dbRows.keys(), ...dupKeys]);
  for (const rk of keys) {
    const B = base[rk];
    const S = sheetByKey.get(rk);
    const D = dbRows.get(rk);

    if (dupKeys.has(rk)) {
      if (B) res.newBase[rk] = B;
      if (D) res.finalByKey.set(rk, D);
      continue;
    }
    if (S && D) {
      mergeBoth(rk, B, S, D);
      continue;
    }
    if (S && !D) {
      if (!B) {
        insertFromSheet(S, rk);
        continue;
      }
      if (cascade.has(rk)) {
        removeFromSheet(S);
        continue;
      }
      if (sheetEdited(S, B)) {
        const conflict = rowConflict(rk, B, sheetRowOf(S), null);
        if (policy === "db-wins") sheetDeleteCands.push({ rk, S, B, conflict });
        else if (insertFromSheet(S, rk)) conflicts.push(conflict);
        else res.newBase[rk] = B;
      } else sheetDeleteCands.push({ rk, S, B });
      continue;
    }
    if (!S && D) {
      res.finalByKey.set(rk, D);
      if (!B || spec.kv) {
        if (placeInSheet(rk, D)) res.newBase[rk] = D;
        continue;
      }
      if (dbEdited(D, B)) {
        const conflict = rowConflict(rk, B, null, D);
        if (policy === "db-wins") {
          if (placeInSheet(rk, D)) res.newBase[rk] = D;
          conflicts.push(conflict);
        } else dbDeleteCands.push({ rk, D, B, conflict });
      } else dbDeleteCands.push({ rk, D, B });
      continue;
    }
    // Gone from both sides: drop from the baseline.
  }

  // ---- id-less new rows (generated keys)
  for (const r of newRows) insertFromSheet(r, null);

  // ---- deletion guard
  const limit = massDeleteLimit(Object.keys(base).length);
  const allow = input.allowMassDelete?.includes(spec.table) ?? false;
  const dbDeleted = new Set<string>();
  if (dbDeleteCands.length > limit && !allow) {
    for (const c of dbDeleteCands) res.newBase[c.rk] = c.B;
    addIssue(
      "deletes_skipped",
      null,
      null,
      "db",
      `${dbDeleteCands.length} baris hilang dari tab "${spec.tab}" (batas ${Math.floor(limit)}). Penghapusan di database ditahan: pulihkan baris di Sheet, atau terapkan di halaman Sinkronisasi.`,
      { sheetValue: dbDeleteCands.length },
    );
  } else {
    for (const c of dbDeleteCands) {
      plan.db.deletes.push(keyValsOf(spec, c.D));
      dbDeleted.add(c.rk);
      res.finalByKey.delete(c.rk);
      if (c.conflict) conflicts.push(c.conflict);
    }
  }
  if (sheetDeleteCands.length > limit && !allow) {
    for (const c of sheetDeleteCands) res.newBase[c.rk] = c.B;
    addIssue(
      "deletes_skipped",
      null,
      null,
      "sheet",
      `${sheetDeleteCands.length} baris hilang dari database untuk tab "${spec.tab}" (batas ${Math.floor(limit)}). Penghapusan di Sheet ditahan: terapkan di halaman Sinkronisasi.`,
      { sheetValue: sheetDeleteCands.length },
    );
  } else {
    for (const c of sheetDeleteCands) {
      removeFromSheet(c.S);
      if (c.conflict) conflicts.push(c.conflict);
    }
  }

  // ---- absent rows with leftovers: cleared when their record was just deleted, else reported
  for (const [rk, slot] of slots) {
    if (!slot.leftovers || filledSlots.has(slot.row)) continue;
    if (dbDeleted.has(rk)) {
      for (const c of nonKey) if (slot.values[c.db] !== null || slot.invalid.has(c.db)) writeCell(slot.row, c.db, null, rk);
      continue;
    }
    // Something typed, but the columns that make the row a record are empty (e.g. a date without
    // height/weight, a staff row without a name).
    addIssue("incomplete_row", rk, slot.row, presence[0].db, `Baris belum lengkap: isi ${presence.map((c) => `"${c.header}"`).join(" dan ")}. Belum disimpan ke database.`);
  }

  // ---- settings: cross-field checks on the merged values; reject the sheet's changes if they fail
  if (spec.kv?.validate) {
    const final: Record<string, Canon> = {};
    for (const [k, row] of res.finalByKey) final[k] = row.value;
    const err = spec.kv.validate(final);
    if (err && plan.db.updates.length) {
      for (const u of plan.db.updates) {
        const rk = String(u.key.key);
        const D = dbRows.get(rk)!;
        const S = sheetByKey.get(rk)!;
        res.finalByKey.set(rk, D);
        res.newBase[rk] = base[rk] ?? D;
        addIssue("invalid_value", rk, S.row, "value", err, { sheetValue: S.values.value, dbValue: D.value });
        for (let i = conflicts.length - 1; i >= 0; i--) if (conflicts[i].rowKey === rk) conflicts.splice(i, 1);
      }
      plan.db.updates = [];
    }
  }

  plan.conflicts = conflicts;
  g.finalKeys.set(spec.table, new Set(res.finalByKey.keys()));
  g.dbDeleted.set(spec.table, dbDeleted);
  return res;
}

// ------------------------------------------------------------------ assembly

function assemble(results: TableResult[]): void {
  for (const res of results) {
    if (res.errored) continue;
    const { spec, plan } = res;
    const colIndex = plan.sheet.colIndex;
    const width = plan.sheet.header.length;
    const byIndex = new Map<number, DataColumn>();
    for (const c of spec.columns) {
      const i = colIndex[columnId(c)];
      if (i !== undefined) byIndex.set(i, c);
    }
    res.appendRows.sort((a, b) => compareTuple(appendOrder(spec, a), appendOrder(spec, b)));
    plan.sheet.appends = res.appendRows.map((values) => {
      const rk = rowKeyOf(spec, values);
      const cells: AppendCell[] = [];
      for (let i = 0; i < width; i++) {
        const c = byIndex.get(i);
        cells.push(c ? { value: values[c.db] ?? null, fmt: fmtOfType(typeFor(spec, c, rk)) } : { value: null, fmt: "text" });
      }
      return cells;
    });
    plan.sheet.updates = [...res.cellWrites.values()].sort((a, b) => a.row - b.row || a.col - b.col);
    plan.sheet.deleteRows = [...new Set(plan.sheet.deleteRows)].sort((a, b) => b - a);
  }
}

function noteText(issue: Issue): string {
  return `JOUMPA sync: ${issue.message}`;
}

/** Cell notes for new issues; clear notes of issues that are gone. Returns the issue map to store. */
function placeNotes(results: TableResult[], g: Global): Record<string, string> {
  const stored: Record<string, string> = {};
  const errored = new Set(results.filter((r) => r.errored).map((r) => r.spec.table));
  const current = new Set<string>();

  for (const res of results) {
    for (const issue of res.plan.issues) {
      current.add(issue.id);
      const sig = `${issue.message}|${JSON.stringify(issue.sheetValue ?? null)}`;
      const tableLevel = issue.column === "db" || issue.column === "sheet" || issue.kind === "header_error" || issue.kind === "no_sheet_row";
      if (issue.cell || tableLevel) stored[issue.id] = sig;
      if (issue.isNew && issue.cell && !res.deletedRows.has(issue.cell.row)) {
        res.plan.sheet.notes.push({ row: issue.cell.row, col: issue.cell.col, text: noteText(issue) });
      } else if (!issue.cell && issue.at && g.prevIssues[issue.id] !== undefined) {
        // The cell was overwritten with a valid value this run: drop the old note.
        res.plan.sheet.notes.push({ row: issue.at.row, col: issue.at.col, text: "" });
      }
    }
  }

  for (const [id, sig] of Object.entries(g.prevIssues)) {
    if (current.has(id)) continue;
    const [table, rowRef, column] = id.split(ISSUE_SEP) as [SyncTable, string, string];
    if (errored.has(table)) {
      stored[id] = sig;
      continue;
    }
    const res = results.find((r) => r.spec.table === table);
    if (!res || column === "*" || column === "db" || column === "sheet" || res.plan.sheet.writeHeader) continue;
    const row = rowRef.startsWith("#") ? Number(rowRef.slice(1)) : res.rowOfKey.get(rowRef);
    const col = res.plan.sheet.colIndex[column];
    if (row === undefined || Number.isNaN(row) || col === undefined || res.deletedRows.has(row)) continue;
    if (res.tab && row > res.tab.values.length) continue;
    if (!res.plan.sheet.notes.some((n) => n.row === row && n.col === col)) {
      res.plan.sheet.notes.push({ row, col, text: "" });
    }
  }
  for (const res of results) res.plan.sheet.notes.sort((a, b) => a.row - b.row || a.col - b.col);
  return stored;
}

// ------------------------------------------------------------------ entry points

export function merge(input: MergeInput): Plan {
  const g: Global = {
    input,
    policy: input.conflictPolicy ?? DEFAULT_CONFLICT_POLICY,
    prevIssues: input.baseline?.issues ?? {},
    finalKeys: new Map(),
    dbDeleted: new Map(),
    stations: input.db.stations ? new Set(input.db.stations.map((r) => String(r.code))) : null,
    reportGroups: input.db.stations ? new Set(input.db.stations.map((r) => String(r.report_group).toUpperCase())) : null,
    areas: input.db.areas ? new Map(input.db.areas.map((a) => [a.toLowerCase(), a])) : null,
    nextRef: 1,
  };
  const specs = input.specs ?? SYNC_TABLES;
  const results = specs.map((spec) => mergeTable(spec, g));
  assemble(results);
  const issues = placeNotes(results, g);

  const tables: Baseline["tables"] = {};
  for (const r of results) tables[r.spec.table] = r.newBase;
  return {
    tables: results.map((r) => r.plan),
    baseline: { v: 1, tables, issues },
    pendingBaseline: results.flatMap((r) => r.pendingBaseline),
  };
}

/** Add rows inserted with database-generated ids (ref -> id) to the baseline. */
export function finalizeBaseline(plan: Plan, ids: Map<number, number | string>, specs: TableSpec[] = SYNC_TABLES): Baseline {
  const out: Baseline = {
    v: 1,
    tables: Object.fromEntries(Object.entries(plan.baseline.tables).map(([t, rows]) => [t, { ...rows }])),
    issues: { ...(plan.baseline.issues ?? {}) },
  };
  for (const p of plan.pendingBaseline) {
    const id = ids.get(p.ref);
    if (id === undefined) continue;
    const spec = specs.find((s) => s.table === p.table)!;
    const values = { ...p.values, [spec.key[0]]: typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id };
    const rk = rowKeyOf(spec, values)!;
    (out.tables[p.table] ??= {})[rk] = values;
  }
  return out;
}

export interface TableCounts {
  dbInserts: number;
  dbUpdates: number;
  dbDeletes: number;
  sheetCellUpdates: number;
  sheetAppends: number;
  sheetRowDeletes: number;
  conflicts: number;
  newIssues: number;
  openIssues: number;
  createTab: boolean;
  error: boolean;
}

export function countPlan(plan: Plan): Record<string, TableCounts> {
  return Object.fromEntries(
    plan.tables.map((t) => [
      t.table,
      {
        dbInserts: t.db.inserts.length + t.db.pending.length,
        dbUpdates: t.db.updates.length,
        dbDeletes: t.db.deletes.length,
        sheetCellUpdates: t.sheet.updates.length + t.sheet.idWrites.length,
        sheetAppends: t.sheet.appends.length,
        sheetRowDeletes: t.sheet.deleteRows.length,
        conflicts: t.conflicts.length,
        newIssues: t.issues.filter((i) => i.isNew).length,
        openIssues: t.issues.length,
        createTab: t.sheet.create || t.sheet.writeHeader,
        error: t.error !== null,
      },
    ]),
  );
}

/** True when the plan writes nothing anywhere and reports nothing new. */
export function isPlanEmpty(plan: Plan): boolean {
  return plan.tables.every(
    (t) =>
      t.db.inserts.length === 0 &&
      t.db.updates.length === 0 &&
      t.db.deletes.length === 0 &&
      t.db.pending.length === 0 &&
      !t.sheet.create &&
      !t.sheet.writeHeader &&
      t.sheet.updates.length === 0 &&
      t.sheet.appends.length === 0 &&
      t.sheet.deleteRows.length === 0 &&
      t.sheet.notes.length === 0 &&
      t.sheet.idWrites.length === 0 &&
      t.conflicts.length === 0 &&
      t.issues.every((i) => !i.isNew),
  );
}
