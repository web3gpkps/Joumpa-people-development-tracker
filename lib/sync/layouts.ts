/**
 * Workbook layouts <-> the merge engine's row-1 tables.
 *
 * The replica is the workbook. Each synced table lives in a native tab (header on row 4, data from
 * row 5, formulas between the inputs, Cek BMI in wide format, Parameter BMI as label/value).
 * `projectAll` turns the real grid into one virtual row-1 table per synced table (what lib/sync/merge.ts
 * understands); `translate` turns the merge plan back into real cell writes.
 *
 * Generic rules:
 * - A cell holding a formula is never read as input and never written (it reaches the merge as
 *   `locked`; translate refuses to write it). Keys may come from formulas (their computed value).
 * - Untouched tabs (Petunjuk, Dashboard, Referensi) are never written.
 * - Rows are never inserted or deleted in workbook tabs (other tabs reference them by position):
 *   deletes clear input cells; new records fill free pre-made rows or extend below them with the
 *   template row's formulas copied (PASTE_FORMULA).
 */
import { periodLabel, parsePeriod } from "../pd-rules";
import { isoToSerial, roundTo, serialToIso } from "./normalize";
import { SYNC_TABLES, UNTOUCHED_TABS, columnId } from "./tables";
import type { Canon, CellFormat, Plan, SheetSnapshot, SheetTab, SyncTable, TableSpec } from "./types";

// ------------------------------------------------------------------ real grid model

export interface RealTab {
  title: string;
  sheetId: number;
  /** values.batchGet with UNFORMATTED_VALUE + SERIAL_NUMBER dates. */
  values: unknown[][];
  /** values.batchGet with FORMULA: "=..." where the cell holds a formula. */
  formulas: unknown[][];
  rowCount: number;
  columnCount: number;
}

export interface RealSnapshot {
  tabs: Record<string, RealTab | undefined>;
  locale?: string;
  timeZone?: string;
}

/** 1-based row, 0-based column. */
export interface RealCell {
  tab: string;
  row: number;
  col: number;
}

export interface RealWrite extends RealCell {
  table: SyncTable;
  value: unknown;
  /** Write the DB id of pending insert `ref` (resolved after the DB writes). */
  ref?: number;
}

export interface RealOps {
  /** Engine-owned tabs to create (or a blank existing tab to lay out). */
  createTabs: { table: SyncTable; tab: string; spec: TableSpec; header: string[]; minRows: number; exists: boolean }[];
  /** Header cells the engine adds to a workbook tab (Penggantian SDM: ID Sistem, ID SDM). */
  headerCells: (RealCell & { table: SyncTable; text: string; hide?: boolean })[];
  grow: { table: SyncTable; tab: string; rowCount: number }[];
  writes: RealWrite[];
  /** copyPaste PASTE_FORMULA from `fromRow` to `toRow` for these columns. */
  formulaCopies: { table: SyncTable; tab: string; fromRow: number; toRow: number; cols: number[] }[];
  notes: (RealCell & { table: SyncTable; text: string })[];
  /** Engine-owned tabs only. */
  deleteRows: { table: SyncTable; tab: string; rows: number[] }[];
  /** Engine-owned tabs only (values:append INSERT_ROWS). */
  appends: { table: SyncTable; tab: string; rows: unknown[][] }[];
}

export function emptyOps(): RealOps {
  return { createTabs: [], headerCells: [], grow: [], writes: [], formulaCopies: [], notes: [], deleteRows: [], appends: [] };
}

export function isFormulaCell(tab: RealTab | undefined, row: number, col: number): boolean {
  if (!tab) return false;
  const f = tab.formulas[row - 1]?.[col];
  return typeof f === "string" && f.startsWith("=") && f !== tab.values[row - 1]?.[col];
}

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const normHeader = (h: unknown) => String(h ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const lastRowOf = (t: RealTab) => Math.max(t.values.length, t.formulas.length);

function headerPositions(tab: RealTab, row: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  (tab.values[row - 1] ?? []).forEach((h, i) => {
    const k = normHeader(h);
    if (k) out.set(k, [...(out.get(k) ?? []), i]);
  });
  return out;
}

/** RAW encoding: dates as serial numbers (the workbook's date cells are pre-formatted), null clears. */
export function encodeRaw(value: Canon, fmt: CellFormat): unknown {
  if (value === null) return "";
  if (fmt === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return isoToSerial(value);
  return value;
}

interface Transform {
  read(raw: unknown): unknown;
  write(value: Canon): unknown;
}

/** Rencana Aksi "% Progres": the sheet holds a fraction formatted 0%, the DB 0..100. */
export const PERCENT: Transform = {
  read(raw) {
    if (typeof raw === "number") return roundTo(raw * 100, 6);
    if (typeof raw === "string") {
      const t = raw.trim();
      const pct = /^(-?\d+(?:[.,]\d+)?)\s*%$/.exec(t);
      if (pct) return Number(pct[1].replace(",", "."));
      const n = /^-?\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : NaN;
      if (!Number.isNaN(n)) return roundTo(n * 100, 6);
    }
    return raw;
  },
  write(value) {
    return typeof value === "number" ? roundTo(value / 100, 6) : value === null ? "" : value;
  },
};

/**
 * Laporan Bulanan "Periode": the sheet holds the text "Okt 2026", the DB the month's first day.
 * A date typed instead (serial or text) is read as its month.
 */
export const PERIOD: Transform = {
  read(raw) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 1) return `${serialToIso(raw).slice(0, 7)}-01`;
    if (typeof raw === "string") {
      const t = raw.trim();
      if (t === "") return raw;
      const iso = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(t);
      if (iso) return `${iso[1]}-${iso[2]}-01`;
      return parsePeriod(t) ?? raw;
    }
    return raw;
  },
  write(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? periodLabel(value) : value === null ? "" : value;
  },
};

// ------------------------------------------------------------------ projections

export interface Placement {
  rows: number[];
  formulaCopies: { fromRow: number; toRow: number; cols: number[] }[];
  extraWrites: { row: number; col: number; value: unknown }[];
  growTo?: number;
}

export interface Projection {
  spec: TableSpec;
  /** Tab the projection mostly lives in (for messages). */
  tab: string;
  error?: string;
  virtual?: SheetTab;
  /** Real cell behind a virtual cell; undefined for synthetic cells (e.g. Cek BMI period). */
  cell(vrow: number, colId: string): RealCell | undefined;
  encode(colId: string, value: Canon, fmt: CellFormat): unknown;
  /** Real column of a column in row-based layouts (for placing new rows). */
  colOf?(colId: string): number | undefined;
  /** Cell in another tab for an external column of real row `row` (new rows too). */
  externalCell?(row: number, colId: string): RealCell | undefined;
  /** appendMode "blank-row": where n new records go. */
  place?(n: number): Placement;
  /** Header cells to add before writing (missing engine columns). */
  setup: { row: number; col: number; text: string; hide?: boolean }[];
  /** True when the virtual tab mirrors the real tab 1:1 (engine-owned row-1 tab). */
  identity?: boolean;
}

function failed(spec: TableSpec, tab: string, error: string): Projection {
  return { spec, tab, error, cell: () => undefined, encode: (_c, v, f) => encodeRaw(v, f), setup: [] };
}

interface RowLayoutConfig {
  headerRow: number;
  firstDataRow: number;
  /** Columns the engine adds to the right of the header when missing. */
  addable?: string[];
  transforms?: Record<string, Transform>;
  /** Column A holds a running number ("No") that new rows continue. */
  numbered?: boolean;
  /** Columns that live in another tab, located from this row (its key, its position). */
  external?: Record<string, (key: Canon, row: number) => { cell?: RealCell; tab?: RealTab }>;
}

function rowLayout(spec: TableSpec, real: RealSnapshot, cfg: RowLayoutConfig): Projection {
  const tab = real.tabs[spec.tab];
  if (!tab) return failed(spec, spec.tab, `Tab "${spec.tab}" tidak ditemukan di Google Sheet. Tabel ini tidak disinkronkan.`);

  const positions = headerPositions(tab, cfg.headerRow);
  const lastHeaderCol = Math.max(-1, ...[...positions.values()].flat());
  const colOf: Record<string, number> = {};
  const setup: Projection["setup"] = [];
  const missing: string[] = [];
  const dup: string[] = [];
  let nextFree = lastHeaderCol + 1;
  for (const c of spec.columns) {
    if (cfg.external?.[c.db]) continue;
    const hits = positions.get(normHeader(c.header)) ?? [];
    if (hits.length === 1) colOf[c.db] = hits[0];
    else if (hits.length === 0 && cfg.addable?.includes(c.db)) {
      colOf[c.db] = nextFree++;
      setup.push({ row: cfg.headerRow, col: colOf[c.db], text: c.header, hide: c.hidden });
    } else (hits.length === 0 ? missing : dup).push(c.header);
  }
  if (missing.length || dup.length) {
    const parts = [];
    if (missing.length) parts.push(`kolom tidak ditemukan di baris ${cfg.headerRow}: ${missing.map((m) => `"${m}"`).join(", ")}`);
    if (dup.length) parts.push(`kolom ganda: ${dup.map((m) => `"${m}"`).join(", ")}`);
    return failed(spec, spec.tab, `Tab "${spec.tab}": ${parts.join("; ")}. Tabel ini tidak disinkronkan sampai header diperbaiki.`);
  }

  const keyCol = colOf[spec.key[0]];
  const last = lastRowOf(tab);
  const header = spec.columns.map((c) => c.header);
  const values: unknown[][] = [header];
  const locked = new Set<string>();
  const vrowOf = (r: number) => r - cfg.firstDataRow + 2;
  const rowOfV = (v: number) => v + cfg.firstDataRow - 2;
  const external = (colId: string, row: number) => {
    const key = tab.values[row - 1]?.[keyCol];
    return cfg.external?.[colId]?.(isBlank(key) ? null : (key as Canon), row);
  };

  for (let r = cfg.firstDataRow; r <= last; r++) {
    const v = vrowOf(r);
    const out: unknown[] = [];
    spec.columns.forEach((c, i) => {
      const ext = cfg.external?.[c.db];
      if (ext) {
        const where = external(c.db, r);
        if (!where?.cell || isFormulaCell(where.tab, where.cell.row, where.cell.col)) {
          locked.add(`${v}:${i}`);
          out.push(undefined);
        } else out.push(where.tab!.values[where.cell.row - 1]?.[where.cell.col]);
        return;
      }
      const col = colOf[c.db];
      const raw = tab.values[r - 1]?.[col];
      if (isFormulaCell(tab, r, col) && !spec.key.includes(c.db)) locked.add(`${v}:${i}`);
      out.push(cfg.transforms?.[c.db] ? cfg.transforms[c.db].read(raw) : raw);
    });
    values.push(out);
  }

  const dataCols = spec.columns.filter((c) => !cfg.external?.[c.db]).map((c) => colOf[c.db]);
  // Formula columns of the first data row: copied into rows the engine adds below the block.
  const templateWidth = tab.formulas[cfg.firstDataRow - 1]?.length ?? 0;
  const templateFormulaCols = Array.from({ length: templateWidth }, (_, c) => c).filter((c) => isFormulaCell(tab, cfg.firstDataRow, c));

  return {
    spec,
    tab: spec.tab,
    virtual: { title: spec.tab, sheetId: tab.sheetId, values, locked },
    setup,
    colOf: (colId) => colOf[colId],
    cell(vrow, colId) {
      const r = rowOfV(vrow);
      if (cfg.external?.[colId]) return external(colId, r)?.cell;
      return colOf[colId] === undefined ? undefined : { tab: spec.tab, row: r, col: colOf[colId] };
    },
    externalCell(row, colId) {
      return cfg.external?.[colId] ? external(colId, row)?.cell : undefined;
    },
    encode(colId, value, fmt) {
      return cfg.transforms?.[colId] ? cfg.transforms[colId].write(value) : encodeRaw(value, fmt);
    },
    place(n) {
      const rows: number[] = [];
      for (let r = cfg.firstDataRow; rows.length < n && r <= last; r++) {
        if (dataCols.every((c) => isBlank(tab.values[r - 1]?.[c]))) rows.push(r);
      }
      for (let r = Math.max(last, cfg.firstDataRow - 1) + 1; rows.length < n; r++) rows.push(r);
      const formulaCopies = rows
        .filter((r) => templateFormulaCols.some((c) => !isFormulaCell(tab, r, c)))
        .map((r) => ({ fromRow: cfg.firstDataRow, toRow: r, cols: templateFormulaCols }));
      const extraWrites: Placement["extraWrites"] = [];
      if (cfg.numbered) {
        let no = 0;
        for (let r = cfg.firstDataRow; r <= last; r++) {
          const a = tab.values[r - 1]?.[0];
          if (typeof a === "number") no = Math.max(no, a);
        }
        for (const r of rows) if (isBlank(tab.values[r - 1]?.[0])) extraWrites.push({ row: r, col: 0, value: ++no });
      }
      const maxRow = Math.max(...rows);
      return { rows, formulaCopies, extraWrites, growTo: maxRow > tab.rowCount ? maxRow : undefined };
    },
  };
}

/** Cek BMI 2 Mingguan: one row per staff (data from row 6), periods side by side (Tgl Cek, Tinggi, Berat). */
function cekBmiLayout(spec: TableSpec, real: RealSnapshot): Projection {
  const title = spec.tab;
  const tab = real.tabs[title];
  if (!tab) return failed(spec, title, `Tab "${title}" tidak ditemukan di Google Sheet. Tabel ini tidak disinkronkan.`);
  const g = bmiGeometry(tab);
  if ("error" in g) return failed(spec, title, `Tab "${title}": ${g.error} Tabel ini tidak disinkronkan sampai header diperbaiki.`);

  const header = spec.columns.map((c) => c.header);
  const idx = Object.fromEntries(spec.columns.map((c, i) => [c.db, i]));
  const values: unknown[][] = [header];
  const locked = new Set<string>();
  const where = new Map<number, { row: number; period: number }>();
  const offsets: Record<string, number> = { check_date: 0, height_cm: 1, weight_kg: 2 };
  for (let r = g.firstDataRow; r <= lastRowOf(tab); r++) {
    const code = tab.values[r - 1]?.[g.keyCol];
    if (isBlank(code)) continue;
    g.periods.forEach((start, i) => {
      const v = values.length + 1;
      const out: unknown[] = new Array(header.length);
      out[idx.staff_code] = code;
      out[idx.period] = i + 1;
      locked.add(`${v}:${idx.staff_code}`);
      locked.add(`${v}:${idx.period}`);
      for (const [colId, off] of Object.entries(offsets)) {
        out[idx[colId]] = tab.values[r - 1]?.[start + off];
        if (isFormulaCell(tab, r, start + off)) locked.add(`${v}:${idx[colId]}`);
      }
      values.push(out);
      where.set(v, { row: r, period: i });
    });
  }

  return {
    spec,
    tab: title,
    virtual: { title, sheetId: tab.sheetId, values, locked },
    setup: [],
    cell(vrow, colId) {
      const w = where.get(vrow);
      if (!w || offsets[colId] === undefined) return undefined;
      return { tab: title, row: w.row, col: g.periods[w.period] + offsets[colId] };
    },
    encode: (_c, v, f) => encodeRaw(v, f),
  };
}

interface BmiGeometry {
  firstDataRow: number;
  keyCol: number;
  noteCol: number;
  /** "L/P" and "NIPP" (staff inputs kept in this tab), when present. */
  genderCol?: number;
  nippCol?: number;
  /** Start column (Tgl Cek) of each period. */
  periods: number[];
}

function bmiGeometry(tab: RealTab): BmiGeometry | { error: string } {
  const top = headerPositions(tab, 4);
  const sub = (tab.values[4] ?? []).map(normHeader);
  const keyCols = top.get(normHeader("ID SDM")) ?? [];
  const noteCols = top.get(normHeader("Catatan / Program Penyesuaian BB")) ?? [];
  const periods: number[] = [];
  sub.forEach((h, c) => {
    if (h === "tgl cek" && sub[c + 1] === "tinggi (cm)" && sub[c + 2] === "berat (kg)") periods.push(c);
  });
  if (keyCols.length !== 1) return { error: 'kolom "ID SDM" tidak ditemukan di baris 4.' };
  if (noteCols.length !== 1) return { error: 'kolom "Catatan / Program Penyesuaian BB" tidak ditemukan di baris 4.' };
  if (periods.length === 0) return { error: 'kolom "Tgl Cek / Tinggi (cm) / Berat (kg)" tidak ditemukan di baris 5.' };
  const one = (header: string) => {
    const hits = top.get(normHeader(header)) ?? [];
    return hits.length === 1 ? hits[0] : undefined;
  };
  return { firstDataRow: 6, keyCol: keyCols[0], noteCol: noteCols[0], genderCol: one("L/P"), nippCol: one("NIPP"), periods };
}

/** Parameter BMI: label in column B, value in column C (rows 5..), matched by label text. */
function parameterLayout(spec: TableSpec, real: RealSnapshot): Projection {
  const title = spec.tab;
  const tab = real.tabs[title];
  if (!tab) return failed(spec, title, `Tab "${title}" tidak ditemukan di Google Sheet. Tabel ini tidak disinkronkan.`);
  const top = headerPositions(tab, 4);
  const labelCols = top.get("parameter") ?? [];
  const valueCols = top.get("nilai") ?? [];
  if (labelCols.length !== 1 || valueCols.length !== 1) {
    return failed(spec, title, `Tab "${title}": kolom "Parameter" / "Nilai" tidak ditemukan di baris 4. Tabel ini tidak disinkronkan.`);
  }
  const [lc, vc] = [labelCols[0], valueCols[0]];
  const byLabel = new Map(spec.kv!.entries.map((e) => [normHeader(e.label), e.key]));
  const values: unknown[][] = [spec.columns.map((c) => c.header)];
  const locked = new Set<string>();
  const rowOfV = new Map<number, number>();
  for (let r = 5; r <= lastRowOf(tab); r++) {
    const key = byLabel.get(normHeader(tab.values[r - 1]?.[lc]));
    if (!key) continue;
    const v = values.length + 1;
    values.push([key, tab.values[r - 1]?.[vc]]);
    locked.add(`${v}:0`);
    if (isFormulaCell(tab, r, vc)) locked.add(`${v}:1`);
    rowOfV.set(v, r);
  }
  return {
    spec,
    tab: title,
    virtual: { title, sheetId: tab.sheetId, values, locked },
    setup: [],
    cell(vrow, colId) {
      const r = rowOfV.get(vrow);
      return r !== undefined && colId === "value" ? { tab: title, row: r, col: vc } : undefined;
    },
    encode: (_c, v, f) => encodeRaw(v, f),
  };
}

/** Engine-owned row-1 tab: virtual == real. */
function identityLayout(spec: TableSpec, real: RealSnapshot): Projection {
  const tab = real.tabs[spec.tab];
  const locked = new Set<string>();
  if (tab) {
    for (let r = 1; r <= lastRowOf(tab); r++) {
      const width = Math.max(tab.values[r - 1]?.length ?? 0, tab.formulas[r - 1]?.length ?? 0);
      for (let c = 0; c < width; c++) if (isFormulaCell(tab, r, c)) locked.add(`${r}:${c}`);
    }
  }
  return {
    spec,
    tab: spec.tab,
    identity: true,
    virtual: tab ? { title: tab.title, sheetId: tab.sheetId, values: tab.values, locked } : undefined,
    setup: [],
    cell: () => undefined,
    encode: (_c, v, f) => encodeRaw(v, f),
  };
}

/**
 * Staff inputs that live in tab Cek BMI (L/P, NIPP, BMI note). Located by position: Cek BMI row r + 1
 * is Tracker Staf row r (its ID SDM, Nama, Cabang, Stn are formulas reading that row), so new rows and
 * a first run before ID SDM is filled in work too. A row whose Cek BMI ID SDM shows another code is
 * out of step (rows inserted in one tab only): its cells are left alone.
 */
const BMI_TAB = "Cek BMI";

function bmiExternals(real: RealSnapshot): RowLayoutConfig["external"] {
  const bmiTab = real.tabs[BMI_TAB];
  const geo = bmiTab ? bmiGeometry(bmiTab) : undefined;
  const at = (col: (g: BmiGeometry) => number | undefined) => (code: Canon, row: number) => {
    if (!bmiTab || !geo || "error" in geo) return {};
    const r = row + geo.firstDataRow - 5;
    const shown = bmiTab.values[r - 1]?.[geo.keyCol];
    if (code !== null && !isBlank(shown) && String(shown) !== String(code)) return {};
    const c = col(geo);
    return c === undefined ? {} : { cell: { tab: bmiTab.title, row: r, col: c }, tab: bmiTab };
  };
  return {
    gender: at((g) => g.genderCol),
    nipp: at((g) => g.nippCol),
    bmi_note: at((g) => g.noteCol),
  };
}

export function project(spec: TableSpec, real: RealSnapshot): Projection {
  switch (spec.layout) {
    case "tracker-staf":
      return rowLayout(spec, real, { headerRow: 4, firstDataRow: 5, numbered: true, addable: ["code"], external: bmiExternals(real) });
    case "penggantian":
      return rowLayout(spec, real, { headerRow: 4, firstDataRow: 5, numbered: true, addable: ["id", "staff_code"] });
    case "rencana-aksi":
      return rowLayout(spec, real, { headerRow: 4, firstDataRow: 5, addable: ["id"], transforms: { progress: PERCENT } });
    case "laporan-bulanan":
      return rowLayout(spec, real, { headerRow: 4, firstDataRow: 5, transforms: { period: PERIOD } });
    case "cek-bmi":
      return cekBmiLayout(spec, real);
    case "parameter":
      return parameterLayout(spec, real);
    default:
      return identityLayout(spec, real);
  }
}

/** Real grid -> virtual snapshot for the merge, plus the projections needed to translate back. */
export function projectAll(real: RealSnapshot, specs: TableSpec[] = SYNC_TABLES) {
  const projections = new Map<SyncTable, Projection>();
  const sheet: SheetSnapshot = { tabs: {}, errors: {}, locale: real.locale, timeZone: real.timeZone };
  for (const spec of specs) {
    const p = project(spec, real);
    projections.set(spec.table, p);
    if (p.error) sheet.errors![spec.tab] = p.error;
    else if (p.virtual) sheet.tabs[spec.tab] = p.virtual;
  }
  return { sheet, projections };
}

/** Tabs the adapter must read (synced tabs + Cek BMI for the staff inputs kept there). */
export function tabsToRead(specs: TableSpec[] = SYNC_TABLES): string[] {
  const tabs = new Set(specs.map((s) => s.tab));
  if (specs.some((s) => s.layout === "tracker-staf")) tabs.add(BMI_TAB);
  return [...tabs];
}

// ------------------------------------------------------------------ plan -> real ops

export class LayoutViolation extends Error {}

/**
 * Translate a merge plan into real operations. Throws LayoutViolation (before anything is written)
 * if the plan would touch a formula cell, an untouched tab, or delete rows in a workbook tab.
 */
export function translate(
  plan: Plan,
  projections: Map<SyncTable, Projection>,
  real: RealSnapshot,
  opts: { skipTables?: Set<string> } = {},
): RealOps {
  const ops = emptyOps();
  for (const tp of plan.tables) {
    if (tp.error || opts.skipTables?.has(tp.table)) continue;
    const proj = projections.get(tp.table);
    if (!proj) continue;
    const spec = proj.spec;
    const table = tp.table;
    const s = tp.sheet;
    const colIdAt = (vcol: number) => (proj.identity ? Object.entries(s.colIndex).find(([, i]) => i === vcol)?.[0] : columnId(spec.columns[vcol]));

    if (proj.identity) {
      const fresh = s.create || s.writeHeader;
      if (fresh) ops.createTabs.push({ table, tab: s.tab, spec, header: s.header, minRows: s.appends.length + 200, exists: !s.create });
      for (const u of s.updates) ops.writes.push({ table, tab: s.tab, row: u.row, col: u.col, value: encodeRaw(u.value, u.fmt) });
      for (const w of s.idWrites) ops.writes.push({ table, tab: s.tab, row: w.row, col: w.col, value: null, ref: w.ref });
      for (const n of s.notes) ops.notes.push({ table, tab: s.tab, row: n.row, col: n.col, text: n.text });
      if (s.deleteRows.length) ops.deleteRows.push({ table, tab: s.tab, rows: [...s.deleteRows] });
      if (fresh) {
        s.appends.forEach((row, i) => row.forEach((c, col) => ops.writes.push({ table, tab: s.tab, row: i + 2, col, value: encodeRaw(c.value, c.fmt) })));
      } else if (s.appends.length) {
        ops.appends.push({ table, tab: s.tab, rows: s.appends.map((row) => row.map((c) => encodeRaw(c.value, c.fmt))) });
      }
      continue;
    }

    if (s.deleteRows.length) throw new LayoutViolation(`${table}: row deletes are not allowed in workbook tab "${proj.tab}".`);
    for (const h of proj.setup) ops.headerCells.push({ table, tab: proj.tab, ...h });
    for (const u of s.updates) {
      const colId = colIdAt(u.col)!;
      const cell = proj.cell(u.row, colId);
      if (cell) ops.writes.push({ table, ...cell, value: proj.encode(colId, u.value, u.fmt) });
    }
    for (const w of s.idWrites) {
      const cell = proj.cell(w.row, colIdAt(w.col)!);
      if (cell) ops.writes.push({ table, ...cell, value: null, ref: w.ref });
    }
    for (const n of s.notes) {
      const cell = proj.cell(n.row, colIdAt(n.col)!);
      if (cell) ops.notes.push({ table, ...cell, text: n.text });
    }
    if (s.appends.length) {
      if (!proj.place || !proj.colOf) throw new LayoutViolation(`${table}: no room for new rows in "${proj.tab}".`);
      const placement = proj.place(s.appends.length);
      s.appends.forEach((row, i) => {
        const r = placement.rows[i];
        row.forEach((c, vcol) => {
          const colId = colIdAt(vcol)!;
          if (c.value === null) return;
          const col = proj.colOf!(colId);
          if (col !== undefined) ops.writes.push({ table, tab: proj.tab, row: r, col, value: proj.encode(colId, c.value, c.fmt) });
          else {
            const ext = proj.externalCell?.(r, colId);
            if (ext) ops.writes.push({ table, ...ext, value: proj.encode(colId, c.value, c.fmt) });
          }
        });
      });
      for (const f of placement.formulaCopies) ops.formulaCopies.push({ table, tab: proj.tab, ...f });
      for (const w of placement.extraWrites) ops.writes.push({ table, tab: proj.tab, ...w });
      if (placement.growTo) ops.grow.push({ table, tab: proj.tab, rowCount: placement.growTo + 100 });
    }
  }

  // Safety: never an untouched tab, never a formula cell.
  for (const w of [...ops.writes, ...ops.notes, ...ops.headerCells]) {
    if (UNTOUCHED_TABS.includes(w.tab)) throw new LayoutViolation(`write to untouched tab "${w.tab}"`);
  }
  for (const w of ops.writes) {
    if (isFormulaCell(real.tabs[w.tab], w.row, w.col)) {
      throw new LayoutViolation(`write to a formula cell in "${w.tab}" (row ${w.row}, column ${w.col + 1})`);
    }
  }
  return ops;
}

/** Counts of real operations, for summaries. */
export function countOps(ops: RealOps) {
  return {
    createTabs: ops.createTabs.map((t) => t.tab),
    headerCells: ops.headerCells.length,
    cellWrites: ops.writes.length,
    formulaCopies: ops.formulaCopies.length,
    notes: ops.notes.length,
    rowDeletes: ops.deleteRows.reduce((n, d) => n + d.rows.length, 0),
    appends: ops.appends.reduce((n, a) => n + a.rows.length, 0),
    grow: ops.grow.length,
    tabsWritten: [...new Set([...ops.writes, ...ops.headerCells, ...ops.notes].map((w) => w.tab))],
  };
}
