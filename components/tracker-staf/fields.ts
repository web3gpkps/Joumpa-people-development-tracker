/*
 * Tracker Staf: the column model of the workbook tab "Tracker Tindak Lanjut per Staf", in its
 * order. One list drives the grid columns, the detail dialog, the server-side patch check and
 * the tests. Pure and client-safe (no JSX, no server import). Option lists and the derived
 * columns (Hasil penilaian ulang, Flag) come from lib/pd-rules; nothing is recomputed here.
 */
import { COACHING_STATUSES, FINAL_DECISIONS, PROPOSALS, STATUSES } from "@/lib/pd-rules";
import type { ValueRules } from "@/lib/grid/values";

/** One staff row as the screen shows it: pd_staff plus the counts the delete dialog names. */
export type TrackerRow = {
  /** Workbook "No": position in the full list (station order, then row order). */
  no: number;
  code: string;
  name: string;
  station: string;
  /** "Cabang", derived by the database from the station. */
  reportGroup: string | null;
  nipp: string | null;
  gender: string | null;
  proposal: string | null;
  initialCoaching: string | null;
  coachingItems: string | null;
  initialPractice: number | null;
  mainAction: string | null;
  mainDue: string | null;
  pic: string | null;
  mainStatus: string | null;
  extraAction: string | null;
  extraDue: string | null;
  extraStatus: string | null;
  reassessedOn: string | null;
  reassessPractice: number | null;
  recoaching: string | null;
  finalDecision: string | null;
  progressNotes: string | null;
  /** "Diubah lewat tautan ini, 8 Okt 14.05" (lastChangedLabel). */
  changedLabel: string;
  /** BMI checks deleted with this person. */
  bmiChecks: number;
  /** Replacement rows linked to this person (they stay, unlinked). */
  replacements: number;
};

/** Every key pd_share_save_staff accepts in p_patch (supabase/migrations/*_pd_share_rpcs.sql). */
export const PATCH_KEYS = [
  "station",
  "name",
  "nipp",
  "gender",
  "bmi_note",
  "proposal",
  "initial_coaching",
  "coaching_items",
  "initial_practice",
  "main_action",
  "main_due",
  "pic",
  "main_status",
  "extra_action",
  "extra_due",
  "extra_status",
  "reassessed_on",
  "reassess_practice",
  "recoaching",
  "final_decision",
  "progress_notes",
] as const;

export type PatchKey = (typeof PATCH_KEYS)[number];

export const GENDERS = ["L", "P"] as const;

const options = (values: readonly string[]) => values.map((value) => ({ value }));

/** Value rules per editable key (the database checks the same: 1 to 5, enums, lengths). */
export const FIELD_RULES: Record<Exclude<PatchKey, "station" | "bmi_note">, ValueRules> = {
  name: { editor: "text", required: true, maxLength: 200 },
  nipp: { editor: "text", maxLength: 50 },
  gender: { editor: "select", options: options(GENDERS) },
  proposal: { editor: "select", options: options(PROPOSALS) },
  initial_coaching: { editor: "text", maxLength: 100 },
  coaching_items: { editor: "text", maxLength: 500 },
  initial_practice: { editor: "number", min: 1, max: 5, decimals: 2 },
  main_action: { editor: "longtext", maxLength: 4000 },
  main_due: { editor: "date" },
  pic: { editor: "text", maxLength: 500 },
  main_status: { editor: "select", options: options(STATUSES) },
  extra_action: { editor: "longtext", maxLength: 4000 },
  extra_due: { editor: "date" },
  extra_status: { editor: "select", options: options(STATUSES) },
  reassessed_on: { editor: "date" },
  reassess_practice: { editor: "number", min: 1, max: 5, decimals: 2 },
  recoaching: { editor: "select", options: options(COACHING_STATUSES) },
  final_decision: { editor: "select", options: options(FINAL_DECISIONS) },
  progress_notes: { editor: "longtext", maxLength: 4000 },
};

/** Station rules for a workspace's station list. */
export function stationRules(stations: readonly string[]): ValueRules {
  return { editor: "select", required: true, options: options(stations) };
}

/**
 * The columns PIC / CS Division fill in (cream in the workbook). Everything else is report data
 * that KPS keeps up to date, or computed.
 */
export const PIC_KEYS = [
  "main_status",
  "extra_status",
  "reassessed_on",
  "reassess_practice",
  "recoaching",
  "final_decision",
  "progress_notes",
] as const satisfies readonly PatchKey[];

export function isPicKey(key: string): boolean {
  return (PIC_KEYS as readonly string[]).includes(key);
}

export type ColumnKey = Exclude<PatchKey, "bmi_note"> | "no" | "code" | "report_group" | "result" | "flag" | "changed";

export type ColumnDef = {
  key: ColumnKey;
  /** Row property the value is read from (computed columns have none). */
  prop?: keyof TrackerRow;
  /** Short header under its group. */
  header: string;
  /** Full name: workbook header, used for screen readers, the dialog and the phone cards. */
  label: string;
  group?: string;
  width: number;
  frozen?: boolean;
  /** Computed or identity: never typed into. */
  readonly?: boolean;
};

export const GROUP_INITIAL = "Penilaian awal";
export const GROUP_MAIN = "Tindakan utama";
export const GROUP_EXTRA = "Tindakan tambahan / pemantauan khusus";
export const GROUP_REASSESS = "Penilaian ulang";

/** The workbook's columns, in order, then "Terakhir diubah". */
export const COLUMNS: readonly ColumnDef[] = [
  { key: "no", prop: "no", header: "No", label: "No", width: 44, frozen: true, readonly: true },
  { key: "code", prop: "code", header: "ID", label: "ID", width: 84, frozen: true, readonly: true },
  { key: "name", prop: "name", header: "Nama", label: "Nama", width: 200, frozen: true },
  { key: "report_group", prop: "reportGroup", header: "Cabang", label: "Cabang", width: 96, readonly: true },
  { key: "station", prop: "station", header: "Stn", label: "Stasiun", width: 64 },
  { key: "proposal", prop: "proposal", header: "Usulan", label: "Usulan", group: GROUP_INITIAL, width: 148 },
  { key: "initial_coaching", prop: "initialCoaching", header: "Coaching awal", label: "Coaching awal", group: GROUP_INITIAL, width: 132 },
  {
    key: "coaching_items",
    prop: "coachingItems",
    header: "Item belum sesuai",
    label: "Item coaching belum sesuai",
    group: GROUP_INITIAL,
    width: 140,
  },
  { key: "initial_practice", prop: "initialPractice", header: "Praktik awal", label: "Praktik awal", group: GROUP_INITIAL, width: 76 },
  { key: "main_action", prop: "mainAction", header: "Tindakan", label: "Tindakan utama", group: GROUP_MAIN, width: 220 },
  { key: "main_due", prop: "mainDue", header: "Batas waktu", label: "Batas waktu", group: GROUP_MAIN, width: 108 },
  { key: "pic", prop: "pic", header: "PIC", label: "PIC", group: GROUP_MAIN, width: 140 },
  { key: "main_status", prop: "mainStatus", header: "Status", label: "Status tindakan utama", group: GROUP_MAIN, width: 116 },
  {
    key: "extra_action",
    prop: "extraAction",
    header: "Tindakan",
    label: "Tindakan tambahan / pemantauan khusus",
    group: GROUP_EXTRA,
    width: 200,
  },
  { key: "extra_due", prop: "extraDue", header: "Batas", label: "Batas tambahan", group: GROUP_EXTRA, width: 108 },
  { key: "extra_status", prop: "extraStatus", header: "Status", label: "Status tindakan tambahan", group: GROUP_EXTRA, width: 116 },
  {
    key: "reassessed_on",
    prop: "reassessedOn",
    header: "Tanggal",
    label: "Tgl penilaian ulang",
    group: GROUP_REASSESS,
    width: 108,
  },
  {
    key: "reassess_practice",
    prop: "reassessPractice",
    header: "Praktik",
    label: "Praktik ulang (1–5)",
    group: GROUP_REASSESS,
    width: 72,
  },
  { key: "recoaching", prop: "recoaching", header: "Coaching ulang", label: "Coaching ulang", group: GROUP_REASSESS, width: 132 },
  { key: "result", header: "Hasil", label: "Hasil penilaian ulang", group: GROUP_REASSESS, width: 188, readonly: true },
  { key: "final_decision", prop: "finalDecision", header: "Keputusan akhir", label: "Keputusan akhir", width: 156 },
  { key: "progress_notes", prop: "progressNotes", header: "Catatan progres", label: "Catatan progres", width: 220 },
  { key: "flag", header: "Flag", label: "Flag", width: 156, readonly: true },
  { key: "changed", prop: "changedLabel", header: "Terakhir diubah", label: "Terakhir diubah", width: 196, readonly: true },
];

/** "Item coaching belum sesuai" codes seen in the assessment (C01 = Produk JOUMPA, ...). */
export const COACHING_ITEMS: Readonly<Record<string, string>> = {
  A01: "BMI standar",
  A03: "ID card & name tag",
  A05: "Penampilan wajah / make-up",
  A07: "Sepatu (pantofel)",
  B07: "Ownership pelayanan",
  C01: "Produk JOUMPA",
  C02: "Tahapan layanan / WI",
  C03: "Produk kelas penerbangan / airlines",
  C04: "Pemesanan & refund",
  C06: "Special pax",
  C07: "Harga layanan cabang",
  D01: "Nada bicara",
  D08: "Penutupan & farewell",
};

export type CoachingItem = { code: string; meaning: string | null };

/** "C01, c02; X9" → [{ C01, Produk JOUMPA }, { C02, … }, { X9, null }], duplicates once. */
export function coachingItems(text: string | null | undefined): CoachingItem[] {
  if (!text) return [];
  const out: CoachingItem[] = [];
  for (const part of text.split(/[,;/\n]+|\s+(?=[A-Za-z]\d)/)) {
    const code = part.trim().toUpperCase();
    if (!code || out.some((item) => item.code === code)) continue;
    out.push({ code, meaning: COACHING_ITEMS[code] ?? null });
  }
  return out;
}

/** "C01 Produk JOUMPA · C02 Tahapan layanan / WI" for a hover title or a screen reader. */
export function coachingItemsText(text: string | null | undefined): string {
  return coachingItems(text)
    .map((item) => (item.meaning ? `${item.code} ${item.meaning}` : item.code))
    .join(" · ");
}
