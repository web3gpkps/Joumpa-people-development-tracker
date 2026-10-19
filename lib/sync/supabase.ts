/**
 * Supabase side of the sync, using the service-role client (server only; bypasses RLS).
 *
 * RPCs (supabase/migrations/*_pd_sync.sql, service_role only):
 *   pd_sync_claim_lease(p_ttl_seconds int) -> uuid | null
 *   pd_sync_release_lease(p_token uuid, p_baseline jsonb, p_error text) -> boolean
 * State and log: pd_sync_state, pd_sync_conflicts (v1 keeps its own). Writes are ordered:
 * inserts/updates parents first (settings, staff, then children); deletes children first. Each
 * table is applied on its own so one failing table does not block the rest. A table with an
 * archive column (Rencana Aksi) is read without its archived rows, and a delete archives.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SYNC_TABLES, dataColumns, specFor } from "./tables";
import type { Baseline, CanonRow, ConflictRecord, DbSnapshot, Issue, Plan, SyncTable, TableSpec } from "./types";

const PAGE = 1000;
const CHUNK = 500;
const CONCURRENCY = 6;

export interface DbApplyResult {
  /** Generated keys per pending insert: identity ids, or a text code (pd_staff). */
  ids: Map<number, number | string>;
  /** Tables whose writes failed (message is code + message only, never row data). */
  failed: Map<SyncTable, string>;
}

export interface SyncStore {
  claimLease(ttlSeconds: number): Promise<string | null>;
  releaseLease(token: string, baseline: Baseline | null, error: string | null): Promise<boolean>;
  readBaseline(): Promise<Baseline | null>;
  readAll(): Promise<DbSnapshot>;
  apply(plan: Plan): Promise<DbApplyResult>;
  log(entries: SyncLogEntry[]): Promise<void>;
}

export interface SyncLogEntry {
  table_name: string;
  row_key: string | null;
  column_name: string | null;
  baseline: unknown;
  sheet_value: unknown;
  db_value: unknown;
  resolution: string;
}

export function conflictToLog(c: ConflictRecord): SyncLogEntry {
  return {
    table_name: c.table,
    row_key: c.rowKey,
    column_name: c.column,
    baseline: c.baseline,
    sheet_value: c.sheet,
    db_value: c.db,
    resolution: c.resolution,
  };
}

/** Validation problems go to the same log; `resolution` names the kind (the sheet value was not written). */
export function issueToLog(i: Issue): SyncLogEntry {
  return {
    table_name: i.table,
    row_key: i.rowKey ?? (i.at ? `#${i.at.row}` : null),
    column_name: i.column,
    baseline: null,
    sheet_value: i.sheetValue === undefined ? null : i.sheetValue,
    db_value: i.dbValue === undefined ? null : i.dbValue,
    resolution: `rejected:${i.kind}`,
  };
}

/** PostgREST errors: keep code + message; `details` can contain row values. */
function safeDbError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  return `${err?.code ?? "error"}: ${(err?.message ?? String(e)).slice(0, 200)}`;
}

async function pool<T>(items: T[], fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

export class SupabaseSyncStore implements SyncStore {
  constructor(
    private readonly db: SupabaseClient,
    private readonly specs: TableSpec[] = SYNC_TABLES,
  ) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): SupabaseSyncStore {
    const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    return new SupabaseSyncStore(
      createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
    );
  }

  async claimLease(ttlSeconds: number): Promise<string | null> {
    const { data, error } = await this.db.rpc("pd_sync_claim_lease", { p_ttl_seconds: ttlSeconds });
    if (error) throw new Error(`pd_sync_claim_lease ${safeDbError(error)}`);
    return (data as string | null) ?? null;
  }

  async releaseLease(token: string, baseline: Baseline | null, error: string | null): Promise<boolean> {
    const { data, error: e } = await this.db.rpc("pd_sync_release_lease", {
      p_token: token,
      p_baseline: baseline,
      p_error: error,
    });
    if (e) throw new Error(`pd_sync_release_lease ${safeDbError(e)}`);
    return data === true;
  }

  async readBaseline(): Promise<Baseline | null> {
    const { data, error } = await this.db.from("pd_sync_state").select("baseline").eq("id", true).maybeSingle();
    if (error) throw new Error(`pd_sync_state ${safeDbError(error)}`);
    const b = data?.baseline as Baseline | Record<string, never> | null | undefined;
    return b && (b as Baseline).v === 1 ? (b as Baseline) : null;
  }

  async readAll(): Promise<DbSnapshot> {
    const out: DbSnapshot = {};
    const stations = async () => {
      const { data, error } = await this.db.from("stations").select("code, report_group").order("code");
      if (error) throw new Error(`read stations ${safeDbError(error)}`);
      out.stations = (data ?? []) as { code: string; report_group: string }[];
    };
    const areas = async () => {
      const { data, error } = await this.db.from("pd_areas").select("name").order("sort");
      if (error) throw new Error(`read pd_areas ${safeDbError(error)}`);
      out.areas = ((data ?? []) as { name: string }[]).map((a) => a.name);
    };
    await Promise.all([
      stations(),
      areas(),
      ...this.specs.map(async (spec) => {
        if (spec.kv) {
          const { data, error } = await this.db.from(spec.table).select("*").eq("id", 1);
          if (error) throw new Error(`read ${spec.table} ${safeDbError(error)}`);
          out[spec.table] = data ?? [];
          return;
        }
        const cols = dataColumns(spec).map((c) => c.db).join(",");
        const rows: Record<string, unknown>[] = [];
        for (let from = 0; ; from += PAGE) {
          let q = this.db.from(spec.table).select(cols);
          if (spec.archiveColumn) q = q.is(spec.archiveColumn, null);
          for (const k of spec.key) q = q.order(k, { ascending: true });
          const { data, error } = await q.range(from, from + PAGE - 1);
          if (error) throw new Error(`read ${spec.table} ${safeDbError(error)}`);
          rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
          if (!data || data.length < PAGE) break;
        }
        out[spec.table] = rows;
      }),
    ]);
    return out;
  }

  async apply(plan: Plan): Promise<DbApplyResult> {
    const ids = new Map<number, number | string>();
    const failed = new Map<SyncTable, string>();
    const byTable = new Map(plan.tables.map((t) => [t.table, t]));
    const order = this.specs.map((s) => s.table);

    for (const table of order) {
      const tp = byTable.get(table);
      if (!tp || tp.error) continue;
      const spec = specFor(table, this.specs);
      try {
        if (spec.kv) {
          if (tp.db.updates.length) {
            const set: CanonRow = {};
            for (const u of tp.db.updates) set[String(u.key.key)] = u.set.value;
            const { error } = await this.db.from(table).update(set).eq("id", 1);
            if (error) throw error;
          }
          continue;
        }
        for (let i = 0; i < tp.db.inserts.length; i += CHUNK) {
          const { error } = await this.db
            .from(table)
            .upsert(tp.db.inserts.slice(i, i + CHUNK), { onConflict: spec.key.join(","), ignoreDuplicates: false });
          if (error) throw error;
        }
        await pool(tp.db.updates, async (u) => {
          const { error } = await this.db.from(table).update(u.set).match(u.key);
          if (error) throw error;
        });
        for (const p of tp.db.pending) {
          const { data, error } = await this.db.from(table).insert(p.values).select(spec.key[0]).single();
          if (error) throw error;
          const id = (data as unknown as Record<string, unknown>)[spec.key[0]];
          ids.set(p.ref, typeof id === "number" ? id : String(id));
        }
      } catch (e) {
        failed.set(table, safeDbError(e));
      }
    }

    for (const table of [...order].reverse()) {
      const tp = byTable.get(table);
      if (!tp || tp.error || failed.has(table) || tp.db.deletes.length === 0) continue;
      const spec = specFor(table, this.specs);
      try {
        if (spec.archiveColumn && spec.key.length === 1) {
          // Rencana Aksi: a row cleared in the sheet is archived (restorable), never deleted.
          const k = spec.key[0];
          const values = tp.db.deletes.map((d) => d[k]);
          for (let i = 0; i < values.length; i += CHUNK) {
            const { error } = await this.db
              .from(table)
              .update({ [spec.archiveColumn]: new Date().toISOString() })
              .in(k, values.slice(i, i + CHUNK) as (string | number)[]);
            if (error) throw error;
          }
        } else if (spec.key.length === 1) {
          const k = spec.key[0];
          const values = tp.db.deletes.map((d) => d[k]);
          for (let i = 0; i < values.length; i += CHUNK) {
            const { error } = await this.db.from(table).delete().in(k, values.slice(i, i + CHUNK) as (string | number)[]);
            if (error) throw error;
          }
        } else {
          await pool(tp.db.deletes, async (key) => {
            const { error } = await this.db.from(table).delete().match(key);
            if (error) throw error;
          });
        }
      } catch (e) {
        failed.set(table, safeDbError(e));
      }
    }
    return { ids, failed };
  }

  async log(entries: SyncLogEntry[]): Promise<void> {
    for (let i = 0; i < entries.length; i += CHUNK) {
      const { error } = await this.db.from("pd_sync_conflicts").insert(entries.slice(i, i + CHUNK));
      if (error) throw new Error(`pd_sync_conflicts ${safeDbError(error)}`);
    }
  }
}
