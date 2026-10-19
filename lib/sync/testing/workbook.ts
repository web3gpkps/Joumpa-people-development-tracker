/**
 * An in-memory copy of the v2 workbook ("Tracker Tindak Lanjut People Development JOUMPA" + Cek BMI +
 * Parameter BMI): values + formulas + notes, built from DB rows, and a world that syncs it exactly like
 * the route: project -> merge -> translate -> apply. Mirrors the real sheet's structure (title rows,
 * header on row 4, formula columns, Cek BMI rows that follow Tracker Staf by position, spare rows,
 * pre-numbered Penggantian slots, Parameter labels, untouched tabs) with synthetic data only.
 *
 * Formulas are stored as text. The one shape the sync depends on, `=IF(<ref>="","",<ref>)` (Cek BMI's
 * ID SDM / Nama / Cabang / Stn pulled from Tracker Staf), is recalculated on every snapshot, like
 * Google Sheets would; other formula cells keep the value they were built with.
 */
import { periodLabel } from "../../pd-rules";
import { countOps, projectAll, translate, type RealOps, type RealSnapshot, type RealTab } from "../layouts";
import { finalizeBaseline, merge } from "../merge";
import { isoToSerial } from "../normalize";
import { a1Column } from "../sheets";
import { SETTINGS_ENTRIES, SYNC_TABLES } from "../tables";
import { FakeDb, type FakeDbOptions } from "./fakes";
import type { Baseline, ConflictPolicy, DbSnapshot, Plan, SyncTable, TableSpec } from "../types";

interface Cell {
  v: unknown;
  f?: string;
}

interface BookTab {
  sheetId: number;
  grid: (Cell | undefined)[][];
  notes: Map<string, string>;
  hiddenCols: Set<number>;
  rowCount: number;
}

/** "AK" -> 36 */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseA1(a1: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(a1)!;
  return { col: colIndex(m[1]), row: Number(m[2]) };
}

/** Shift the relative row numbers of a formula by `delta` rows (what PASTE_FORMULA does). */
export function shiftFormula(f: string, delta: number): string {
  return f.replace(/(\$?)(?<![A-Za-z])([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (_m, ca: string, col: string, ra: string, row: string) =>
    `${ca}${col}${ra}${ra ? row : Number(row) + delta}`,
  );
}

const REF = String.raw`(?:'([^']+)'!)?\$?([A-Z]+)\$?(\d+)`;
const IF_REF = new RegExp(String.raw`^=IF\(${REF}="","",${REF}\)$`);

export class FakeWorkbook {
  tabs = new Map<string, BookTab>();
  locale = "en_US";
  timeZone = "America/Los_Angeles";
  /** Every tab a write landed in (values, notes, headers, formulas, deletes, appends). */
  written = new Set<string>();
  private nextId = 1;

  /** A copy of a real snapshot (values + formulas), e.g. to replay a sync of the real sheet in memory. */
  static fromSnapshot(real: RealSnapshot): FakeWorkbook {
    const b = new FakeWorkbook();
    b.locale = real.locale ?? b.locale;
    b.timeZone = real.timeZone ?? b.timeZone;
    for (const [title, t] of Object.entries(real.tabs)) {
      if (!t) continue;
      b.addTab(title, t.rowCount);
      const rows = Math.max(t.values.length, t.formulas.length);
      for (let r = 1; r <= rows; r++) {
        const width = Math.max(t.values[r - 1]?.length ?? 0, t.formulas[r - 1]?.length ?? 0);
        for (let c = 0; c < width; c++) {
          const v = t.values[r - 1]?.[c];
          const f = t.formulas[r - 1]?.[c];
          const isF = typeof f === "string" && f.startsWith("=") && f !== v;
          if (isF || (v !== "" && v !== undefined && v !== null)) b.setAt(title, r, c, v, isF ? (f as string) : undefined);
        }
      }
    }
    return b;
  }

  addTab(title: string, rowCount = 1000) {
    this.tabs.set(title, { sheetId: this.nextId++, grid: [], notes: new Map(), hiddenCols: new Set(), rowCount });
    return this;
  }

  private tab(title: string) {
    const t = this.tabs.get(title);
    if (!t) throw new Error(`no tab ${title}`);
    return t;
  }

  /** Set a cell by A1 address. `undefined` clears it; `f` makes it a formula cell showing `v`. */
  set(title: string, a1: string, v: unknown, f?: string) {
    const { row, col } = parseA1(a1);
    this.setAt(title, row, col, v, f);
  }

  setAt(title: string, row: number, col: number, v: unknown, f?: string) {
    const t = this.tab(title);
    while (t.grid.length < row) t.grid.push([]);
    t.grid[row - 1] ??= [];
    t.grid[row - 1][col] = v === undefined && !f ? undefined : { v, f };
  }

  get(title: string, a1: string): unknown {
    const { row, col } = parseA1(a1);
    return this.tab(title).grid[row - 1]?.[col]?.v ?? "";
  }

  formula(title: string, a1: string): string | undefined {
    const { row, col } = parseA1(a1);
    return this.tab(title).grid[row - 1]?.[col]?.f;
  }

  note(title: string, a1: string): string | undefined {
    const { row, col } = parseA1(a1);
    return this.tab(title).notes.get(`${row}:${col}`);
  }

  hidden(title: string, letters: string): boolean {
    return this.tab(title).hiddenCols.has(colIndex(letters));
  }

  rowCount(title: string): number {
    return this.tab(title).rowCount;
  }

  setRowCount(title: string, n: number) {
    this.tab(title).rowCount = n;
  }

  /** First row (from `from`) whose column `letters` equals `value`. */
  findRow(title: string, letters: string, value: unknown, from = 1): number {
    this.recalc();
    const t = this.tab(title);
    const c = colIndex(letters);
    for (let r = from; r <= t.grid.length; r++) if (t.grid[r - 1]?.[c]?.v === value) return r;
    throw new Error(`${title}: no ${letters}=${String(value)}`);
  }

  /** Recalculate the `=IF(ref="","",ref)` formulas (twice, for refs to refs). */
  recalc() {
    for (let pass = 0; pass < 2; pass++) {
      for (const [title, t] of this.tabs) {
        t.grid.forEach((row) =>
          (row ?? []).forEach((cell) => {
            const m = cell?.f ? IF_REF.exec(cell.f) : null;
            if (!cell || !m || m[1] !== m[4] || m[2] !== m[5] || m[3] !== m[6]) return;
            const src = this.tabs.get(m[1] ?? title);
            const v = src?.grid[Number(m[3]) - 1]?.[colIndex(m[2])]?.v;
            cell.v = v === undefined || v === null ? "" : v;
          }),
        );
      }
    }
  }

  snapshot(): RealSnapshot {
    this.recalc();
    const tabs: RealSnapshot["tabs"] = {};
    for (const [title, t] of this.tabs) {
      const last = lastUsed(t.grid);
      const values = t.grid.slice(0, last).map((r) => trimRow((r ?? []).map((c) => (c ? (c.v ?? "") : ""))));
      const formulas = t.grid.slice(0, last).map((r) => trimRow((r ?? []).map((c) => (c ? (c.f ?? c.v ?? "") : ""))));
      const width = Math.max(26, ...formulas.map((r) => r.length));
      const tab: RealTab = { title, sheetId: t.sheetId, values, formulas, rowCount: t.rowCount, columnCount: width };
      tabs[title] = tab;
    }
    return { tabs, locale: this.locale, timeZone: this.timeZone };
  }

  /** Same order and semantics as GoogleSheets.apply. Refuses to overwrite a formula cell. */
  apply(ops: RealOps, ids: Map<number, number | string>, skip: Set<string> = new Set()) {
    const keep = <T extends { table: string }>(xs: T[]) => xs.filter((x) => !skip.has(x.table));
    this.locale = "in_ID";
    this.timeZone = "Asia/Jakarta";
    for (const c of keep(ops.createTabs)) {
      if (!c.exists) this.addTab(c.tab);
      const t = this.tab(c.tab);
      t.grid = [c.header.map((h) => ({ v: h }))];
      this.written.add(c.tab);
    }
    for (const h of keep(ops.headerCells)) {
      this.guard(h.tab, h.row, h.col);
      this.setAt(h.tab, h.row, h.col, h.text);
      if (h.hide) this.tab(h.tab).hiddenCols.add(h.col);
      this.written.add(h.tab);
    }
    for (const g of keep(ops.grow)) this.tab(g.tab).rowCount = Math.max(this.tab(g.tab).rowCount, g.rowCount);
    for (const w of keep(ops.writes)) {
      let value = w.value;
      if (w.ref !== undefined) {
        const id = ids.get(w.ref);
        if (id === undefined) continue;
        // Identity ids are numbers; pd_staff codes ("SUB-03") are text.
        value = typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id;
      }
      this.guard(w.tab, w.row, w.col);
      if (w.row > this.tab(w.tab).rowCount) throw new Error(`${w.tab}: row ${w.row} beyond grid`);
      this.setAt(w.tab, w.row, w.col, value === "" ? undefined : value);
      this.written.add(w.tab);
    }
    for (const f of keep(ops.formulaCopies)) {
      for (const c of f.cols) {
        const src = this.tab(f.tab).grid[f.fromRow - 1]?.[c]?.f;
        if (src) this.setAt(f.tab, f.toRow, c, "", shiftFormula(src, f.toRow - f.fromRow));
      }
      this.written.add(f.tab);
    }
    for (const n of keep(ops.notes)) {
      const t = this.tab(n.tab);
      if (n.text) t.notes.set(`${n.row}:${n.col}`, n.text);
      else t.notes.delete(`${n.row}:${n.col}`);
      this.written.add(n.tab);
    }
    for (const d of keep(ops.deleteRows)) {
      const t = this.tab(d.tab);
      for (const r of [...d.rows].sort((a, b) => b - a)) t.grid.splice(r - 1, 1);
      this.written.add(d.tab);
    }
    for (const a of keep(ops.appends)) {
      const t = this.tab(a.tab);
      t.grid.length = lastUsed(t.grid);
      for (const row of a.rows) t.grid.push(row.map((v) => (v === "" ? undefined : { v })));
      this.written.add(a.tab);
    }
    this.recalc();
  }

  private guard(tab: string, row: number, col: number) {
    const f = this.tabs.get(tab)?.grid[row - 1]?.[col]?.f;
    if (f) throw new Error(`write to formula cell ${tab}!${a1Column(col)}${row}`);
  }
}

function lastUsed(grid: (Cell | undefined)[][]): number {
  for (let i = grid.length - 1; i >= 0; i--) {
    if ((grid[i] ?? []).some((c) => c && (c.f || (c.v !== undefined && c.v !== "")))) return i + 1;
  }
  return 0;
}

function trimRow(row: unknown[]): unknown[] {
  const out = Array.from(row, (v) => (v === undefined ? "" : v));
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

// ------------------------------------------------------------------ builder

export const TABS = {
  staff: "Tracker Staf",
  bmi: "Cek BMI",
  params: "Parameter BMI",
  replacements: "Penggantian SDM",
  plans: "Rencana Aksi",
  monthly: "Laporan Bulanan",
} as const;

export const UNTOUCHED = ["Petunjuk", "Dashboard", "Referensi"] as const;

export const STAFF_HEADER = [
  "No", "Nama", "Cabang", "Stn", "Usulan", "Coaching awal", "Item coaching belum sesuai", "Praktik awal", "Tindakan utama",
  "Batas waktu", "PIC", "Status tindakan utama", "Tindakan tambahan / pemantauan khusus", "Batas tambahan",
  "Status tindakan tambahan", "Tgl penilaian ulang", "Praktik ulang (1–5)", "Coaching ulang", "Hasil penilaian ulang",
  "Keputusan akhir", "Catatan progres", "Flag",
];
export const REPLACEMENT_HEADER = [
  "No", "Nama", "Cabang", "Kategori", "Dasar usulan", "Batas tarik / keputusan", "Persetujuan Direksi", "Tgl ditarik / keputusan",
  "Status penarikan", "Nama pengganti", "Tgl seleksi", "Post-test pengganti", "Praktik pengganti", "Lulus training?",
  "Batas lulus training", "Tgl mulai bertugas", "Catatan", "Flag",
];
export const PLAN_HEADER = [
  "No", "Area", "Tindakan", "Cabang", "Sasaran / keterangan", "Batas waktu", "PIC", "Status", "% Progres", "Tgl selesai",
  "Bukti / dokumen", "Kendala / catatan", "Flag",
];
export const MONTHLY_HEADER = [
  "Cabang", "Periode", "Jatuh tempo laporan", "Tgl diterima", "Tepat waktu?", "Total staf aktif", "Staf berstatus Sesuai",
  "% Sesuai", "Capai target ≥ 90%?", "Keluhan sikap / komunikasi", "Semua direspons ≤ 1×24 jam?", "Indeks kepuasan JOUMPA", "Catatan",
];
export const BMI_SUMMARY = ["Tinggi Terakhir (cm)", "Berat Terakhir (kg)", "Δ Berat vs Cek Pertama (kg)", "BMI Terakhir", "Kategori Terakhir"];
export const BMI_NOTE = "Catatan / Program Penyesuaian BB";
/** Cek BMI: first column (Tgl Cek) of period p (1-based). */
export const bmiPeriodCol = (p: number) => 7 + (p - 1) * 5;

export interface WorkbookOptions {
  /** Blank Tracker Staf rows (formulas only) below the staff, mirrored in Cek BMI. */
  staffSpare?: number;
  /** Period blocks in Cek BMI. */
  bmiPeriods?: number;
  /** Pre-numbered rows in Penggantian SDM (at least one per replacement is used). */
  replacementSlots?: number;
  /** Blank Rencana Aksi rows (Flag formula only) below the plans. */
  planSpare?: number;
  /** Laporan Bulanan: periods ("2026-11-01") pre-filled with one key-only row per Cabang. */
  monthlySlots?: string[];
  /** Blank Laporan Bulanan rows (formulas only) below the reports. */
  monthlySpare?: number;
  /** The engine's id columns already exist and are filled (Tracker Staf W, Penggantian S/T, Rencana Aksi N). */
  withIds?: boolean;
}

const serial = (iso: unknown) => (typeof iso === "string" && iso ? isoToSerial(iso) : undefined);
type Row = Record<string, unknown>;
const GROUPS = ["CGK & HLP", "DPS", "SUB", "KNO", "BPN"];
const byOrder = (a: Row, b: Row) => Number(a.sort_order ?? a.id ?? 0) - Number(b.sort_order ?? b.id ?? 0);

function titled(b: FakeWorkbook, title: string, subtitle: string, rowCount = 1000) {
  b.addTab(title, rowCount);
  b.set(title, "A1", title.toUpperCase());
  b.set(title, "A2", subtitle);
}

/** Write `v` at (row, col) unless it is null/undefined; dates (ISO) become serials when `date`. */
function put(b: FakeWorkbook, tab: string, row: number, col: number, v: unknown, date = false) {
  if (v === null || v === undefined || v === "") return;
  b.setAt(tab, row, col, date ? serial(v) : v);
}

/** The workbook as imported: same data as the DB, native layout. */
export function buildWorkbook(db: DbSnapshot, opts: WorkbookOptions = {}): FakeWorkbook {
  const { staffSpare = 3, bmiPeriods = 5, replacementSlots = 4, planSpare = 2, monthlySlots = [], monthlySpare = 2, withIds = false } = opts;
  const b = new FakeWorkbook();
  const settings = ((db.pd_settings ?? [])[0] ?? {}) as Row;

  // ---- untouched tabs
  b.addTab("Petunjuk");
  b.set("Petunjuk", "A1", "PETUNJUK PENGISIAN");
  b.set("Petunjuk", "A3", "Isi kolom putih saja; kolom abu-abu berisi rumus.");
  b.addTab("Dashboard");
  b.set("Dashboard", "A1", "DASHBOARD");
  b.set("Dashboard", "A5", "Tindakan selesai");
  b.set("Dashboard", "B5", 0, `=COUNTIF('Tracker Staf'!L5:L200,"Selesai")`);
  b.set("Dashboard", "A6", "Rencana aksi terlambat");
  b.set("Dashboard", "B6", 0, `=COUNTIF('Rencana Aksi'!M5:M200,"Terlambat")`);
  b.addTab("Referensi");
  b.set("Referensi", "A1", "REFERENSI");
  b.set("Referensi", "A4", "Status");
  ["Belum Mulai", "Proses", "Selesai", "Batal / N.A."].forEach((s, i) => b.setAt("Referensi", 5 + i, 0, s));
  b.set("Referensi", "B4", 4, "=COUNTA(A5:A20)");

  // ---- Parameter BMI: label B, value C (rows 5..), headings and a TODAY() row in between
  const PB = TABS.params;
  titled(b, PB, "Parameter cek BMI");
  b.set(PB, "B4", "Parameter");
  b.set(PB, "C4", "Nilai");
  b.set(PB, "D4", "Keterangan");
  const paramRows: (string | null)[] = [
    "bmi_first_check", "bmi_interval_days", "bmi_periods", "#Klasifikasi BMI", "bmi_underweight_below", "bmi_normal_max",
    "bmi_overweight_max", "#Syarat tinggi badan", "min_height_female", "min_height_male", null,
  ];
  paramRows.forEach((key, i) => {
    const r = 5 + i;
    if (key === null) return;
    if (key.startsWith("#")) return b.set(PB, `B${r}`, key.slice(1));
    const e = SETTINGS_ENTRIES.find((x) => x.key === key)!;
    b.set(PB, `B${r}`, e.label);
    put(b, PB, r, 2, settings[key], e.type.kind === "date");
  });
  const todayRow = 5 + paramRows.length;
  b.set(PB, `B${todayRow}`, "Tanggal acuan (hari ini)");
  b.set(PB, `C${todayRow}`, isoToSerial("2026-10-19"), "=TODAY()");

  // ---- Tracker Staf (header row 4, data 5..; W = ID SDM, added by the engine unless withIds)
  const TS = TABS.staff;
  titled(b, TS, "Tindak lanjut per staf");
  STAFF_HEADER.forEach((h, c) => b.setAt(TS, 4, c, h));
  if (withIds) b.set(TS, "W4", "ID SDM");
  const staff = [...((db.pd_staff ?? []) as Row[])].sort(byOrder);
  const staffRows = staff.length + staffSpare;
  for (let i = 0; i < staffRows; i++) {
    const r = 5 + i;
    const s = staff[i];
    b.set(TS, `S${r}`, s && typeof s.reassess_practice === "number" ? (s.reassess_practice >= 4 ? "Sesuai" : "Tidak Sesuai → usulan ganti") : "",
      `=IF(Q${r}="","",IF(Q${r}>=4,"Sesuai","Tidak Sesuai → usulan ganti"))`);
    b.set(TS, `V${r}`, s ? "On track" : "", `=IF(B${r}="","",IF(AND(L${r}="Selesai",OR(O${r}="",O${r}="Selesai")),"Selesai","On track"))`);
    if (!s) continue;
    b.set(TS, `A${r}`, i + 1);
    const cols: [string, unknown, boolean?][] = [
      ["B", s.name], ["C", s.report_group], ["D", s.station], ["E", s.proposal], ["F", s.initial_coaching], ["G", s.coaching_items],
      // The workbook shows "–" where there is no initial practice score.
      ["H", s.initial_practice ?? "–"], ["I", s.main_action], ["J", s.main_due, true], ["K", s.pic], ["L", s.main_status],
      ["M", s.extra_action], ["N", s.extra_due, true], ["O", s.extra_status], ["P", s.reassessed_on, true], ["Q", s.reassess_practice],
      ["R", s.recoaching], ["T", s.final_decision], ["U", s.progress_notes],
    ];
    if (withIds) cols.push(["W", s.code]);
    for (const [c, v, isDate] of cols) put(b, TS, r, colIndex(c), v, isDate);
  }

  // ---- Cek BMI (rows 4-5 headers, data from 6; row 6 <-> Tracker Staf row 5)
  const CB = TABS.bmi;
  titled(b, CB, "Cek BMI per periode");
  ["No", "ID SDM", "Nama", "Cabang", "Stn", "L/P", "NIPP"].forEach((h, c) => b.setAt(CB, 4, c, h));
  for (let p = 1; p <= bmiPeriods; p++) {
    const start = bmiPeriodCol(p);
    b.setAt(CB, 4, start, `Cek ke-${p} (rencana)`, `="Cek ke-${p} (rencana "&TEXT('Parameter BMI'!$C$5+${(p - 1) * 14},"dd/mm/yyyy")&")"`);
    ["Tgl Cek", "Tinggi (cm)", "Berat (kg)", "BMI", "Kategori"].forEach((h, k) => b.setAt(CB, 5, start + k, h));
  }
  const summaryStart = bmiPeriodCol(bmiPeriods + 1);
  BMI_SUMMARY.forEach((h, k) => b.setAt(CB, 4, summaryStart + k, h));
  const noteCol = summaryStart + BMI_SUMMARY.length;
  b.setAt(CB, 4, noteCol, BMI_NOTE);
  const checks = (db.pd_bmi_checks ?? []) as Row[];
  for (let i = 0; i < staffRows; i++) {
    const t = 5 + i;
    const r = t + 1;
    const s = staff[i];
    b.setAt(CB, r, 0, i + 1);
    const pull = (col: number, from: string) => b.setAt(CB, r, col, "", `=IF('Tracker Staf'!$${from}${t}="","",'Tracker Staf'!$${from}${t})`);
    pull(1, "W");
    pull(2, "B");
    pull(3, "C");
    pull(4, "D");
    for (let p = 1; p <= bmiPeriods; p++) {
      const start = bmiPeriodCol(p);
      const [h, w, bmi] = [a1Column(start + 1), a1Column(start + 2), a1Column(start + 3)];
      const c = s && checks.find((x) => x.staff_code === s.code && x.period === p);
      if (c) {
        put(b, CB, r, start, c.check_date, true);
        put(b, CB, r, start + 1, c.height_cm);
        put(b, CB, r, start + 2, c.weight_kg);
      }
      const bmiValue = c ? Math.round((Number(c.weight_kg) / (Number(c.height_cm) / 100) ** 2) * 10) / 10 : "";
      b.setAt(CB, r, start + 3, bmiValue, `=IF(OR(${h}${r}="",${w}${r}=""),"",ROUND(${w}${r}/(${h}${r}/100)^2,1))`);
      b.setAt(CB, r, start + 4, c ? "Normal" : "", `=IF(${bmi}${r}="","",IF(${bmi}${r}<'Parameter BMI'!$C$9,"Kurus","Normal"))`);
    }
    BMI_SUMMARY.forEach((_, k) => b.setAt(CB, r, summaryStart + k, "", `=IFERROR(LOOKUP(2,1/(${a1Column(bmiPeriodCol(1) + 1)}${r}<>""),${a1Column(bmiPeriodCol(1) + 1)}${r}),"")`));
    if (s) {
      put(b, CB, r, 5, s.gender);
      put(b, CB, r, 6, s.nipp);
      put(b, CB, r, noteCol, s.bmi_note);
    }
  }

  // ---- Penggantian SDM (header row 4, pre-numbered rows 5..; S = ID Sistem (hidden), T = ID SDM)
  const PG = TABS.replacements;
  titled(b, PG, "Penggantian dan penarikan SDM");
  REPLACEMENT_HEADER.forEach((h, c) => b.setAt(PG, 4, c, h));
  if (withIds) {
    b.set(PG, "S4", "ID Sistem");
    b.set(PG, "T4", "ID SDM");
  }
  const reps = [...((db.pd_replacements ?? []) as Row[])].sort(byOrder);
  for (let i = 0; i < Math.max(replacementSlots, reps.length); i++) {
    const r = 5 + i;
    b.set(PG, `A${r}`, i + 1);
    b.set(PG, `N${r}`, "", `=IF(OR(L${r}="",M${r}=""),"",IF(AND(L${r}>=80,M${r}>=4),"Lulus","Belum lulus"))`);
    b.set(PG, `R${r}`, "", `=IF(B${r}="","",IF(I${r}="Selesai","Selesai","On track"))`);
    const x = reps[i];
    if (!x) continue;
    b.set(PG, `R${r}`, "On track", b.formula(PG, `R${r}`));
    const cols: [string, unknown, boolean?][] = [
      ["B", x.name], ["C", x.report_group], ["D", x.category], ["E", x.basis], ["F", x.withdraw_due, true], ["G", x.director_approval],
      ["H", x.withdrawn_on, true], ["I", x.withdraw_status], ["J", x.replacement_name], ["K", x.selected_on, true], ["L", x.post_test],
      ["M", x.practice], ["O", x.training_due, true], ["P", x.started_on, true], ["Q", x.notes],
    ];
    if (withIds) cols.push(["S", x.id], ["T", x.staff_code]);
    for (const [c, v, isDate] of cols) put(b, PG, r, colIndex(c), v, isDate);
  }
  if (withIds) b.tabs.get(PG)!.hiddenCols.add(colIndex("S"));

  // ---- Rencana Aksi (header row 4, rows 5..; No is a text data column; N = ID Sistem (hidden))
  const RA = TABS.plans;
  titled(b, RA, "Rencana aksi per cabang");
  PLAN_HEADER.forEach((h, c) => b.setAt(RA, 4, c, h));
  if (withIds) b.set(RA, "N4", "ID Sistem");
  const plans = ((db.pd_action_plans ?? []) as Row[]).filter((p) => !p.archived_at).sort(byOrder);
  for (let i = 0; i < plans.length + planSpare; i++) {
    const r = 5 + i;
    const p = plans[i];
    b.set(RA, `M${r}`, p ? "On track" : "", `=IF(C${r}="","",IF(H${r}="Selesai","Selesai",IF(AND(F${r}<>"",F${r}<'Parameter BMI'!$C$${todayRow}),"Terlambat","On track")))`);
    if (!p) continue;
    // A number-looking "No" is typed as a number in the workbook.
    const no = typeof p.item_no === "string" && /^\d+$/.test(p.item_no) ? Number(p.item_no) : p.item_no;
    const cols: [string, unknown, boolean?][] = [
      ["A", no], ["B", p.area], ["C", p.action], ["D", p.report_group], ["E", p.target], ["F", p.due_date, true], ["G", p.pic],
      ["H", p.status], ["I", typeof p.progress === "number" ? p.progress / 100 : p.progress], ["J", p.done_on, true],
      ["K", p.evidence], ["L", p.notes],
    ];
    if (withIds) cols.push(["N", p.id]);
    for (const [c, v, isDate] of cols) put(b, RA, r, colIndex(c), v, isDate);
  }
  if (withIds) b.tabs.get(RA)!.hiddenCols.add(colIndex("N"));

  // ---- Laporan Bulanan (header row 4, rows 5..; Periode as "Okt 2026" text)
  const LB = TABS.monthly;
  titled(b, LB, "Laporan bulanan cabang");
  MONTHLY_HEADER.forEach((h, c) => b.setAt(LB, 4, c, h));
  const rank = (g: unknown) => (GROUPS.includes(String(g)) ? GROUPS.indexOf(String(g)) : 50);
  const reports = [...((db.pd_monthly_reports ?? []) as Row[])].sort(
    (x, y) => String(x.period).localeCompare(String(y.period)) || rank(x.report_group) - rank(y.report_group),
  );
  const slots = monthlySlots.flatMap((period) => GROUPS.map((report_group) => ({ report_group, period }) as Row));
  const monthlyRows = [...reports, ...slots];
  for (let i = 0; i < monthlyRows.length + monthlySpare; i++) {
    const r = 5 + i;
    b.set(LB, `E${r}`, "", `=IF(D${r}="",IF(AND(C${r}<>"",'Parameter BMI'!$C$${todayRow}>C${r}),"Terlambat",""),IF(D${r}<=C${r},"Ya","Terlambat"))`);
    b.set(LB, `H${r}`, "", `=IF(OR(F${r}="",F${r}=0,G${r}=""),"",G${r}/F${r})`);
    b.set(LB, `I${r}`, "", `=IF(H${r}="","",IF(H${r}>=0.9,"Ya","Belum"))`);
    const m = monthlyRows[i];
    if (!m) continue;
    const cols: [string, unknown, boolean?][] = [
      ["A", m.report_group], ["B", periodLabel(String(m.period))], ["C", m.due_on, true], ["D", m.received_on, true], ["F", m.active_staff],
      ["G", m.compliant_staff], ["J", m.complaints], ["K", m.responded], ["L", m.satisfaction], ["M", m.notes],
    ];
    for (const [c, v, isDate] of cols) put(b, LB, r, colIndex(c), v, isDate);
    if (typeof m.active_staff === "number" && typeof m.compliant_staff === "number" && m.active_staff > 0) {
      b.set(LB, `H${r}`, m.compliant_staff / m.active_staff, b.formula(LB, `H${r}`));
    }
  }
  b.recalc();
  return b;
}

// ------------------------------------------------------------------ world

export class WorkbookWorld {
  book: FakeWorkbook;
  db: FakeDb;
  baseline: Baseline | null = null;
  specs: TableSpec[] = SYNC_TABLES;

  constructor(db: DbSnapshot, opts: WorkbookOptions & { book?: FakeWorkbook; dbOptions?: FakeDbOptions } = {}) {
    this.db = new FakeDb(db, opts.dbOptions);
    this.book = opts.book ?? buildWorkbook(db, opts);
  }

  prepare(opts: { conflictPolicy?: ConflictPolicy; allowMassDelete?: SyncTable[] } = {}) {
    const real = this.book.snapshot();
    const { sheet, projections } = projectAll(real, this.specs);
    const plan: Plan = merge({ baseline: this.baseline, sheet, db: this.db.snapshot(this.specs), specs: this.specs, ...opts });
    const ops = translate(plan, projections, real);
    return { plan, ops, counts: countOps(ops) };
  }

  sync(opts: { conflictPolicy?: ConflictPolicy; allowMassDelete?: SyncTable[] } = {}) {
    const prepared = this.prepare(opts);
    const ids = this.db.apply(prepared.plan, this.specs);
    this.book.apply(prepared.ops, ids);
    this.baseline = finalizeBaseline(prepared.plan, ids, this.specs);
    return prepared;
  }
}
