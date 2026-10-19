"use server";

import { refresh } from "next/cache";
import { resolveAccess, toLinkError, type LinkError } from "@/lib/workspace";
import { cleanPatch, isPlanField, PLAN_FIELD_LABEL, type PlanFieldErrors } from "./plan-input";

export type PlanSaveResult =
  | { ok: true; id: number; savedAt: string }
  | { ok: false; message: string; fieldErrors?: PlanFieldErrors };

export type PlanArchiveResult = { ok: true; savedAt: string } | { ok: false; message: string };

const CHECK_FIELDS = "Periksa isian yang ditandai.";

/** A pd_share_*_action_plan error in the words of this screen. */
function planError(error: { message?: string; code?: string; details?: string | null }): {
  linkError: LinkError;
  message: string;
  fieldErrors?: PlanFieldErrors;
} {
  const linkError = toLinkError(error);
  if (linkError.code === "out_of_scope") {
    return {
      linkError,
      message: "Rencana aksi ini sudah dihapus atau milik cabang lain. Muat ulang halaman untuk melihat daftar terbaru.",
    };
  }
  if (linkError.code === "invalid_input" && linkError.field && isPlanField(linkError.field)) {
    const field = linkError.field;
    const text =
      field === "report_group"
        ? "Pilih cabang."
        : field === "area"
          ? "Pilih area dari daftar."
          : `${PLAN_FIELD_LABEL[field]} tidak valid. Periksa lagi isinya.`;
    return { linkError, message: CHECK_FIELDS, fieldErrors: { [field]: text } };
  }
  return { linkError, message: linkError.message };
}

/**
 * Adds (id null) or changes one Rencana Aksi row with pd_share_save_action_plan. Only the keys
 * in `patch` change; "" or null clears a field. accessKey is access.key (a link token, "account"
 * or "owner"). The database keeps every scope to its own Cabang; a station scope adds to its own
 * Cabang without sending one, KPS and the owner must send `report_group` for a new row.
 */
export async function savePlan(
  accessKey: string,
  id: number | null,
  patch: Record<string, unknown>,
  options: { needsGroup?: boolean } = {},
): Promise<PlanSaveResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, message: resolved.error.message };

  if (id !== null && !Number.isSafeInteger(id)) {
    return { ok: false, message: "Rencana aksi tidak dikenali. Muat ulang halaman lalu coba lagi." };
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, message: "Tidak ada isian yang dikirim." };
  }
  const cleaned = cleanPatch(patch, { insert: id === null, needsGroup: options.needsGroup === true });
  if (!cleaned.ok) {
    const empty = Object.keys(cleaned.fieldErrors).length === 0;
    return {
      ok: false,
      message: empty ? "Ada isian yang tidak dikenal. Muat ulang halaman lalu coba lagi." : CHECK_FIELDS,
      fieldErrors: cleaned.fieldErrors,
    };
  }
  if (id !== null && Object.keys(cleaned.patch).length === 0) {
    return { ok: true, id, savedAt: new Date().toISOString() };
  }

  const { data, error } = await resolved.rpc("pd_share_save_action_plan", {
    // The generated type is non-nullable; NULL inserts a new row (RPC contract).
    p_id: id as number,
    p_patch: cleaned.patch,
  });
  if (error) {
    const { message, fieldErrors } = planError(error);
    return { ok: false, message, fieldErrors };
  }
  const row = (data as { row?: { id?: number } } | null)?.row;
  const savedId = typeof row?.id === "number" ? row.id : id;
  if (savedId === null) return { ok: false, message: "Tidak bisa disimpan. Coba lagi." };

  refresh();
  return { ok: true, id: savedId, savedAt: new Date().toISOString() };
}

/** "Hapus": archives the row (gone from the app and the Google Sheet, restorable by the owner). */
export async function archivePlan(accessKey: string, id: number): Promise<PlanArchiveResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, message: resolved.error.message };
  if (!Number.isSafeInteger(id)) return { ok: false, message: "Rencana aksi tidak dikenali. Muat ulang halaman." };

  const { error } = await resolved.rpc("pd_share_archive_action_plan", { p_id: id });
  if (error) return { ok: false, message: planError(error).message };

  refresh();
  return { ok: true, savedAt: new Date().toISOString() };
}

/** "Pulihkan": owner only (the database answers forbidden_field to anyone else). */
export async function restorePlan(accessKey: string, id: number): Promise<PlanArchiveResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, message: resolved.error.message };
  if (!Number.isSafeInteger(id)) return { ok: false, message: "Rencana aksi tidak dikenali. Muat ulang halaman." };

  const { error } = await resolved.rpc("pd_share_restore_action_plan", { p_id: id });
  if (error) {
    const linkError = toLinkError(error);
    if (linkError.code === "forbidden_field") {
      return { ok: false, message: "Hanya pengelola aplikasi yang bisa memulihkan rencana aksi." };
    }
    if (linkError.code === "out_of_scope") {
      return { ok: false, message: "Rencana aksi ini sudah dipulihkan. Muat ulang halaman." };
    }
    return { ok: false, message: linkError.message };
  }

  refresh();
  return { ok: true, savedAt: new Date().toISOString() };
}
