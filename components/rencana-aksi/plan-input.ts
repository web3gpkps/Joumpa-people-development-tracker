/*
 * The pd_share_save_action_plan patch: field names, limits and checks shared by the forms, the
 * grid and the Server Action. Pure and client-safe. The database checks the same rules again
 * (supabase/migrations/20261019100200_pd_share_rpcs.sql), plus the Area list and the scope.
 */
import { isValidIsoDate } from "@/lib/dates";
import { STATUSES } from "@/lib/pd-rules";

/** Patch keys, in workbook column order. */
export const PLAN_FIELDS = [
  "item_no",
  "area",
  "action",
  "report_group",
  "target",
  "due_date",
  "pic",
  "status",
  "progress",
  "done_on",
  "evidence",
  "notes",
] as const;

export type PlanField = (typeof PLAN_FIELDS)[number];

/** A patch value: text, a 'YYYY-MM-DD' date, the progress number, or null to clear. */
export type PlanPatch = Partial<Record<PlanField, string | number | null>>;

export type PlanFieldErrors = Partial<Record<PlanField, string>>;

/** Column names as the screen shows them. */
export const PLAN_FIELD_LABEL: Record<PlanField, string> = {
  item_no: "No",
  area: "Area",
  action: "Tindakan",
  report_group: "Cabang",
  target: "Sasaran / keterangan",
  due_date: "Batas waktu",
  pic: "PIC",
  status: "Status",
  progress: "% Progres",
  done_on: "Tgl selesai",
  evidence: "Bukti / dokumen",
  notes: "Kendala / catatan",
};

/** Text limits of the RPC (pd_p_text p_max); 4000 for the long texts. */
export const PLAN_MAX_LENGTH: Partial<Record<PlanField, number>> = {
  item_no: 10,
  area: 80,
  action: 4000,
  report_group: 20,
  target: 4000,
  pic: 500,
  evidence: 4000,
  notes: 4000,
};

const DATE_FIELDS: ReadonlySet<PlanField> = new Set(["due_date", "done_on"]);
const REQUIRED: ReadonlySet<PlanField> = new Set(["area", "action", "report_group"]);

export function isPlanField(key: string): key is PlanField {
  return (PLAN_FIELDS as readonly string[]).includes(key);
}

/** Parses "75", "75%", "75,0" into a whole number; NaN when it is not one. Blank is null. */
export function parseProgress(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : Number.NaN;
  const text = raw.trim().replace(/%$/, "").trim().replace(",", ".");
  if (text === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(text)) return Number.NaN;
  return Number(text);
}

type CleanResult = { ok: true; patch: PlanPatch } | { ok: false; fieldErrors: PlanFieldErrors };

/**
 * Checks and normalises a patch: trims text ("" becomes null), keeps dates as 'YYYY-MM-DD',
 * progress as a whole number 0..100, status from the list. `insert` adds the required fields
 * of a new row (Area, Tindakan; Cabang only when `needsGroup`, i.e. for KPS).
 * Unknown keys are rejected so a typo never reaches the database as forbidden input.
 */
export function cleanPatch(
  input: Record<string, unknown>,
  { insert = false, needsGroup = false }: { insert?: boolean; needsGroup?: boolean } = {},
): CleanResult {
  const patch: PlanPatch = {};
  const errors: PlanFieldErrors = {};

  for (const [key, raw] of Object.entries(input ?? {})) {
    if (!isPlanField(key)) return { ok: false, fieldErrors: {} };
    if (key === "progress") {
      const n = parseProgress(raw as string | number | null);
      if (n === null) patch.progress = 0;
      else if (!Number.isInteger(n) || n < 0 || n > 100) errors.progress = "Isi bilangan bulat 0 sampai 100.";
      else patch.progress = n;
      continue;
    }
    if (raw !== null && raw !== undefined && typeof raw !== "string") {
      errors[key] = `${PLAN_FIELD_LABEL[key]} tidak valid.`;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    const value = text === "" ? null : key === "item_no" || key === "pic" ? text.replace(/\s+/g, " ") : text;

    if (value === null) {
      // A station scope adds to its own Cabang: no report_group is sent at all.
      if (key === "report_group" && insert && !needsGroup) continue;
      if (REQUIRED.has(key)) {
        errors[key] = key === "report_group" ? "Pilih cabang." : `${PLAN_FIELD_LABEL[key]} wajib diisi.`;
      } else if (key === "status") {
        patch.status = "Belum Mulai";
      } else {
        patch[key] = null;
      }
      continue;
    }
    if (DATE_FIELDS.has(key)) {
      if (!isValidIsoDate(value) || value < "2000-01-01" || value > "2100-12-31") {
        errors[key] = "Tanggal tidak valid.";
      } else patch[key] = value;
      continue;
    }
    if (key === "status" && !(STATUSES as readonly string[]).includes(value)) {
      errors.status = "Pilih salah satu status.";
      continue;
    }
    const max = PLAN_MAX_LENGTH[key];
    if (max !== undefined && value.length > max) {
      errors[key] = `Paling panjang ${max} karakter (sekarang ${value.length}).`;
      continue;
    }
    patch[key] = value;
  }

  if (insert) {
    if (!("area" in patch) && !errors.area) errors.area = "Pilih area.";
    if (!("action" in patch) && !errors.action) errors.action = "Tindakan wajib diisi.";
    if (needsGroup && !("report_group" in patch) && !errors.report_group) errors.report_group = "Pilih cabang.";
  }

  return Object.keys(errors).length > 0 ? { ok: false, fieldErrors: errors } : { ok: true, patch };
}

/** A form's values: every field as the text its control holds. */
export type PlanFormValues = Record<PlanField, string>;

/** Form values of a stored row ("" for empty). */
export function formValues(row: {
  itemNo: string | null;
  area: string;
  action: string;
  reportGroup: string;
  target: string | null;
  dueDate: string | null;
  pic: string | null;
  status: string;
  progress: number;
  doneOn: string | null;
  evidence: string | null;
  notes: string | null;
}): PlanFormValues {
  return {
    item_no: row.itemNo ?? "",
    area: row.area,
    action: row.action,
    report_group: row.reportGroup,
    target: row.target ?? "",
    due_date: row.dueDate ?? "",
    pic: row.pic ?? "",
    status: row.status,
    progress: String(row.progress),
    done_on: row.doneOn ?? "",
    evidence: row.evidence ?? "",
    notes: row.notes ?? "",
  };
}

const same = (field: PlanField, a: string, b: string) => {
  if (field !== "progress") return a.trim() === b.trim();
  const na = parseProgress(a);
  const nb = parseProgress(b);
  return Number.isNaN(na ?? 0) || Number.isNaN(nb ?? 0) ? a.trim() === b.trim() : (na ?? 0) === (nb ?? 0);
};

/** Only the fields whose value changed (text compared trimmed), so a save never overwrites a parallel edit of another field. */
export function changedFields(before: PlanFormValues, after: Partial<PlanFormValues>): Partial<PlanFormValues> {
  const out: Partial<PlanFormValues> = {};
  for (const field of PLAN_FIELDS) {
    const next = after[field];
    if (next === undefined) continue;
    if (!same(field, before[field], next)) out[field] = next;
  }
  return out;
}

/**
 * What choosing "Selesai" may fill in: % progres 100 and Tgl selesai today, each only when not
 * already set that way. Empty when nothing would change. Never applied without the person's click.
 */
export function completionFill(
  values: Pick<PlanFormValues, "progress" | "done_on">,
  today: string,
): Partial<Pick<PlanFormValues, "progress" | "done_on">> {
  const fill: Partial<Pick<PlanFormValues, "progress" | "done_on">> = {};
  if (parseProgress(values.progress) !== 100) fill.progress = "100";
  if (values.done_on.trim() === "") fill.done_on = today;
  return fill;
}

/** Fields of the "Tambah rencana aksi" form, in form order. */
export const NEW_PLAN_FIELDS = ["area", "action", "report_group", "item_no", "target", "due_date", "pic"] as const;

/**
 * The insert patch of the "Tambah" form: Area and Tindakan always (so a blank one is reported),
 * Cabang only for KPS (a station scope adds to its own), the optional fields only when filled.
 */
export function newPlanInput(values: PlanFormValues, isKps: boolean): Partial<PlanFormValues> {
  const out: Partial<PlanFormValues> = {};
  for (const field of NEW_PLAN_FIELDS) {
    if (field === "report_group" && !isKps) continue;
    const required = field === "area" || field === "action" || field === "report_group";
    if (required || values[field].trim() !== "") out[field] = values[field];
  }
  return out;
}
