"use server";

import { refresh } from "next/cache";
import { parsePolicy, runSync, type RunSummary } from "@/lib/sync/run";
import { GoogleSheets } from "@/lib/sync/sheets";
import { SupabaseSyncStore } from "@/lib/sync/supabase";
import { SYNC_TABLES } from "@/lib/sync/tables";
import type { SyncTable } from "@/lib/sync/types";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type ResolveResult = { ok: true; resolvedAt: string } | { ok: false; message: string };
export type SyncNowResult = { ok: boolean; message: string };

/** "Tandai selesai": records that the owner has reviewed one conflict log row. */
export async function markConflictResolved(id: number): Promise<ResolveResult> {
  const admin = await requireAdmin();
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, message: "Baris konflik tidak dikenali." };

  const supabase = await createClient();
  const resolvedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("pd_sync_conflicts")
    .update({ resolved_at: resolvedAt, resolved_by: admin.userId })
    .eq("id", id)
    .is("resolved_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: "Belum tersimpan. Coba lagi." };
  if (!data) return { ok: false, message: "Konflik ini sudah ditandai selesai sebelumnya." };
  refresh();
  return { ok: true, resolvedAt };
}

/** One run in this request, same engine as POST /api/sync/run. */
async function runNow(allowMassDelete?: SyncTable[]): Promise<RunSummary | SyncNowResult> {
  let deps;
  try {
    deps = { store: SupabaseSyncStore.fromEnv(), sheets: GoogleSheets.fromEnv() };
  } catch {
    return { ok: false, message: "Sinkronisasi belum dikonfigurasi di server." };
  }
  return runSync(deps, { conflictPolicy: parsePolicy(process.env.CONFLICT_POLICY), allowMassDelete });
}

function failure(summary: RunSummary): SyncNowResult | null {
  if (summary.status === "busy") return { ok: false, message: "Sinkronisasi lain sedang berjalan. Coba lagi sebentar lagi." };
  if (summary.status === "error") return { ok: false, message: `Sinkronisasi gagal: ${summary.errors?.[0] ?? "sebab tidak diketahui"}` };
  return null;
}

/** "Sinkronkan sekarang": a normal run without waiting for the next minute. */
export async function runSyncNow(): Promise<SyncNowResult> {
  await requireAdmin();
  const summary = await runNow();
  if (!("status" in summary)) return summary;
  const failed = failure(summary);
  if (failed) return failed;
  refresh();
  const t = Object.values(summary.tables ?? {});
  const toDb = t.reduce((n, c) => n + c.dbInserts + c.dbUpdates + c.dbDeletes, 0);
  const toSheet = t.reduce((n, c) => n + c.sheetCellUpdates + c.sheetAppends + c.sheetRowDeletes, 0);
  const changes = toDb + toSheet === 0 ? "Kedua sisi sudah sama." : `${toDb} perubahan ke database, ${toSheet} sel/baris ke Google Sheet.`;
  return summary.status === "partial"
    ? { ok: false, message: `Sebagian tabel gagal: ${summary.errors?.[0] ?? ""}` }
    : { ok: true, message: `Selesai. ${changes}` };
}

/**
 * "Terapkan penghapusan": the deletes the guard held back (open rejected:deletes_skipped rows) are applied
 * in one run with allowMassDelete for those tables; their log rows are then marked reviewed.
 */
export async function applyHeldDeletes(): Promise<SyncNowResult> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pd_sync_conflicts")
    .select("id, table_name")
    .eq("resolution", "rejected:deletes_skipped")
    .is("resolved_at", null);
  if (error) return { ok: false, message: "Daftar penghapusan yang ditahan tidak bisa dibaca. Coba lagi." };
  const known = new Set<string>(SYNC_TABLES.map((s) => s.table));
  const tables = [...new Set((data ?? []).map((r) => r.table_name))].filter((t): t is SyncTable => known.has(t));
  if (tables.length === 0) return { ok: true, message: "Tidak ada penghapusan yang ditahan." };

  const summary = await runNow(tables);
  if (!("status" in summary)) return summary;
  const failed = failure(summary);
  if (failed) return failed;

  const done = tables.filter((t) => !summary.tables?.[t]?.error && !summary.tables?.[t]?.dbFailed);
  const ids = (data ?? []).filter((r) => (done as string[]).includes(r.table_name)).map((r) => r.id);
  if (ids.length) {
    await supabase
      .from("pd_sync_conflicts")
      .update({ resolved_at: new Date().toISOString(), resolved_by: admin.userId })
      .in("id", ids)
      .is("resolved_at", null);
  }
  refresh();
  const deleted = done.reduce((n, t) => n + (summary.tables?.[t]?.dbDeletes ?? 0), 0);
  return done.length === tables.length
    ? { ok: true, message: `Penghapusan diterapkan (${deleted} baris dihapus dari database; Google Sheet ikut dibersihkan).` }
    : { ok: false, message: `Sebagian tabel gagal: ${summary.errors?.[0] ?? ""}` };
}
