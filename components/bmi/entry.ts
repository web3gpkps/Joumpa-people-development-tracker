/*
 * Input checks for one BMI check (date, height, weight), shared by the phone card, the cell
 * dialog and the add dialog. Pure, covered by entry.test.ts. The database re-checks the
 * same ranges (bmi_checks: height 120 to 210, weight 30 to 200).
 */
import { parseDecimal } from "@/components/ui/Field";
import type { LinkError } from "@/lib/workspace/errors";
import { hasMoreThanOneDecimal, isPlausibleDate } from "./format";

export const HEIGHT_RANGE = "Tinggi 120 sampai 210 cm.";
export const WEIGHT_RANGE = "Berat 30 sampai 200 kg.";

export type CheckField = "date" | "height" | "weight";
export type CheckErrors = Partial<Record<CheckField | "commitment", string>>;
export type CheckInputs = Record<CheckField, string>;

/** undefined when the text is empty (the caller decides if empty is allowed) or in range. */
export function heightError(raw: string): string | undefined {
  const value = parseDecimal(raw);
  if (value === null) return undefined;
  if (Number.isNaN(value)) return "Tulis angka, misalnya 165,5.";
  if (hasMoreThanOneDecimal(raw)) return "Cukup satu angka di belakang koma.";
  if (value < 120 || value > 210) return HEIGHT_RANGE;
  return undefined;
}

export function weightError(raw: string): string | undefined {
  const value = parseDecimal(raw);
  if (value === null) return undefined;
  if (Number.isNaN(value)) return "Tulis angka, misalnya 62,5.";
  if (hasMoreThanOneDecimal(raw)) return "Cukup satu angka di belakang koma.";
  if (value < 30 || value > 200) return WEIGHT_RANGE;
  return undefined;
}

export type CheckPlan =
  | { ok: true; check: { checkDate: string; heightCm: number; weightKg: number } }
  | { ok: false; errors: CheckErrors };

/** A complete check from the three inputs: all three are needed, because a stored check has them all. */
export function planCheck(inputs: CheckInputs): CheckPlan {
  const errors: CheckErrors = {};
  const height = parseDecimal(inputs.height);
  const weight = parseDecimal(inputs.weight);
  if (height === null) errors.height = "Isi tinggi badan.";
  else errors.height = heightError(inputs.height);
  if (weight === null) errors.weight = "Isi berat badan.";
  else errors.weight = weightError(inputs.weight);
  if (!inputs.date) errors.date = "Isi tanggal cek.";
  else if (!isPlausibleDate(inputs.date)) errors.date = "Tanggal cek tidak valid.";

  const found: CheckErrors = {};
  for (const key of ["date", "height", "weight"] as const) if (errors[key]) found[key] = errors[key];
  if (found.date || found.height || found.weight) return { ok: false, errors: found };
  return { ok: true, check: { checkDate: inputs.date, heightCm: height as number, weightKg: weight as number } };
}

/** Maps a server refusal to the input it is about. */
export function serverCheckErrors(error: LinkError): CheckErrors {
  if (error.code !== "invalid_input") return {};
  if (error.field === "height_cm") return { height: HEIGHT_RANGE };
  if (error.field === "weight_kg") return { weight: WEIGHT_RANGE };
  if (error.field === "check_date") return { date: "Tanggal cek tidak valid." };
  if (error.field === "commitment") return { commitment: error.message };
  return {};
}
