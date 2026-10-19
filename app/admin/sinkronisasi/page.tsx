import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader, PageLoading } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ErrorState } from "@/components/ui/States";
import { ReloadButton } from "@/components/ui/ReloadButton";
import { StatusChip } from "@/components/ui/StatusChip";
import { ConflictTable, ResolvedConflicts, type ConflictRow } from "@/components/admin/ConflictTable";
import { SyncActions } from "@/components/admin/SyncActions";
import { TABLE_LABEL } from "@/components/admin/sync-labels";
import { formatRelatif, formatWaktu } from "@/components/admin/format";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sinkronisasi" };

// "Sinkronkan sekarang" runs the whole sync inside the Server Action.
export const maxDuration = 60;

const TITLE = "Sinkronisasi";
const OPEN_LIMIT = 200;
const RESOLVED_LIMIT = 50;
const CONFLICT_COLUMNS =
  "id, created_at, table_name, row_key, column_name, baseline, sheet_value, db_value, resolution, resolved_at";

export default function SinkronisasiPage() {
  return (
    <Suspense fallback={<PageLoading title={TITLE} label="Memuat status sinkronisasi" />}>
      <SyncData />
    </Suspense>
  );
}

function toConflict(row: {
  id: number;
  created_at: string;
  table_name: string;
  row_key: string | null;
  column_name: string | null;
  baseline: unknown;
  sheet_value: unknown;
  db_value: unknown;
  resolution: string | null;
  resolved_at: string | null;
}): ConflictRow {
  return {
    id: row.id,
    createdAt: row.created_at,
    tableName: row.table_name,
    rowKey: row.row_key,
    columnName: row.column_name,
    baseline: row.baseline,
    sheetValue: row.sheet_value,
    dbValue: row.db_value,
    resolution: row.resolution,
    resolvedAt: row.resolved_at,
  };
}

/** Google Sheet sync: one status line, then the conflicts still to review. */
async function SyncData() {
  await requireAdmin();
  const supabase = await createClient();
  // pd_sync_state.baseline (the full snapshot) is never read here: it is large and not shown.
  const [stateResult, openResult, resolvedResult, heldResult] = await Promise.all([
    supabase
      .from("pd_sync_state")
      .select("initialized, lease_token, lease_until, last_success_at, failures, last_error")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("pd_sync_conflicts")
      .select(CONFLICT_COLUMNS, { count: "exact" })
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(OPEN_LIMIT),
    supabase
      .from("pd_sync_conflicts")
      .select(CONFLICT_COLUMNS, { count: "exact" })
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(RESOLVED_LIMIT),
    supabase
      .from("pd_sync_conflicts")
      .select("table_name, sheet_value, created_at")
      .eq("resolution", "rejected:deletes_skipped")
      .is("resolved_at", null)
      .order("created_at", { ascending: false }),
  ]);

  // Latest held-back count per table (the guard logs once per table while the deletes stay pending).
  const held = new Map<string, number>();
  for (const r of heldResult.data ?? []) {
    if (!held.has(r.table_name)) held.set(r.table_name, Number(r.sheet_value) || 0);
  }
  const heldDeletes = [...held].map(([t, rows]) => ({ table: TABLE_LABEL[t] ?? t, rows }));

  // Request time (after the queries): reading the clock is allowed here.
  const now = new Date();
  const state = stateResult.data;
  const running = Boolean(state?.lease_token && state.lease_until && new Date(state.lease_until) > now);

  const openRows = (openResult.data ?? []).map(toConflict);
  const resolvedRows = (resolvedResult.data ?? []).map(toConflict);
  const openCount = openResult.count ?? openRows.length;
  const resolvedCount = resolvedResult.count ?? resolvedRows.length;

  const last = state?.last_success_at
    ? `Google Sheet terakhir sinkron ${formatWaktu(state.last_success_at)} WIB (${formatRelatif(state.last_success_at, now)})`
    : "Google Sheet belum pernah sinkron";
  const parts = [last, `${openCount} konflik belum ditinjau`];
  if (running) parts.push("sedang berjalan");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={TITLE}
        meta={stateResult.error || !state ? `${openCount} konflik belum ditinjau` : parts.join(" · ")}
      />

      <SyncActions heldDeletes={heldDeletes} />

      {stateResult.error || !state ? (
        <Panel>
          <ErrorState
            title="Status sinkronisasi tidak bisa dimuat"
            cause={stateResult.error ? "Server tidak menjawab." : "Sinkronisasi belum disiapkan."}
            action={stateResult.error ? <ReloadButton>Coba lagi</ReloadButton> : "Hubungi pengelola aplikasi."}
          />
        </Panel>
      ) : state.failures > 0 || !state.initialized ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
          {state.failures > 0 ? <StatusChip label={`Gagal ${state.failures} kali berturut-turut`} tone="critical" /> : null}
          {!state.initialized ? <StatusChip label="Sinkron pertama belum selesai" tone="warning" /> : null}
          {state.last_error ? (
            // The raw error text stays behind this disclosure; the admin area is owner-only.
            <div className="basis-full text-sm text-ink-muted">
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-ink lg:min-h-0">
                  Detail teknis untuk pengelola
                </summary>
                <pre className="mt-2 rounded-control bg-surface-sunken p-3 text-xs wrap-break-word whitespace-pre-wrap">
                  {state.last_error}
                </pre>
              </details>
            </div>
          ) : null}
        </div>
      ) : null}

      <Panel padding="flush">
        {openResult.error ? (
          <div className="px-4">
            <ErrorState
              title="Daftar konflik tidak bisa dimuat"
              cause="Server tidak menjawab."
              action={<ReloadButton>Coba lagi</ReloadButton>}
            />
          </div>
        ) : (
          <ConflictTable
            caption="Konflik yang belum ditinjau"
            rows={openRows}
            mode="open"
            emptyTitle="Tidak ada konflik yang perlu ditinjau"
          />
        )}
      </Panel>

      {resolvedResult.error ? null : <ResolvedConflicts rows={resolvedRows} count={resolvedCount} />}
    </div>
  );
}
