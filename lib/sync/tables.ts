/**
 * Which tables are replicated where. The replica is the workbook "Tracker Tindak Lanjut People
 * Development JOUMPA" plus two tabs the setup adds (Cek BMI, Parameter BMI); every table lives in a
 * native tab (header on row 4, data from row 5; lib/sync/layouts.ts reads/writes them).
 *
 * Headers are the workbook's own texts (whitespace-insensitive), so a renamed header is detected.
 * Columns not listed here are never read or written: workbook formulas (Hasil penilaian ulang,
 * Lulus training?, Tepat waktu?, % Sesuai, Flag, BMI, Kategori, ...), and DB-only columns
 * (sort_order, archived_at, created_at, updated_at, updated_by_*).
 *
 * Never synced: pd_share_links, pd_areas (checked against), pd_sync_*, and v1's tables.
 */
import { MAX_BMI_INTERVAL_DAYS, MAX_BMI_PERIODS } from "../bmi-periods";
import {
  COACHING_STATUSES,
  FINAL_DECISIONS,
  PROPOSALS,
  REPLACEMENT_CATEGORIES,
  STATUSES,
  YA_BELUM_TIDAK,
} from "../pd-rules";
import type { Canon, Column, ColumnType, DataColumn, KvEntry, SyncTable, TableSpec } from "./types";

export const GENDERS = ["L", "P"] as const;

const text = (): ColumnType => ({ kind: "text" });
const int = (min?: number, max?: number): ColumnType => ({ kind: "int", min, max });
const num = (scale: number, min?: number, max?: number): ColumnType => ({ kind: "numeric", scale, min, max });
const date: ColumnType = { kind: "date" };
const oneOf = (values: readonly string[]): ColumnType => ({ kind: "enum", values });
// Checked against public.stations / pd_areas at run time (lib/sync/merge.ts normSheet).
const station: ColumnType = { kind: "station" };
const reportGroup: ColumnType = { kind: "report-group" };
const area: ColumnType = { kind: "area" };

function d(db: string, header: string, type: ColumnType, extra: Partial<DataColumn> = {}): DataColumn {
  return { kind: "data", db, header, type, ...extra };
}

/** Parameter BMI rows, matched by the label in column B. */
export const SETTINGS_ENTRIES: KvEntry[] = [
  { key: "bmi_first_check", label: "Tanggal cek BMI periode 1", type: date, required: true },
  { key: "bmi_interval_days", label: "Interval cek BMI (hari)", type: int(1, MAX_BMI_INTERVAL_DAYS), required: true },
  { key: "bmi_periods", label: "Jumlah periode cek BMI", type: int(1, MAX_BMI_PERIODS), required: true },
  { key: "bmi_underweight_below", label: "BMI kategori Kurus jika <", type: num(2, 1, 100), required: true },
  { key: "bmi_normal_max", label: "BMI Normal s.d.", type: num(2, 1, 100), required: true },
  { key: "bmi_overweight_max", label: "BMI Overweight s.d. (di atasnya Obesitas)", type: num(2, 1, 100), required: true },
  { key: "min_height_female", label: "Tinggi minimal petugas Perempuan (cm)", type: num(1, 120, 210) },
  { key: "min_height_male", label: "Tinggi minimal petugas Laki-laki (cm)", type: num(1, 120, 210) },
];

/** Cross-field CHECK on public.pd_settings; a violating sheet edit would fail the whole DB write. */
function validateSettings(v: Record<string, Canon>): string | null {
  const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : null);
  const [under, normal, over] = [n("bmi_underweight_below"), n("bmi_normal_max"), n("bmi_overweight_max")];
  if (under !== null && normal !== null && over !== null && !(under <= normal && normal <= over)) {
    return "Batas BMI harus berurutan: Kurus < ≤ Normal s.d. ≤ Overweight s.d.";
  }
  return null;
}

const settings: TableSpec = {
  table: "pd_settings",
  tab: "Parameter BMI",
  layout: "parameter",
  key: ["key"],
  kv: { entries: SETTINGS_ENTRIES, validate: validateSettings },
  appendMode: "none",
  noRowMessage: "Baris parameter ini tidak ditemukan di tab Parameter BMI (kolom B). Nilai database dipertahankan.",
  columns: [d("key", "Parameter", text()), d("value", "Nilai", text())],
};

/**
 * Tracker Staf (one row per person). `ID SDM` is added by the setup (column W); a person typed in
 * without one gets the station's next code from the database, written back. L/P, NIPP and the BMI
 * note live in tab Cek BMI, on the row showing this person's ID SDM.
 */
const staff: TableSpec = {
  table: "pd_staff",
  tab: "Tracker Staf",
  layout: "tracker-staf",
  key: ["code"],
  generatedKey: true,
  adoptBy: ["station", "name"],
  emptyRowIsAbsent: true,
  absentUnless: ["name"],
  appendMode: "blank-row",
  deleteMode: "clear",
  columns: [
    d("code", "ID SDM", text()),
    d("name", "Nama", text(), { required: true }),
    // Always the station's report group in the DB (trigger); a different sheet value is put back.
    d("report_group", "Cabang", reportGroup),
    d("station", "Stn", station, { required: true }),
    d("proposal", "Usulan", oneOf(PROPOSALS)),
    d("initial_coaching", "Coaching awal", text()),
    d("coaching_items", "Item coaching belum sesuai", text()),
    d("initial_practice", "Praktik awal", num(2, 1, 5)),
    d("main_action", "Tindakan utama", text()),
    d("main_due", "Batas waktu", date),
    d("pic", "PIC", text()),
    d("main_status", "Status tindakan utama", oneOf(STATUSES)),
    d("extra_action", "Tindakan tambahan / pemantauan khusus", text()),
    d("extra_due", "Batas tambahan", date),
    d("extra_status", "Status tindakan tambahan", oneOf(STATUSES)),
    d("reassessed_on", "Tgl penilaian ulang", date),
    d("reassess_practice", "Praktik ulang (1–5)", num(2, 1, 5)),
    d("recoaching", "Coaching ulang", oneOf(COACHING_STATUSES)),
    d("final_decision", "Keputusan akhir", oneOf(FINAL_DECISIONS)),
    d("progress_notes", "Catatan progres", text()),
    // In tab "Cek BMI", on the row whose ID SDM matches.
    d("gender", "L/P", oneOf(GENDERS)),
    d("nipp", "NIPP", text()),
    d("bmi_note", "Catatan / Program Penyesuaian BB", text()),
  ],
};

/** Wide in the workbook (one row per staff, periods side by side); long in the DB. */
const bmiChecks: TableSpec = {
  table: "pd_bmi_checks",
  tab: "Cek BMI",
  layout: "cek-bmi",
  key: ["staff_code", "period"],
  emptyRowIsAbsent: true,
  absentUnless: ["height_cm", "weight_kg"],
  appendMode: "none",
  noRowMessage: 'Tidak ada tempat untuk cek ini di tab "Cek BMI" (periode di luar kolom yang ada, atau ID SDM tidak ada).',
  deleteMode: "clear",
  parent: { column: "staff_code", table: "pd_staff" },
  columns: [
    d("staff_code", "ID SDM", text()),
    d("period", "Cek Ke", int(1, MAX_BMI_PERIODS)),
    d("check_date", "Tgl Cek", date),
    d("height_cm", "Tinggi (cm)", num(1, 120, 210), { required: true }),
    d("weight_kg", "Berat (kg)", num(1, 30, 200), { required: true }),
  ],
};

/** `ID Sistem` (hidden) and `ID SDM` are added by the setup (S, T). Nama/Cabang follow ID SDM in the DB. */
const replacements: TableSpec = {
  table: "pd_replacements",
  tab: "Penggantian SDM",
  layout: "penggantian",
  key: ["id"],
  generatedKey: true,
  emptyRowIsAbsent: true,
  absentUnless: ["name"],
  adoptBy: ["name"],
  refs: [{ column: "staff_code", table: "pd_staff" }],
  appendMode: "blank-row",
  deleteMode: "clear",
  columns: [
    d("id", "ID Sistem", int(1), { hidden: true }),
    d("name", "Nama", text(), { required: true }),
    d("report_group", "Cabang", reportGroup),
    d("category", "Kategori", oneOf(REPLACEMENT_CATEGORIES)),
    d("basis", "Dasar usulan", text()),
    d("withdraw_due", "Batas tarik / keputusan", date),
    d("director_approval", "Persetujuan Direksi", oneOf(YA_BELUM_TIDAK)),
    d("withdrawn_on", "Tgl ditarik / keputusan", date),
    d("withdraw_status", "Status penarikan", oneOf(STATUSES)),
    d("replacement_name", "Nama pengganti", text()),
    d("selected_on", "Tgl seleksi", date),
    d("post_test", "Post-test pengganti", num(2, 0, 100)),
    d("practice", "Praktik pengganti", num(2, 1, 5)),
    d("training_due", "Batas lulus training", date),
    d("started_on", "Tgl mulai bertugas", date),
    d("notes", "Catatan", text()),
    d("staff_code", "ID SDM", text()),
  ],
};

/**
 * Rencana Aksi. `ID Sistem` (hidden) is added by the setup (N). "% Progres" is a fraction in the
 * sheet. Archived rows (deleted in the app) are absent here; clearing a row in the sheet archives it.
 */
const actionPlans: TableSpec = {
  table: "pd_action_plans",
  tab: "Rencana Aksi",
  layout: "rencana-aksi",
  key: ["id"],
  generatedKey: true,
  emptyRowIsAbsent: true,
  absentUnless: ["action"],
  adoptBy: ["report_group", "area", "action"],
  archiveColumn: "archived_at",
  appendMode: "blank-row",
  deleteMode: "clear",
  columns: [
    d("id", "ID Sistem", int(1), { hidden: true }),
    d("item_no", "No", text()),
    d("area", "Area", area, { required: true }),
    d("action", "Tindakan", text(), { required: true }),
    d("report_group", "Cabang", reportGroup, { required: true }),
    d("target", "Sasaran / keterangan", text()),
    d("due_date", "Batas waktu", date),
    d("pic", "PIC", text()),
    d("status", "Status", oneOf(STATUSES), { required: true, defaultValue: "Belum Mulai" }),
    // Sheet holds a fraction (0..1, formatted 0%); the DB holds 0..100. Scaled by the layout.
    d("progress", "% Progres", int(0, 100), { required: true, defaultValue: 0 }),
    d("done_on", "Tgl selesai", date),
    d("evidence", "Bukti / dokumen", text()),
    d("notes", "Kendala / catatan", text()),
  ],
};

/** Laporan Bulanan: one row per Cabang and month. "Periode" reads "Okt 2026" in the sheet. */
const monthlyReports: TableSpec = {
  table: "pd_monthly_reports",
  tab: "Laporan Bulanan",
  layout: "laporan-bulanan",
  key: ["report_group", "period"],
  emptyRowIsAbsent: true,
  appendMode: "blank-row",
  deleteMode: "clear",
  columns: [
    d("report_group", "Cabang", reportGroup),
    d("period", "Periode", date),
    d("due_on", "Jatuh tempo laporan", date),
    d("received_on", "Tgl diterima", date),
    d("active_staff", "Total staf aktif", int(0, 10000)),
    d("compliant_staff", "Staf berstatus Sesuai", int(0, 10000)),
    d("complaints", "Keluhan sikap / komunikasi", int(0, 10000)),
    d("responded", "Semua direspons ≤ 1×24 jam?", oneOf(YA_BELUM_TIDAK)),
    d("satisfaction", "Indeks kepuasan JOUMPA", num(2, 0, 5)),
    d("notes", "Catatan", text()),
  ],
};

/** Processing order: parents before children. Deletes run in reverse. */
export const SYNC_TABLES: TableSpec[] = [settings, staff, bmiChecks, replacements, actionPlans, monthlyReports];

/** Tabs the engine must never touch. */
export const UNTOUCHED_TABS = ["Petunjuk", "Dashboard", "Referensi"];

export function specFor(table: SyncTable, specs: TableSpec[] = SYNC_TABLES): TableSpec {
  const s = specs.find((t) => t.table === table);
  if (!s) throw new Error(`unknown sync table ${table}`);
  return s;
}

/**
 * The same tables as plain row-1 tabs (no workbook layout, rows appended and deleted normally).
 * Used by the merge-engine tests; data semantics (keys, types, absence rules) are unchanged.
 */
export function rowOneSpecs(specs: TableSpec[] = SYNC_TABLES): TableSpec[] {
  return specs.map((s) => ({ ...s, layout: undefined, appendMode: undefined, deleteMode: undefined }));
}

export const dataColumns = (spec: TableSpec): DataColumn[] => spec.columns;
export const nonKeyDataColumns = (spec: TableSpec): DataColumn[] =>
  dataColumns(spec).filter((c) => !spec.key.includes(c.db));
export const columnId = (c: Column): string => c.db;
