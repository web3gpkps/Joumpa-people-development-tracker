/** Small synthetic v2 data set (no real names) for sync tests. */
import type { DbSnapshot } from "../types";

/** public.stations as the tests see it: CGK and HLP report together, every other station is its own group. */
export const TEST_STATIONS: { code: string; report_group: string }[] = [
  { code: "CGK", report_group: "CGK & HLP" },
  { code: "HLP", report_group: "CGK & HLP" },
  { code: "DPS", report_group: "DPS" },
  { code: "SUB", report_group: "SUB" },
  { code: "KNO", report_group: "KNO" },
  { code: "BPN", report_group: "BPN" },
];

/** pd_areas names (Rencana Aksi "Area"), as seeded by the migration. */
export const TEST_AREAS = [
  "Penggantian SDM",
  "Coaching assessment",
  "Coaching intensif",
  "Pembinaan on the job",
  "Product knowledge & SOP",
  "Grooming",
  "BMI",
  "Seragam & atribut",
  "Komunikasi touch point",
  "Bahasa Inggris & reservasi",
  "Training susulan",
  "Evaluasi & pelaporan",
];

export function groupOf(station: string, stations = TEST_STATIONS): string | null {
  return stations.find((s) => s.code === station)?.report_group ?? null;
}

export function settingsRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    bmi_first_check: "2026-10-12",
    bmi_interval_days: 14,
    bmi_periods: 5,
    bmi_underweight_below: 18.5,
    bmi_normal_max: 25,
    bmi_overweight_max: 27,
    min_height_female: null,
    min_height_male: null,
    updated_at: "2026-10-19T00:00:00Z",
    ...over,
  };
}

export function staffRow(code: string, n: number, over: Record<string, unknown> = {}) {
  const station = code.split("-")[0];
  return {
    code,
    station,
    report_group: groupOf(station),
    name: `Petugas ${code}`,
    nipp: String(1000 + n),
    gender: "L",
    bmi_note: null,
    proposal: "Pembinaan",
    initial_coaching: "Perlu pembinaan grooming",
    coaching_items: "Grooming, postur",
    initial_practice: 3,
    main_action: "Coaching grooming",
    main_due: "2026-10-30",
    pic: "Supervisor",
    main_status: "Proses",
    extra_action: null,
    extra_due: null,
    extra_status: null,
    reassessed_on: null,
    reassess_practice: null,
    recoaching: null,
    final_decision: null,
    progress_notes: null,
    sort_order: n,
    created_at: "2026-10-19T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z",
    updated_by_link: null,
    ...over,
  };
}

export function bmiRow(id: number, staff_code: string, period: number, over: Record<string, unknown> = {}) {
  return {
    id,
    staff_code,
    period,
    check_date: "2026-10-12",
    height_cm: 170,
    weight_kg: 65.5,
    updated_at: "2026-10-19T00:00:00Z",
    updated_by_user: null,
    updated_by_link: null,
    ...over,
  };
}

export function replacementRow(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    staff_code: null,
    name: `Diganti ${id}`,
    report_group: "SUB",
    category: "Penggantian",
    basis: "Hasil penilaian ulang",
    withdraw_due: "2026-10-31",
    director_approval: "Belum",
    withdrawn_on: null,
    withdraw_status: "Belum Mulai",
    replacement_name: null,
    selected_on: null,
    post_test: null,
    practice: null,
    training_due: null,
    started_on: null,
    notes: null,
    sort_order: id,
    updated_at: "2026-10-19T00:00:00Z",
    updated_by_link: null,
    ...over,
  };
}

export function planRow(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    item_no: String(id),
    area: "Grooming",
    action: `Tindakan ${id}`,
    report_group: "SUB",
    target: "Semua staf",
    due_date: "2026-10-30",
    pic: "Supervisor",
    status: "Belum Mulai",
    progress: 0,
    done_on: null,
    evidence: null,
    notes: null,
    archived_at: null,
    sort_order: id,
    created_at: "2026-10-19T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z",
    updated_by_link: null,
    ...over,
  };
}

export function monthlyRow(report_group: string, period: string, over: Record<string, unknown> = {}) {
  return {
    report_group,
    period,
    due_on: "2026-11-05",
    received_on: null,
    active_staff: 10,
    compliant_staff: 9,
    complaints: 0,
    responded: "Ya",
    satisfaction: 4.5,
    notes: null,
    updated_at: "2026-10-19T00:00:00Z",
    updated_by_link: null,
    ...over,
  };
}

/**
 * Three staff (SUB-01, SUB-02, DPS-01), one BMI check, one replacement, two action plans (No "1" and
 * "6a"), two monthly reports for Okt 2026. Stations and areas come from FakeDb's defaults.
 */
export function smallDb(): DbSnapshot {
  return {
    pd_settings: [settingsRow()],
    pd_staff: [staffRow("SUB-01", 1), staffRow("SUB-02", 2, { gender: "P" }), staffRow("DPS-01", 3)],
    pd_bmi_checks: [bmiRow(1, "SUB-01", 1)],
    pd_replacements: [replacementRow(1)],
    pd_action_plans: [planRow(1), planRow(2, { item_no: "6a", area: "BMI", report_group: "DPS" })],
    pd_monthly_reports: [monthlyRow("SUB", "2026-10-01"), monthlyRow("CGK & HLP", "2026-10-01", { notes: "Laporan gabungan" })],
  };
}

/** n staff rows for guard tests. */
export function manyStaff(n: number) {
  return Array.from({ length: n }, (_, i) => staffRow(`SUB-${String(i + 1).padStart(2, "0")}`, i + 1));
}
