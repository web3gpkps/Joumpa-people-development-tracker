"use server";

import { refresh } from "next/cache";
import { resolveAccess, toLinkError, type LinkError } from "@/lib/workspace";
import { isPlausibleDate } from "@/components/bmi/format";

export type BmiActionResult =
  | { ok: true; deleted: boolean; savedAt: string }
  | { ok: false; error: LinkError };

export type BmiCheckInput = {
  staffCode: string;
  period: number;
  /** 'YYYY-MM-DD' or null. */
  checkDate: string | null;
  /** Both null deletes the period's check. */
  heightCm: number | null;
  weightKg: number | null;
};

export type BmiProfileInput = {
  staffCode: string;
  gender: "L" | "P" | null;
  /** "Catatan / Program Penyesuaian BB". */
  bmiNote: string | null;
};

function invalid(field: string, message: string): BmiActionResult {
  return { ok: false, error: { code: "invalid_input", field, message } };
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

/**
 * pd_share_save_check: upsert one period's height and weight; both empty deletes it.
 * accessKey is access.key (a link token, "account" or "owner"); scope and ranges are checked in SQL.
 */
export async function saveBmiCheck(accessKey: string, input: BmiCheckInput): Promise<BmiActionResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  if (!input || typeof input.staffCode !== "string" || !Number.isInteger(input.period)) {
    return invalid("staff_code", "Data cek tidak lengkap. Muat ulang halaman lalu coba lagi.");
  }
  if (input.checkDate !== null && (typeof input.checkDate !== "string" || !isPlausibleDate(input.checkDate))) {
    return invalid("check_date", "Tanggal cek tidak valid.");
  }
  if (!isNumberOrNull(input.heightCm)) return invalid("height_cm", "Tinggi harus berupa angka.");
  if (!isNumberOrNull(input.weightKg)) return invalid("weight_kg", "Berat harus berupa angka.");

  const { error } = await resolved.rpc("pd_share_save_check", {
    p_staff_code: input.staffCode,
    p_period: input.period,
    p_check_date: input.checkDate as string,
    p_height_cm: input.heightCm as number,
    p_weight_kg: input.weightKg as number,
  });
  if (error) return { ok: false, error: toLinkError(error) };

  refresh();
  return {
    ok: true,
    deleted: input.heightCm === null && input.weightKg === null,
    savedAt: new Date().toISOString(),
  };
}

/** pd_share_save_staff: writes L/P and the BMI programme note together. */
export async function saveBmiProfile(accessKey: string, input: BmiProfileInput): Promise<BmiActionResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  if (!input || typeof input.staffCode !== "string") {
    return invalid("staff_code", "Data SDM tidak lengkap. Muat ulang halaman lalu coba lagi.");
  }
  if (input.gender !== null && input.gender !== "L" && input.gender !== "P") {
    return invalid("gender", "Pilih L, P, atau kosongkan.");
  }
  if (input.bmiNote !== null && typeof input.bmiNote !== "string") {
    return invalid("bmi_note", "Catatan tidak valid.");
  }

  const { error } = await resolved.rpc("pd_share_save_staff", {
    p_code: input.staffCode,
    p_patch: { gender: input.gender, bmi_note: input.bmiNote },
  });
  if (error) return { ok: false, error: toLinkError(error) };

  refresh();
  return { ok: true, deleted: false, savedAt: new Date().toISOString() };
}
