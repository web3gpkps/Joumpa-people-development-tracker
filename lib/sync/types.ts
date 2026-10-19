/** Shared types for the Supabase <-> Google Sheets replication engine. */

/** Canonical cell value: what both sides are compared as. Dates are ISO `YYYY-MM-DD` strings. */
export type Canon = string | number | null;
export type CanonRow = Record<string, Canon>;

export type ConflictPolicy = "db-wins" | "sheet-wins";
export const DEFAULT_CONFLICT_POLICY: ConflictPolicy = "db-wins";

/** v2 tables (database names). */
export type SyncTable =
  | "pd_settings"
  | "pd_staff"
  | "pd_bmi_checks"
  | "pd_replacements"
  | "pd_action_plans"
  | "pd_monthly_reports";

export type ColumnType =
  | { kind: "text" }
  | { kind: "int"; min?: number; max?: number }
  | { kind: "numeric"; scale: number; min?: number; max?: number }
  | { kind: "date" }
  | { kind: "enum"; values: readonly string[] }
  /** Station code (`^[A-Z0-9]{2,5}$`, typed in any case); must exist in `stations`. `kps` also allows "KPS". */
  | { kind: "station"; kps?: boolean }
  /** Report group ("SUB", "CGK & HLP", ...); must be the report_group of some station in `stations`. */
  | { kind: "report-group" }
  /** Rencana Aksi area; must be a name in `pd_areas` (any case is accepted and written back as stored). */
  | { kind: "area" };

/** A column whose value is stored in the database and synced both ways. */
export interface DataColumn {
  kind: "data";
  /** Database column name. */
  db: string;
  /** Header label (row-1 tabs), or the workbook header text a native layout matches on. */
  header: string;
  type: ColumnType;
  /** NOT NULL in the database: the sheet may not clear it. */
  required?: boolean;
  /** Used when a new sheet row leaves a required column empty (mirrors the DB default). */
  defaultValue?: Canon;
  hidden?: boolean;
}

export type Column = DataColumn;

export interface KvEntry {
  key: string;
  label: string;
  type: ColumnType;
  required?: boolean;
}

/** Workbook layouts the sheet adapter knows (lib/sync/layouts.ts). Absent = engine-owned row-1 tab. */
export type NativeLayout = "tracker-staf" | "cek-bmi" | "penggantian" | "rencana-aksi" | "laporan-bulanan" | "parameter";

export interface TableSpec {
  table: SyncTable;
  /** Tab title (for native layouts: the workbook tab the rows live in). */
  tab: string;
  layout?: NativeLayout;
  /** Key columns (database names). Composite keys are joined with `|` into a row key. */
  key: string[];
  /** Key assigned by the database (identity); new sheet rows have it empty until written back. */
  generatedKey?: boolean;
  /** Ordered sheet layout. */
  columns: Column[];
  /** A sheet row whose non-key data cells are all empty counts as absent (a slot, not a record). */
  emptyRowIsAbsent?: boolean;
  /** With emptyRowIsAbsent: only these columns decide presence (e.g. staff: no name = absent). */
  absentUnless?: string[];
  /**
   * Where a DB row with no sheet row goes: "end" appends (default), "blank-row" lets the layout pick a
   * free pre-formatted row, "none" means the layout has no room: the row is reported, not placed.
   */
  appendMode?: "end" | "blank-row" | "none";
  /** Issue text when appendMode is "none" and there is no row for a DB record. */
  noRowMessage?: string;
  /** Sheet-side delete: remove the row (default) or clear its input cells (fixed workbook layouts). */
  deleteMode?: "row" | "clear";
  /** Key/value table (settings): rows are fixed, never inserted or deleted. */
  kv?: { entries: KvEntry[]; validate?: (values: Record<string, Canon>) => string | null };
  /** Child table: `column` must reference an existing key of `table`. DB deletes cascade. */
  parent?: { column: string; table: SyncTable };
  /** Nullable references (FK ON DELETE SET NULL): a sheet value must name an existing row of `table`. */
  refs?: { column: string; table: SyncTable }[];
  /** Generated-key tables: match id-less sheet rows to unknown DB rows by these columns. */
  adoptBy?: string[];
  /**
   * Rows with this timestamp column set are archived: absent from the sync (and the sheet); a delete
   * coming from the sheet archives the row instead of deleting it (Rencana Aksi).
   */
  archiveColumn?: string;
}

// ---------- inputs ----------

export interface SheetTab {
  title: string;
  sheetId: number;
  /** Row-major values as returned by values.batchGet (UNFORMATTED_VALUE, SERIAL_NUMBER dates). Row 1 = header. */
  values: unknown[][];
  /** Cells ("row:col", 1-based row, 0-based col) holding a formula: never read as input, never written. */
  locked?: Set<string>;
}

export interface SheetSnapshot {
  /** Keyed by tab title. A missing entry means the tab does not exist. */
  tabs: Record<string, SheetTab | undefined>;
  /** Layout problems per tab: a hard error for that table (nothing read or written). */
  errors?: Record<string, string>;
  locale?: string;
  timeZone?: string;
}

/** Raw rows per table as returned by the database. `settings` is the single settings row. */
/**
 * Raw rows per table as returned by the database. `stations` (not synced) lists the valid station codes
 * and report groups that station / report-group columns are checked against.
 */
export type DbSnapshot = Partial<Record<SyncTable, Record<string, unknown>[]>> & {
  stations?: { code: string; report_group: string }[];
  /** pd_areas names, for `area` columns. */
  areas?: string[];
};

export interface Baseline {
  v: 1;
  tables: Partial<Record<SyncTable, Record<string, CanonRow>>>;
  /** Open sheet issues (validation errors etc.) by issue id -> signature; used to dedupe logs and notes. */
  issues?: Record<string, string>;
}

// ---------- outputs ----------

export type CellFormat = "text" | "number" | "date";

export interface CellWrite {
  /** 1-based sheet row. */
  row: number;
  /** 0-based column index. */
  col: number;
  value: Canon;
  fmt: CellFormat;
}

export interface AppendCell {
  value: Canon;
  fmt: CellFormat;
}

export interface NoteWrite {
  row: number;
  col: number;
  /** Empty string clears the note. */
  text: string;
}

export interface SheetOps {
  tab: string;
  sheetId: number | null;
  /** Tab does not exist: create it. */
  create: boolean;
  /** Write header row, freeze, protections, validation, formats (new or blank tab). */
  writeHeader: boolean;
  /** Header labels in sheet order (the layout when writeHeader, else the current header row). */
  header: string[];
  /** Column id (db name) -> 0-based column index in the sheet. */
  colIndex: Record<string, number>;
  updates: CellWrite[];
  /** Full rows in sheet column order. */
  appends: AppendCell[][];
  /** 1-based row numbers to delete (descending). */
  deleteRows: number[];
  notes: NoteWrite[];
  /** Write the database-assigned id of pending insert `ref` into this cell. */
  idWrites: { ref: number; row: number; col: number }[];
}

export interface DbOps {
  /** Full new rows, keyed naturally (upsert on the key). */
  inserts: CanonRow[];
  /** Changed columns only. `key` holds the key columns. */
  updates: { key: CanonRow; set: CanonRow }[];
  /** Key columns of rows to delete. */
  deletes: CanonRow[];
  /** Generated-key inserts; the adapter returns the new id per `ref`. */
  pending: { ref: number; values: CanonRow }[];
}

export type Resolution = ConflictPolicy;

export interface ConflictRecord {
  table: SyncTable;
  rowKey: string;
  /** Database column name, or null for a whole-row delete-vs-edit conflict. */
  column: string | null;
  baseline: Canon | CanonRow | null;
  sheet: Canon | CanonRow | null;
  db: Canon | CanonRow | null;
  resolution: Resolution;
}

export type IssueKind =
  | "invalid_value"
  | "required_missing"
  | "duplicate_key"
  | "missing_key"
  | "unknown_parent"
  | "unknown_setting"
  | "deletes_skipped"
  | "header_error"
  | "no_sheet_row"
  | "incomplete_row";

export interface Issue {
  id: string;
  kind: IssueKind;
  table: SyncTable;
  rowKey: string | null;
  column: string | null;
  message: string;
  /** Offending sheet value (for the log), if any. */
  sheetValue?: unknown;
  dbValue?: Canon;
  /** Where the offending cell is (1-based row, 0-based column). */
  at?: { row: number; col: number };
  /** Cell that gets (or keeps) the note; unset when the cell is overwritten this run. */
  cell?: { row: number; col: number };
  /** First time seen (not in the previous baseline's issue set): log it and set the note. */
  isNew: boolean;
}

export interface TablePlan {
  table: SyncTable;
  tab: string;
  /** Hard error: nothing is read from or written to this table this run. */
  error: string | null;
  db: DbOps;
  sheet: SheetOps;
  conflicts: ConflictRecord[];
  issues: Issue[];
}

export interface Plan {
  tables: TablePlan[];
  /** Baseline to store after a successful apply (pending inserts are added by finalizeBaseline). */
  baseline: Baseline;
  /** Baseline rows for pending inserts, keyed by ref; the row key is the id the DB returns. */
  pendingBaseline: { table: SyncTable; ref: number; values: CanonRow }[];
}
