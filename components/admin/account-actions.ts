"use server";

import { refresh } from "next/cache";
import { isAccountStatus, KPS_BRANCH, UNASSIGNED_BRANCH } from "@/lib/accounts/rules";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type AccountActionResult = { ok: true; message: string } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRANCH = /^[A-Z0-9]{2,5}$/;

const FAILED: AccountActionResult = { ok: false, message: "Perubahan belum tersimpan. Coba lagi." };

/**
 * Approve, deactivate, reactivate or move an account to another branch. Owner only: requireAdmin()
 * here, and the profiles RLS policy (is_admin()) plus the column grant in the database. A branch is
 * only accepted when it is KPS or a station in public.stations (a trigger re-checks it).
 */
export async function updateAccount(input: {
  id: string;
  status?: string;
  branch?: string;
}): Promise<AccountActionResult> {
  await requireAdmin();
  if (typeof input.id !== "string" || !UUID.test(input.id)) return { ok: false, message: "Akun tidak dikenali." };

  const patch: { status?: "pending" | "active" | "inactive"; branch_code?: string } = {};
  if (input.status !== undefined) {
    if (!isAccountStatus(input.status)) return { ok: false, message: "Status akun tidak dikenali." };
    patch.status = input.status;
  }
  if (input.branch !== undefined) {
    const branch = String(input.branch).trim().toUpperCase();
    if (branch === UNASSIGNED_BRANCH || (branch !== KPS_BRANCH && !BRANCH.test(branch))) {
      return { ok: false, message: "Pilih cabang dari daftar." };
    }
    patch.branch_code = branch;
  }
  if (!patch.status && !patch.branch_code) return { ok: false, message: "Tidak ada yang diubah." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", input.id)
    .select("status, branch_code, full_name")
    .maybeSingle();

  if (error) {
    // 23514: the branch is not a station, or an account without a real branch was activated.
    if (error.code === "23514") return { ok: false, message: "Cabang ini tidak ada di daftar stasiun. Pilih cabang lain." };
    return FAILED;
  }
  if (!data) return { ok: false, message: "Akun ini sudah tidak ada. Muat ulang halaman." };

  refresh();
  const who = data.full_name || "Akun";
  if (patch.status === "active") return { ok: true, message: `${who} disetujui untuk ${data.branch_code}.` };
  if (patch.status === "inactive") return { ok: true, message: `${who} dinonaktifkan. Akun ini tidak bisa lagi membuka data.` };
  if (patch.status === "pending") return { ok: true, message: `${who} dikembalikan ke daftar menunggu.` };
  return { ok: true, message: `Cabang ${who} diganti ke ${data.branch_code}.` };
}

/** Remove an account and its login. Data it wrote stays, with the author cleared. The owner cannot be removed. */
export async function deleteAccount(id: string): Promise<AccountActionResult> {
  await requireAdmin();
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, message: "Akun tidak dikenali." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_account", { p_user_id: id });
  if (error) {
    if (error.message === "cannot_delete_owner") return { ok: false, message: "Akun pengelola tidak bisa dihapus dari sini." };
    return { ok: false, message: "Akun belum terhapus. Coba lagi." };
  }
  refresh();
  return { ok: true, message: "Akun dihapus." };
}
