"use server";

import { refresh } from "next/cache";
import { resolveAccess, toLinkError, type LinkError } from "@/lib/workspace";
import { checkPatch } from "./patch";

export type TrackerSaveResult =
  | { ok: true; code: string; name: string; savedAt: string }
  | { ok: false; error: LinkError };

export type TrackerDeleteResult = { ok: true; code: string } | { ok: false; error: LinkError };

function failed(error: { message?: string; code?: string; details?: string | null }): LinkError {
  const linkError = toLinkError(error);
  if (linkError.code === "forbidden_field") {
    return { ...linkError, message: "Tracker Staf hanya bisa diubah oleh KPS." };
  }
  return linkError;
}

/**
 * Saves Tracker Staf fields of one person (pd_share_save_staff). `code` null adds a new staff
 * member (station and name required; the database assigns the code, e.g. BPN-06). Only the keys
 * in `patch` change; null or "" clears a field. accessKey is access.key.
 */
export async function saveTrackerStaff(accessKey: string, code: string | null, patch: unknown): Promise<TrackerSaveResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const checked = checkPatch(patch, { isNew: code === null });
  if (!checked.ok) {
    return {
      ok: false,
      error: { code: "invalid_input", field: checked.field === "patch" ? undefined : checked.field, message: checked.message },
    };
  }

  const { data, error } = await resolved.rpc("pd_share_save_staff", {
    p_code: code as string,
    p_patch: checked.patch,
  });
  if (error) return { ok: false, error: failed(error) };
  const row = (data as { row?: { code?: string; name?: string } } | null)?.row;
  if (!row?.code) return { ok: false, error: { code: "unknown", message: "Tidak bisa disimpan. Coba lagi." } };

  refresh();
  return { ok: true, code: row.code, name: row.name ?? "", savedAt: new Date().toISOString() };
}

/** Deletes one staff member and their BMI checks (pd_share_delete_staff, KPS only). */
export async function deleteTrackerStaff(accessKey: string, code: string): Promise<TrackerDeleteResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  if (typeof code !== "string" || code.trim() === "") {
    return { ok: false, error: { code: "invalid_input", message: "Staf tidak dikenali. Muat ulang halaman." } };
  }

  const { error } = await resolved.rpc("pd_share_delete_staff", { p_code: code });
  if (error) {
    const linkError = toLinkError(error);
    return {
      ok: false,
      error: linkError.code === "forbidden_field" ? { ...linkError, message: "Hanya KPS yang bisa menghapus staf." } : linkError,
    };
  }

  refresh();
  return { ok: true, code };
}
