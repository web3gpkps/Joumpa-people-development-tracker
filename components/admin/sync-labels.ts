/** Plain-language names for pd_sync_conflicts rows (docs/SYNC.md, "Resolving conflicts"). */

import { SYNC_TABLES } from "@/lib/sync/tables";
import { SETTING_FIELDS } from "./settings-schema";

export const TABLE_LABEL: Record<string, string> = {
  pd_staff: "Tracker Staf",
  pd_bmi_checks: "Cek BMI",
  pd_replacements: "Penggantian SDM",
  pd_action_plans: "Rencana Aksi",
  pd_monthly_reports: "Laporan Bulanan",
  pd_settings: "Parameter BMI",
};

export const RESOLUTION_LABEL: Record<string, string> = {
  "db-wins": "Nilai aplikasi dipakai, Google Sheet ditimpa",
  "sheet-wins": "Nilai Google Sheet dipakai",
  "rejected:invalid_value": "Ditolak: nilai di Google Sheet tidak valid",
  "rejected:required_missing": "Ditolak: isian wajib kosong",
  "rejected:unknown_parent": "Ditolak: ID SDM tidak ada di Tracker Staf",
  "rejected:duplicate_key": "Ditolak: baris ganda",
  "rejected:missing_key": "Ditolak: ID baris kosong",
  "rejected:unknown_setting": "Ditolak: parameter tidak dikenal",
  "rejected:deletes_skipped": "Penghapusan dilewati",
  "rejected:header_error": "Ditolak: judul kolom berubah",
  "rejected:no_sheet_row": "Tidak ada baris untuk data ini di Google Sheet",
  "rejected:incomplete_row": "Ditolak: baris di Google Sheet belum lengkap",
};

/** The product name of a logged column (Parameter BMI: the label the Parameter form uses). */
export function columnLabel(table: string, column: string | null, rowKey: string | null): string | null {
  if (column === null) return null;
  if (table === "pd_settings") return SETTING_FIELDS.find((f) => f.key === rowKey)?.label ?? column;
  if (column === "db" || column === "sheet") return column === "db" ? "Penghapusan di aplikasi" : "Penghapusan di Google Sheet";
  const header = SYNC_TABLES.find((t) => t.table === table)?.columns.find((c) => c.db === column)?.header;
  return header ?? column;
}

/** A jsonb cell as text: strings as-is, everything else as compact JSON. */
export function jsonText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
