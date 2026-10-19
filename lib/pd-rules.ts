/*
 * The formulas of the workbook "Tracker Tindak Lanjut People Development JOUMPA", in code: the
 * derived columns (Hasil penilaian ulang, Lulus training?, Flag, Tepat waktu?, % Sesuai) and the
 * Dashboard. Pure: no I/O, no clock (today is passed in as 'YYYY-MM-DD', Asia/Jakarta).
 *
 * One deliberate difference from the workbook as delivered: a blank deadline is "no deadline",
 * never "Terlambat" (Sheets compares TODAY() > "" as TRUE), and a Penggantian row marked
 * "Batal / N.A." is done. The sheet setup rewrites those Flag formulas the same way.
 */
import { diffDays, type IsoDate } from "@/lib/dates";

// ------------------------------------------------------------------ option lists (tab Referensi)

export const STATUSES = ["Belum Mulai", "Proses", "Selesai", "Batal / N.A."] as const;
export const COACHING_STATUSES = ["Siap Bertugas", "Perlu Pembinaan", "Tidak Sesuai", "Belum dinilai"] as const;
export const FINAL_DECISIONS = ["Tetap bertugas", "Lanjut pembinaan", "Diganti", "Ditarik dari JOUMPA"] as const;
export const PROPOSALS = ["Coaching intensif", "Pembinaan", "Penggantian", "Siap bertugas", "Strong reminder"] as const;
export const REPLACEMENT_CATEGORIES = ["Penggantian", "Strong reminder"] as const;
export const YA_BELUM_TIDAK = ["Ya", "Belum", "Tidak"] as const;

export type Status = (typeof STATUSES)[number];

/** Practice score from which a re-assessment is "Sesuai" (Tracker Staf S). */
export const REASSESS_PASS = 4;
/** Training pass marks for a replacement (Penggantian SDM N). */
export const REPLACEMENT_POSTTEST_MIN = 80;
export const REPLACEMENT_PRACTICE_MIN = 4;
/** Laporan Bulanan target: share of staff "Sesuai". */
export const COMPLIANCE_TARGET = 0.9;
/** "Jatuh tempo ≤ 7 hari". */
export const DUE_SOON_DAYS = 7;

export const FLAGS = ["Selesai", "Terlambat", "Jatuh tempo ≤ 7 hari", "On track"] as const;
export type Flag = (typeof FLAGS)[number];

const isDone = (status: string | null | undefined) => status === "Selesai" || status === "Batal / N.A.";
const late = (due: string | null | undefined, today: IsoDate) => !!due && today > due;
const soon = (due: string | null | undefined, today: IsoDate) => !!due && diffDays(due, today) <= DUE_SOON_DAYS;

// ------------------------------------------------------------------ Tracker Staf

export type StaffRow = {
  mainDue?: string | null;
  mainStatus?: string | null;
  extraDue?: string | null;
  extraStatus?: string | null;
  reassessPractice?: number | string | null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type ReassessResult = "Sesuai" | "Tidak Sesuai → usulan ganti";

/** Tracker Staf S "Hasil penilaian ulang": practice ≥ 4 is Sesuai; below, an automatic proposal to replace. */
export function reassessResult(practice: number | string | null | undefined): ReassessResult | null {
  const n = num(practice);
  if (n === null) return null;
  return n >= REASSESS_PASS ? "Sesuai" : "Tidak Sesuai → usulan ganti";
}

/**
 * Tracker Staf V "Flag": Selesai when both actions are done (Selesai or Batal / N.A.); Terlambat
 * when an open action is past its deadline; Jatuh tempo ≤ 7 hari when one is due within a week.
 * A blank status counts as open, as in the sheet.
 */
export function staffFlag(row: StaffRow, today: IsoDate): Flag {
  if (isDone(row.mainStatus) && isDone(row.extraStatus)) return "Selesai";
  const mainOpen = !isDone(row.mainStatus);
  const extraOpen = !isDone(row.extraStatus);
  if ((mainOpen && late(row.mainDue, today)) || (extraOpen && late(row.extraDue, today))) return "Terlambat";
  if ((mainOpen && soon(row.mainDue, today)) || (extraOpen && soon(row.extraDue, today))) return "Jatuh tempo ≤ 7 hari";
  return "On track";
}

// ------------------------------------------------------------------ Penggantian SDM

export type ReplacementRow = {
  withdrawDue?: string | null;
  withdrawStatus?: string | null;
  postTest?: number | string | null;
  practice?: number | string | null;
  trainingDue?: string | null;
  startedOn?: string | null;
};

/** Penggantian SDM N "Lulus training?": post-test ≥ 80 and practice ≥ 4,00; blank until both are in. */
export function replacementPassed(row: Pick<ReplacementRow, "postTest" | "practice">): "Lulus" | "Belum lulus" | null {
  const post = num(row.postTest);
  const practice = num(row.practice);
  if (post === null || practice === null) return null;
  return post >= REPLACEMENT_POSTTEST_MIN && practice >= REPLACEMENT_PRACTICE_MIN ? "Lulus" : "Belum lulus";
}

/**
 * Penggantian SDM R "Flag": Selesai when cancelled, or withdrawn with the replacement on duty;
 * Terlambat when the withdrawal is past its deadline, or the replacement is not on duty after
 * the training deadline; Jatuh tempo ≤ 7 hari when the withdrawal is due within a week.
 */
export function replacementFlag(row: ReplacementRow, today: IsoDate): Flag {
  if (row.withdrawStatus === "Batal / N.A.") return "Selesai";
  if (row.withdrawStatus === "Selesai" && row.startedOn) return "Selesai";
  const withdrawalOpen = !isDone(row.withdrawStatus);
  if (withdrawalOpen && late(row.withdrawDue, today)) return "Terlambat";
  if (!row.startedOn && late(row.trainingDue, today)) return "Terlambat";
  if (withdrawalOpen && soon(row.withdrawDue, today)) return "Jatuh tempo ≤ 7 hari";
  return "On track";
}

const normName = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The replacement person is added to Tracker Staf by hand. True while "Nama pengganti" is filled
 * but no staff member carries that name (case and spacing ignored).
 */
export function replacementNotRegistered(
  row: { replacementName?: string | null },
  staff: ReadonlyArray<{ name?: string | null }>,
): boolean {
  const name = row.replacementName?.trim();
  if (!name) return false;
  const wanted = normName(name);
  return !staff.some((s) => s.name && normName(s.name) === wanted);
}

// ------------------------------------------------------------------ Rencana Aksi

export type PlanRow = { dueDate?: string | null; status?: string | null; archivedAt?: string | null };

/** Rencana Aksi M "Flag". */
export function planFlag(row: PlanRow, today: IsoDate): Flag {
  if (isDone(row.status)) return "Selesai";
  if (late(row.dueDate, today)) return "Terlambat";
  if (soon(row.dueDate, today)) return "Jatuh tempo ≤ 7 hari";
  return "On track";
}

// ------------------------------------------------------------------ Laporan Bulanan

export type MonthlyRow = {
  dueOn?: string | null;
  receivedOn?: string | null;
  activeStaff?: number | null;
  compliantStaff?: number | null;
};

/** Laporan Bulanan E "Tepat waktu?": Ya / Terlambat once received; Terlambat while missing after the due date. */
export function monthlyOnTime(row: MonthlyRow, today: IsoDate): "Ya" | "Terlambat" | null {
  if (!row.receivedOn) return late(row.dueOn, today) ? "Terlambat" : null;
  if (!row.dueOn) return "Ya";
  return row.receivedOn <= row.dueOn ? "Ya" : "Terlambat";
}

/** Laporan Bulanan H "% Sesuai" (0..1). */
export function monthlyCompliance(row: MonthlyRow): number | null {
  if (!row.activeStaff || row.compliantStaff === null || row.compliantStaff === undefined) return null;
  return row.compliantStaff / row.activeStaff;
}

/** Laporan Bulanan I "Capai target ≥ 90%?". */
export function monthlyTargetMet(row: MonthlyRow): "Ya" | "Belum" | null {
  const pct = monthlyCompliance(row);
  if (pct === null) return null;
  return pct >= COMPLIANCE_TARGET ? "Ya" : "Belum";
}

/** "Okt 2026" for a period's first day ('2026-10-01'). */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS_ID[m - 1]} ${y}`;
}

/** '2026-10-01' from "Okt 2026" (also "Oktober 2026", "okt-2026", "10/2026"); null when unreadable. */
export function parsePeriod(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/[-/.]+/g, " ").replace(/\s+/g, " ");
  const numeric = /^(\d{1,2}) (\d{4})$/.exec(t);
  if (numeric) {
    const m = Number(numeric[1]);
    return m >= 1 && m <= 12 ? `${numeric[2]}-${String(m).padStart(2, "0")}-01` : null;
  }
  const named = /^([a-z]+) (\d{4})$/.exec(t);
  if (!named) return null;
  const i = MONTHS_ID.findIndex((mo, idx) => named[1] === mo.toLowerCase() || named[1] === MONTHS_LONG_ID[idx] || named[1] === MONTHS_EN[idx]);
  return i < 0 ? null : `${named[2]}-${String(i + 1).padStart(2, "0")}-01`;
}

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_LONG_ID = [
  "januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember",
];
const MONTHS_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// ------------------------------------------------------------------ Dashboard

export type DashboardInput = {
  groups: string[];
  areas: string[];
  staff: ReadonlyArray<StaffRow & { reportGroup?: string | null; proposal?: string | null }>;
  replacements: ReadonlyArray<ReplacementRow & { reportGroup?: string | null; category?: string | null }>;
  plans: ReadonlyArray<PlanRow & { reportGroup?: string | null; area?: string | null; progress?: number | null }>;
};

export type DashboardKpis = {
  totalStaff: number;
  replacementsDone: number;
  replacements: number;
  reassessed: number;
  intensive: number;
  /** Share of re-assessed staff that are Sesuai (0..1); 0 when none re-assessed, as in the sheet. */
  compliance: number;
  /** Share of Rencana Aksi rows Selesai (0..1). */
  plansDone: number;
  late: number;
};

export type GroupProgress = {
  group: string;
  totalStaff: number;
  proposedReplacement: number;
  replacementDone: number;
  intensive: number;
  reassessed: number;
  compliant: number;
  notCompliant: number;
  guidance: number;
  /** Staff whose Flag is Selesai. */
  completed: number;
  /** completed / totalStaff (0..1). */
  completedShare: number;
  late: number;
};

export type AreaProgress = {
  area: string;
  rows: number;
  done: number;
  inProgress: number;
  notStarted: number;
  late: number;
  /** Average % progres (0..100). */
  avgProgress: number;
  earliestDue: string | null;
};

const activePlans = <T extends PlanRow>(plans: ReadonlyArray<T>) => plans.filter((p) => !p.archivedAt);

/** The Dashboard's KPI row (Dashboard row 6). */
export function dashboardKpis(input: DashboardInput, today: IsoDate): DashboardKpis {
  const plans = activePlans(input.plans);
  const reassessed = input.staff.filter((s) => num(s.reassessPractice) !== null);
  const compliant = input.staff.filter((s) => reassessResult(s.reassessPractice) === "Sesuai").length;
  const late =
    input.staff.filter((s) => staffFlag(s, today) === "Terlambat").length +
    input.replacements.filter((r) => replacementFlag(r, today) === "Terlambat").length +
    plans.filter((p) => planFlag(p, today) === "Terlambat").length;
  return {
    totalStaff: input.staff.length,
    replacementsDone: input.replacements.filter((r) => r.withdrawStatus === "Selesai").length,
    replacements: input.replacements.length,
    reassessed: reassessed.length,
    intensive: input.staff.filter((s) => s.proposal === "Coaching intensif").length,
    compliance: reassessed.length ? compliant / reassessed.length : 0,
    plansDone: plans.length ? plans.filter((p) => p.status === "Selesai").length / plans.length : 0,
    late,
  };
}

/** "Progres per cabang" (Dashboard rows 10..14), one row per group in `groups` order. */
export function groupProgress(input: DashboardInput, today: IsoDate): GroupProgress[] {
  const plans = activePlans(input.plans);
  return input.groups.map((group) => {
    const staff = input.staff.filter((s) => s.reportGroup === group);
    const repl = input.replacements.filter((r) => r.reportGroup === group);
    const completed = staff.filter((s) => staffFlag(s, today) === "Selesai").length;
    return {
      group,
      totalStaff: staff.length,
      proposedReplacement: repl.length,
      replacementDone: repl.filter((r) => r.withdrawStatus === "Selesai").length,
      intensive: staff.filter((s) => s.proposal === "Coaching intensif").length,
      reassessed: staff.filter((s) => s.proposal === "Coaching intensif" && (num(s.reassessPractice) ?? 0) > 0).length,
      compliant: staff.filter((s) => reassessResult(s.reassessPractice) === "Sesuai").length,
      notCompliant: staff.filter((s) => reassessResult(s.reassessPractice)?.startsWith("Tidak")).length,
      guidance: staff.filter((s) => s.proposal === "Pembinaan").length,
      completed,
      completedShare: staff.length ? completed / staff.length : 0,
      late:
        staff.filter((s) => staffFlag(s, today) === "Terlambat").length +
        repl.filter((r) => replacementFlag(r, today) === "Terlambat").length +
        plans.filter((p) => p.reportGroup === group && planFlag(p, today) === "Terlambat").length,
    };
  });
}

/** Sum of the per-group rows (Dashboard row 15). */
export function groupTotal(rows: GroupProgress[]): GroupProgress {
  const sum = (k: keyof GroupProgress) => rows.reduce((n, r) => n + (r[k] as number), 0);
  const totalStaff = sum("totalStaff");
  const completed = sum("completed");
  return {
    group: "Total",
    totalStaff,
    proposedReplacement: sum("proposedReplacement"),
    replacementDone: sum("replacementDone"),
    intensive: sum("intensive"),
    reassessed: sum("reassessed"),
    compliant: sum("compliant"),
    notCompliant: sum("notCompliant"),
    guidance: sum("guidance"),
    completed,
    completedShare: totalStaff ? completed / totalStaff : 0,
    late: sum("late"),
  };
}

/** "Progres rencana aksi per area" (Dashboard rows 20..31), in area order. */
export function areaProgress(input: DashboardInput, today: IsoDate): AreaProgress[] {
  const plans = activePlans(input.plans);
  return input.areas.map((area) => {
    const rows = plans.filter((p) => p.area === area);
    const dues = rows.map((p) => p.dueDate).filter((d): d is string => !!d).sort();
    return {
      area,
      rows: rows.length,
      done: rows.filter((p) => p.status === "Selesai").length,
      inProgress: rows.filter((p) => p.status === "Proses").length,
      notStarted: rows.filter((p) => p.status === "Belum Mulai").length,
      late: rows.filter((p) => planFlag(p, today) === "Terlambat").length,
      avgProgress: rows.length ? rows.reduce((n, p) => n + (p.progress ?? 0), 0) / rows.length : 0,
      earliestDue: dues[0] ?? null,
    };
  });
}

/** "Linimasa kunci" (Dashboard rows 36..43), from the consolidated recommendation slides. */
export const TIMELINE: ReadonlyArray<{ date: IsoDate; agenda: string }> = [
  { date: "2026-10-19", agenda: "Strong reminder staf BPN; grooming check harian semua cabang" },
  { date: "2026-10-31", agenda: "Penggantian 11 staf; keputusan strong reminder BPN; coaching assessment tertunda; kelas product knowledge" },
  { date: "2026-11-05", agenda: "Laporan progres cabang #1" },
  { date: "2026-11-13", agenda: "Penilaian ulang coaching intensif CGK & HLP, DPS, SUB" },
  { date: "2026-11-15", agenda: "SDM pengganti lulus training Uplifting; training staf SUB yang belum ikut" },
  { date: "2026-11-30", agenda: "Usulan seragam & atribut; target komunikasi touch point" },
  { date: "2026-12-11", agenda: "Evaluasi ulang KPS (KNO, BPN, SUB); penilaian pembinaan CGK & DPS (Mg-2 Des)" },
  { date: "2026-12-31", agenda: "Evaluasi program BMI dan bahasa Inggris & reservasi" },
];

/** "Sisa hari": days until the date, or null once it has passed ("Lewat"). */
export function daysLeft(date: IsoDate, today: IsoDate): number | null {
  return date < today ? null : diffDays(date, today);
}
