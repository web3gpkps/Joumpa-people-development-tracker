/*
 * What Laporan Bulanan may write (pd_share_save_monthly_report): the eight input columns, checked
 * against the same ranges as the database before a round trip. Pure and client-safe, so the grid,
 * the phone form and the Server Action share one rule set. Only keys present in a patch change;
 * null (or a blank text) clears the cell.
 */
import { isValidIsoDate } from "@/lib/dates";
import { YA_BELUM_TIDAK } from "@/lib/pd-rules";
import type { LinkError } from "@/lib/workspace/errors";

/** The input columns, camelCased as the workspace rows carry them. */
export const MONTHLY_FIELDS = [
  "dueOn",
  "receivedOn",
  "activeStaff",
  "compliantStaff",
  "complaints",
  "responded",
  "satisfaction",
  "notes",
] as const;

export type MonthlyField = (typeof MONTHLY_FIELDS)[number];

/** Column name per field, as the RPC's jsonb patch and its error `details` name them. */
export const MONTHLY_COLUMN: Record<MonthlyField, string> = {
  dueOn: "due_on",
  receivedOn: "received_on",
  activeStaff: "active_staff",
  compliantStaff: "compliant_staff",
  complaints: "complaints",
  responded: "responded",
  satisfaction: "satisfaction",
  notes: "notes",
};

/** The field behind an RPC error's column name, to put the message on the right cell. */
export function fieldOfColumn(column: string | undefined): MonthlyField | null {
  return MONTHLY_FIELDS.find((f) => MONTHLY_COLUMN[f] === column) ?? null;
}

export type MonthlyValue = string | number | null;
export type MonthlyPatch = Partial<Record<MonthlyField, MonthlyValue>>;

export type MonthlyReportInput = {
  reportGroup: string;
  /** First day of the month, 'YYYY-MM-01'. */
  period: string;
  patch: MonthlyPatch;
};

/** Upper bound of every count (the database check). */
export const COUNT_MAX = 10000;
/** Indeks kepuasan JOUMPA: 0 to 5, two decimals. */
export const SATISFACTION_MAX = 5;
/** Catatan: the database cuts at 4000 characters. */
export const NOTES_MAX = 4000;

const MESSAGES: Record<MonthlyField, string> = {
  dueOn: "Jatuh tempo laporan harus tanggal yang valid.",
  receivedOn: "Tanggal diterima harus tanggal yang valid.",
  activeStaff: `Total staf aktif harus bilangan bulat 0 sampai ${COUNT_MAX}.`,
  compliantStaff: `Staf berstatus Sesuai harus bilangan bulat 0 sampai ${COUNT_MAX}.`,
  complaints: `Keluhan harus bilangan bulat 0 sampai ${COUNT_MAX}.`,
  responded: "Pilih Ya, Belum, atau Tidak.",
  satisfaction: "Indeks kepuasan harus 0 sampai 5, paling banyak dua angka di belakang koma.",
  notes: `Catatan paling panjang ${NOTES_MAX} karakter.`,
};

/** The message for an invalid field (shared by the grid, the form and the action). */
export function monthlyFieldMessage(field: MonthlyField): string {
  return MESSAGES[field];
}

/** 'YYYY-MM-01' for a real month in 2000..2100. */
export function isPeriod(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-01$/.test(value) && isValidIsoDate(value);
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= COUNT_MAX;
}

function isSatisfaction(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= SATISFACTION_MAX &&
    Math.round(value * 100) / 100 === value
  );
}

/** Normalises one value; undefined when it is not acceptable for the field. */
function clean(field: MonthlyField, value: unknown): MonthlyValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  switch (field) {
    case "dueOn":
    case "receivedOn":
      return isValidIsoDate(value) ? value : undefined;
    case "activeStaff":
    case "compliantStaff":
    case "complaints":
      return isCount(value) ? (value as number) : undefined;
    case "satisfaction":
      return isSatisfaction(value) ? (value as number) : undefined;
    case "responded":
      return (YA_BELUM_TIDAK as readonly unknown[]).includes(value) ? (value as string) : undefined;
    case "notes": {
      if (typeof value !== "string") return undefined;
      const text = value.trim();
      return text.length > NOTES_MAX ? undefined : text;
    }
  }
}

/** The message when `value` is not acceptable for `field` (null, a blank text or an in-range value is). */
export function fieldError(field: MonthlyField, value: unknown): string | null {
  return clean(field, value) === undefined ? MESSAGES[field] : null;
}

/** "Staf berstatus Sesuai" cannot exceed "Total staf aktif" when both are known. */
export function compliantError(active: number | null | undefined, compliant: number | null | undefined): string | null {
  if (active === null || active === undefined || compliant === null || compliant === undefined) return null;
  return compliant > active ? "Staf berstatus Sesuai tidak boleh lebih dari total staf aktif." : null;
}

export type CheckedInput =
  | { ok: true; reportGroup: string; period: string; patch: Record<string, MonthlyValue> }
  | { ok: false; error: LinkError };

function invalid(field: string, message: string): CheckedInput {
  return { ok: false, error: { code: "invalid_input", field, message } };
}

/**
 * Checks a Laporan Bulanan write and turns it into the RPC's jsonb patch (column names). Unknown
 * keys are rejected rather than silently dropped, so a typo never reads as "saved".
 */
export function checkMonthlyInput(input: unknown): CheckedInput {
  if (!input || typeof input !== "object") return invalid("patch", "Data laporan tidak lengkap. Muat ulang halaman lalu coba lagi.");
  const { reportGroup, period, patch } = input as Partial<MonthlyReportInput>;
  if (typeof reportGroup !== "string" || reportGroup.trim() === "" || reportGroup.length > 100) {
    return invalid("report_group", "Pilih cabang.");
  }
  if (!isPeriod(period)) return invalid("period", "Pilih bulan laporan.");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return invalid("patch", "Data laporan tidak lengkap. Muat ulang halaman lalu coba lagi.");
  }

  const out: Record<string, MonthlyValue> = {};
  for (const [key, value] of Object.entries(patch)) {
    const field = MONTHLY_FIELDS.find((f) => f === key);
    if (!field) return invalid("patch", "Ada isian yang tidak dikenal. Muat ulang halaman lalu coba lagi.");
    const cleaned = clean(field, value);
    if (cleaned === undefined) return invalid(MONTHLY_COLUMN[field], MESSAGES[field]);
    out[MONTHLY_COLUMN[field]] = cleaned;
  }

  const both = compliantError(out.active_staff as number | null | undefined, out.compliant_staff as number | null | undefined);
  if (both) return invalid("compliant_staff", both);

  return { ok: true, reportGroup: reportGroup.trim(), period, patch: out };
}
