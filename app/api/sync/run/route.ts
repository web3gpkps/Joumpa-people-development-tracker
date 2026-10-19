/**
 * POST /api/sync/run: one Supabase <-> Google Sheets sync run. See docs/SYNC.md.
 *
 * Authorization: Bearer <SYNC_SECRET>       full access; JSON body may set
 *                                           { dryRun, conflictPolicy, allowMassDelete }
 *                Bearer <SYNC_PING_SECRET>  trigger a normal run only (Apps Script, DB trigger)
 *
 * The response carries counts and short error texts only, never row data.
 * No `runtime` export: cacheComponents rejects it, and Node.js (node:crypto) is the default.
 */
import { authorize } from "@/lib/sync/auth";
import { parsePolicy, runSync, type RunOptions } from "@/lib/sync/run";
import { GoogleSheets } from "@/lib/sync/sheets";
import { SupabaseSyncStore } from "@/lib/sync/supabase";
import { SYNC_TABLES } from "@/lib/sync/tables";
import type { SyncTable } from "@/lib/sync/types";

export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

async function fullOptions(request: Request): Promise<RunOptions> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown> | null;
  const known = new Set<string>(SYNC_TABLES.map((s) => s.table));
  const allow = Array.isArray(body?.allowMassDelete)
    ? (body!.allowMassDelete as unknown[]).filter((t): t is SyncTable => typeof t === "string" && known.has(t))
    : undefined;
  return {
    dryRun: body?.dryRun === true,
    conflictPolicy: parsePolicy(body?.conflictPolicy ?? process.env.CONFLICT_POLICY),
    allowMassDelete: allow,
  };
}

export async function POST(request: Request) {
  const caller = authorize(request.headers.get("authorization"));
  if (caller === "unconfigured") {
    return Response.json({ ok: false, error: "sync_not_configured" }, { status: 503, headers: NO_STORE });
  }
  if (caller === "denied") {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const opts: RunOptions =
    caller === "full" ? await fullOptions(request) : { conflictPolicy: parsePolicy(process.env.CONFLICT_POLICY) };

  let deps;
  try {
    deps = { store: SupabaseSyncStore.fromEnv(), sheets: GoogleSheets.fromEnv() };
  } catch (e) {
    console.error("[sync] configuration error:", e instanceof Error ? e.message : "unknown");
    return Response.json({ ok: false, error: "sync_misconfigured" }, { status: 500, headers: NO_STORE });
  }

  const summary = await runSync(deps, opts);
  if (summary.errors?.length) console.error("[sync]", summary.status, summary.errors.join(" | "));
  const status = summary.status === "error" ? 500 : 200;
  return Response.json({ ok: summary.status !== "error", caller, ...summary }, { status, headers: NO_STORE });
}
