"use server";

import { refresh } from "next/cache";
import { resolveAccess, toLinkError, type LinkError } from "@/lib/workspace";
import { FIELD_MESSAGES, checkPatch, type PatchKey, type ReplacementPatch } from "./model";

export type ReplacementActionResult =
  | { ok: true; id: number | null; savedAt: string }
  | { ok: false; error: LinkError };

const UNKNOWN_ROW = "Baris penggantian tidak dikenal. Muat ulang halaman lalu coba lagi.";

function invalid(field: string, message: string): ReplacementActionResult {
  return { ok: false, error: { code: "invalid_input", field, message } };
}

/** The database's error in the words of the form (invalid_input names the column). */
function replacementError(error: { message?: string; code?: string; details?: string | null }): LinkError {
  const linkError = toLinkError(error);
  if (linkError.code === "invalid_input" && linkError.field && linkError.field in FIELD_MESSAGES) {
    return { ...linkError, message: FIELD_MESSAGES[linkError.field as PatchKey] };
  }
  return linkError;
}

/**
 * pd_share_save_replacement: adds a row (id null) or changes only the fields in `patch`.
 * accessKey is access.key (a KPS link token, "account" or "owner"); KPS-only is enforced in SQL.
 * While the row has an ID SDM the database copies Nama and Cabang from Tracker Staf, and Status
 * penarikan "Selesai" on a Penggantian row marks that staff member "Diganti" there.
 */
export async function saveReplacement(
  accessKey: string,
  id: number | null,
  patch: ReplacementPatch,
): Promise<ReplacementActionResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  if (id !== null && !(Number.isInteger(id) && id > 0)) return invalid("id", UNKNOWN_ROW);

  const checked = checkPatch(patch);
  if (!checked.ok) return invalid(checked.field, checked.message);
  if (id === null && !checked.patch.staff_code) return invalid("staff_code", FIELD_MESSAGES.staff_code);

  const { data, error } = await resolved.rpc("pd_share_save_replacement", {
    // null inserts; the generated type does not know the column is nullable here.
    p_id: id as number,
    p_patch: checked.patch,
  });
  if (error) return { ok: false, error: replacementError(error) };

  const row = (data as { row?: { id?: number } } | null)?.row;
  refresh();
  return { ok: true, id: typeof row?.id === "number" ? row.id : id, savedAt: new Date().toISOString() };
}

/** pd_share_delete_replacement. The staff member in Tracker Staf is not touched. */
export async function deleteReplacement(accessKey: string, id: number): Promise<ReplacementActionResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  if (!(Number.isInteger(id) && id > 0)) return invalid("id", UNKNOWN_ROW);

  const { error } = await resolved.rpc("pd_share_delete_replacement", { p_id: id });
  if (error) return { ok: false, error: toLinkError(error) };

  refresh();
  return { ok: true, id, savedAt: new Date().toISOString() };
}
