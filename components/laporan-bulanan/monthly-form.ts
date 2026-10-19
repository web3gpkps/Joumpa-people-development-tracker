/*
 * The phone form for one Laporan Bulanan row ("Ubah laporan"): text as typed ("4,5", "2026-11-04")
 * in, the patch of changed fields out. Pure, so it is tested without a browser; the rules are
 * monthly-input's, the same the grid and the Server Action use.
 */
import { parseDecimal } from "@/components/ui/Field";
import { toInputText } from "@/lib/format";
import { MONTHLY_FIELDS, compliantError, fieldError, type MonthlyField, type MonthlyPatch, type MonthlyValue } from "./monthly-input";
import type { MonthlyReportRow } from "./monthly-view";

export type MonthlyForm = Record<MonthlyField, string>;
export type MonthlyFormErrors = Partial<Record<MonthlyField, string>>;

const NUMBER_FIELDS: ReadonlySet<MonthlyField> = new Set(["activeStaff", "compliantStaff", "complaints", "satisfaction"]);

/** The form's starting text for a row: numbers with a decimal comma, blanks as "". */
export function formFromRow(row: MonthlyReportRow): MonthlyForm {
  const out = {} as MonthlyForm;
  for (const field of MONTHLY_FIELDS) {
    const value = row[field];
    out[field] = typeof value === "number" ? toInputText(value) : (value ?? "");
  }
  return out;
}

/** Typed text → value: blank is null, a number field parses "4,5", anything unreadable is NaN. */
function parse(field: MonthlyField, text: string): MonthlyValue {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (NUMBER_FIELDS.has(field)) return parseDecimal(trimmed);
  return trimmed;
}

/**
 * The patch of fields whose value differs from the row, or the message per invalid field.
 * "Staf berstatus Sesuai" is checked against "Total staf aktif" as both read in the form.
 */
export function formToPatch(
  row: MonthlyReportRow,
  form: MonthlyForm,
): { ok: true; patch: MonthlyPatch } | { ok: false; errors: MonthlyFormErrors } {
  const errors: MonthlyFormErrors = {};
  const values = {} as Record<MonthlyField, MonthlyValue>;
  for (const field of MONTHLY_FIELDS) {
    const value = parse(field, form[field]);
    values[field] = value;
    const message = fieldError(field, typeof value === "number" && Number.isNaN(value) ? "x" : value);
    if (message) errors[field] = message;
  }
  if (!errors.activeStaff && !errors.compliantStaff) {
    const both = compliantError(values.activeStaff as number | null, values.compliantStaff as number | null);
    if (both) errors.compliantStaff = both;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const patch: MonthlyPatch = {};
  for (const field of MONTHLY_FIELDS) {
    if ((row[field] ?? null) !== values[field]) patch[field] = values[field];
  }
  return { ok: true, patch };
}
