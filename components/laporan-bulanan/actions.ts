"use server";

import { refresh } from "next/cache";
import { resolveAccess, toLinkError, type LinkError } from "@/lib/workspace";
import { checkMonthlyInput, fieldOfColumn, isPeriod, monthlyFieldMessage, type MonthlyReportInput } from "./monthly-input";

export type MonthlyActionResult = { ok: true; savedAt: string } | { ok: false; error: LinkError };

/** An RPC error in the words of the screen: a known field gets its own sentence. */
function saveError(error: { message?: string; code?: string; details?: string | null }): LinkError {
  const linkError = toLinkError(error);
  if (linkError.code === "invalid_input") {
    const field = fieldOfColumn(linkError.field);
    if (field) return { ...linkError, message: monthlyFieldMessage(field) };
    if (linkError.field === "report_group") return { ...linkError, message: "Cabang tidak dikenal. Pilih cabang dari daftar." };
    if (linkError.field === "period") return { ...linkError, message: "Bulan laporan tidak valid." };
  }
  if (linkError.code === "forbidden_field") {
    return { ...linkError, message: "Laporan bulanan hanya bisa diisi oleh KPS." };
  }
  return linkError;
}

/**
 * Adds or updates one Cabang's monthly report (pd_share_save_monthly_report). Only the fields in
 * `patch` change; null clears one. A new report is the same call with its due date as the patch.
 * accessKey is access.key (a KPS link token, "account" or "owner"); the database refuses any
 * scope but KPS.
 */
export async function saveMonthlyReport(accessKey: string, input: MonthlyReportInput): Promise<MonthlyActionResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const checked = checkMonthlyInput(input);
  if (!checked.ok) return checked;

  const { error } = await resolved.rpc("pd_share_save_monthly_report", {
    p_report_group: checked.reportGroup,
    p_period: checked.period,
    p_patch: checked.patch,
  });
  if (error) return { ok: false, error: saveError(error) };

  refresh();
  return { ok: true, savedAt: new Date().toISOString() };
}

/** Deletes one Cabang's report for one month (pd_share_delete_monthly_report). KPS only. */
export async function deleteMonthlyReport(accessKey: string, reportGroup: string, period: string): Promise<MonthlyActionResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  if (typeof reportGroup !== "string" || reportGroup.trim() === "" || !isPeriod(period)) {
    return {
      ok: false,
      error: { code: "invalid_input", field: "period", message: "Laporan tidak dikenali. Muat ulang halaman lalu coba lagi." },
    };
  }

  const { error } = await resolved.rpc("pd_share_delete_monthly_report", {
    p_report_group: reportGroup,
    p_period: period,
  });
  if (error) {
    const linkError = toLinkError(error);
    // The function answers out_of_scope when no row matched: someone else deleted it first.
    if (linkError.code === "out_of_scope") {
      refresh();
      return { ok: false, error: { ...linkError, message: "Laporan ini sudah tidak ada. Halaman dimuat ulang." } };
    }
    return { ok: false, error: saveError(error) };
  }

  refresh();
  return { ok: true, savedAt: new Date().toISOString() };
}
