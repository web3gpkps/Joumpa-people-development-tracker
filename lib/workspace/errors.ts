/**
 * Errors raised by the pd_share_* RPCs (see supabase/migrations/*_pd_share_rpcs.sql):
 * - invalid_link   (P0001): unknown or revoked token
 * - out_of_scope   (P0001): the row belongs to another station or Cabang
 * - forbidden_field        : a KPS-only field (or page) used by a single-station scope
 * - invalid_input  (22023): a value failed validation; `details` names the field
 * Plus, from resolveAccess: unauthorized (the owner's session is gone or not an admin).
 */
export type LinkErrorCode =
  | "invalid_link"
  | "out_of_scope"
  | "forbidden_field"
  | "invalid_input"
  | "unauthorized"
  | "unknown";

export type LinkError = {
  code: LinkErrorCode;
  /** For invalid_input: the field name from `details` (e.g. "height_cm"). */
  field?: string;
  /** Plain-language message for the UI (Bahasa Indonesia). */
  message: string;
};

const MESSAGES: Record<Exclude<LinkErrorCode, "unknown" | "invalid_input" | "unauthorized">, string> = {
  invalid_link: "Tautan tidak berlaku. Minta tautan baru kepada pengelola aplikasi.",
  out_of_scope: "Data ini milik stasiun lain dan tidak bisa diubah lewat tautan ini.",
  forbidden_field: "Isian ini hanya bisa diubah oleh KPS.",
};

/** Shown for any failure the app cannot explain in plain words (never the raw database text). */
export const GENERIC_SAVE_ERROR = "Tidak bisa disimpan. Coba lagi.";

/**
 * Indonesian labels for the fields the share_* RPCs name in `details`. Unknown fields fall
 * back to a generic sentence, so a column name never reaches the screen.
 */
export const FIELD_LABELS: Record<string, string> = {
  week: "Minggu",
  period: "Periode cek",
  staff_code: "ID SDM",
  station: "Stasiun",
  report_group: "Cabang",
  name: "Nama",
  nipp: "NIPP",
  gender: "L/P",
  pre_test: "Pre-test",
  post_test: "Post-test",
  score_a: "Nilai A",
  score_b: "Nilai B",
  score_c: "Nilai C",
  score_d: "Nilai D",
  score_e: "Nilai E",
  score_f: "Nilai F",
  report_conclusion: "Kesimpulan laporan",
  assignment_status: "Status penugasan",
  notes: "Catatan",
  bmi_note: "Catatan program BMI",
  check_date: "Tanggal cek",
  height_cm: "Tinggi badan",
  weight_kg: "Berat badan",
  observer: "Pengamat",
  coaching_notes: "Catatan coaching",
  area: "Area",
  action: "Tindakan",
  target: "Target",
  kind: "Jenis",
  schedule: "Jadwal",
  due_date: "Batas waktu",
  due_rule: "Batas waktu bergulir",
  pic: "PIC",
  status: "Status",
  progress: "Progres",
  updated_on: "Tanggal update",
  evidence: "Bukti",
  kps_notes: "Catatan KPS",
  replaced_name: "Nama yang diganti",
  reason: "Alasan",
  withdrawn_on: "Tanggal ditarik",
  replacement_name: "Nama pengganti",
  effective_on: "Tanggal efektif",
  training_on: "Tanggal training",
  practice_avg: "Rata-rata praktik",
  reported: "Dilaporkan",
  findings: "Temuan",
  // v2: Tracker Staf
  proposal: "Usulan",
  initial_coaching: "Coaching awal",
  coaching_items: "Item coaching",
  initial_practice: "Praktik awal",
  main_action: "Tindakan utama",
  main_due: "Batas waktu",
  main_status: "Status tindakan utama",
  extra_action: "Tindakan tambahan",
  extra_due: "Batas tambahan",
  extra_status: "Status tindakan tambahan",
  reassessed_on: "Tanggal penilaian ulang",
  reassess_practice: "Praktik ulang",
  recoaching: "Coaching ulang",
  final_decision: "Keputusan akhir",
  progress_notes: "Catatan progres",
  // v2: Penggantian SDM
  category: "Kategori",
  basis: "Dasar usulan",
  withdraw_due: "Batas tarik",
  director_approval: "Persetujuan Direksi",
  withdraw_status: "Status penarikan",
  selected_on: "Tanggal seleksi",
  practice: "Praktik pengganti",
  training_due: "Batas lulus training",
  started_on: "Tanggal mulai bertugas",
  // v2: Rencana Aksi
  item_no: "No",
  done_on: "Tanggal selesai",
  // v2: Laporan Bulanan
  due_on: "Jatuh tempo laporan",
  received_on: "Tanggal diterima",
  active_staff: "Total staf aktif",
  compliant_staff: "Staf berstatus Sesuai",
  complaints: "Keluhan sikap / komunikasi",
  responded: "Direspons ≤ 1×24 jam",
  satisfaction: "Indeks kepuasan",
  patch: "Data",
};

/** "Tinggi badan tidak valid. Periksa lagi isinya." for a known field, a generic sentence otherwise. */
export function invalidFieldMessage(field: string | undefined): string {
  const label = field ? FIELD_LABELS[field] : undefined;
  return label ? `${label} tidak valid. Periksa lagi isinya.` : "Ada isian yang tidak valid. Periksa lagi isinya.";
}

type PostgrestLikeError = { message?: string; code?: string; details?: string | null };

/**
 * Maps a PostgREST error from a pd_share_* RPC to a code + plain Indonesian message.
 * `field` keeps the raw column name for code that places the error on an input; the
 * message never contains it.
 */
export function toLinkError(error: PostgrestLikeError): LinkError {
  const message = error.message ?? "";
  if (message === "invalid_link" || message === "out_of_scope" || message === "forbidden_field") {
    return { code: message, message: MESSAGES[message] };
  }
  if (message === "invalid_input" || error.code === "22023") {
    const field = error.details ?? undefined;
    return { code: "invalid_input", field, message: invalidFieldMessage(field) };
  }
  return { code: "unknown", message: GENERIC_SAVE_ERROR };
}
