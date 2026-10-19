/**
 * One sync run: lease -> read both sides -> project workbook layouts -> merge -> translate (validated
 * before any write) -> write DB -> write sheet -> log -> store baseline.
 *
 * Failure handling:
 * - Lease held by another run: return "busy" (overlapping triggers are harmless).
 * - The plan would touch a formula cell / untouched tab: abort before writing anything.
 * - A table's DB writes fail: that table's sheet writes are skipped and its baseline stays as it was;
 *   other tables continue. Partially applied writes are re-detected as "both sides equal" next run.
 * - Sheet writes fail: the baseline is not stored; the next run re-merges against the old baseline.
 *   Rows inserted with generated ids are re-linked by the adoption rule (station + name).
 */
import { countOps, projectAll, tabsToRead, translate, type RealOps } from "./layouts";
import { countPlan, finalizeBaseline, merge, type TableCounts } from "./merge";
import { needsSheetSetup, type SheetsPort } from "./sheets";
import { conflictToLog, issueToLog, type SyncStore } from "./supabase";
import { SYNC_TABLES } from "./tables";
import { DEFAULT_CONFLICT_POLICY, type Baseline, type ConflictPolicy, type Plan, type SyncTable, type TableSpec } from "./types";

export interface RunDeps {
  store: SyncStore;
  sheets: SheetsPort;
  specs?: TableSpec[];
  leaseSeconds?: number;
  /** Do not start writing after this much time has passed (the lease must outlive the writes). */
  writeDeadlineMs?: number;
}

export interface RunOptions {
  dryRun?: boolean;
  conflictPolicy?: ConflictPolicy;
  allowMassDelete?: SyncTable[];
}

export interface RunSummary {
  status: "ok" | "partial" | "busy" | "dry-run" | "error";
  durationMs: number;
  policy: ConflictPolicy;
  tables?: Record<string, TableCounts & { dbFailed?: boolean }>;
  sheet?: ReturnType<typeof countOps> & { setLocale: boolean };
  errors?: string[];
}

export function parsePolicy(v: unknown): ConflictPolicy {
  return v === "sheet-wins" ? "sheet-wins" : v === "db-wins" ? "db-wins" : DEFAULT_CONFLICT_POLICY;
}

/** Error text safe to store in sync_state.last_error and return: no values, no secrets. */
export function safeMessage(e: unknown): string {
  if (e instanceof Error) return `${e.name === "Error" ? "" : `${e.name}: `}${e.message}`.slice(0, 300);
  return "unknown error";
}

function summarize(plan: Plan, failed: Map<SyncTable, string> = new Map()) {
  const counts = countPlan(plan) as Record<string, TableCounts & { dbFailed?: boolean }>;
  for (const t of failed.keys()) counts[t] = { ...counts[t], dbFailed: true };
  return counts;
}

export async function runSync(deps: RunDeps, opts: RunOptions = {}): Promise<RunSummary> {
  const started = Date.now();
  const specs = deps.specs ?? SYNC_TABLES;
  const policy = opts.conflictPolicy ?? DEFAULT_CONFLICT_POLICY;
  const elapsed = () => Date.now() - started;

  const prepare = async () => {
    const [baseline, real, db] = await Promise.all([deps.store.readBaseline(), deps.sheets.read(tabsToRead(specs)), deps.store.readAll()]);
    const { sheet, projections } = projectAll(real, specs);
    const plan = merge({ baseline, sheet, db, conflictPolicy: policy, allowMassDelete: opts.allowMassDelete, specs });
    const ops: RealOps = translate(plan, projections, real);
    const setLocale = needsSheetSetup(real.timeZone);
    return { plan, ops, previous: baseline, sheetSummary: { ...countOps(ops), setLocale } };
  };

  if (opts.dryRun) {
    // Reads only; no lease, nothing written anywhere (sync_state included).
    try {
      const { plan, sheetSummary } = await prepare();
      const errors = plan.tables.filter((t) => t.error).map((t) => t.error!);
      return { status: "dry-run", durationMs: elapsed(), policy, tables: summarize(plan), sheet: sheetSummary, errors };
    } catch (e) {
      return { status: "error", durationMs: elapsed(), policy, errors: [safeMessage(e)] };
    }
  }

  const token = await deps.store.claimLease(deps.leaseSeconds ?? 60);
  if (!token) return { status: "busy", durationMs: elapsed(), policy };

  try {
    const { plan, ops, previous, sheetSummary } = await prepare();
    if (elapsed() > (deps.writeDeadlineMs ?? 35_000)) throw new Error("Read phase too slow; no writes started.");

    const { ids, failed } = await deps.store.apply(plan);
    const ok = (t: { table: SyncTable }) => !failed.has(t.table);

    // sheet-wins conflicts already changed the DB: log them now so a sheet outage cannot lose them.
    await deps.store.log(
      plan.tables.filter(ok).flatMap((t) => t.conflicts.filter((c) => c.resolution === "sheet-wins").map(conflictToLog)),
    );

    await deps.sheets.apply(ops, ids, { skipTables: new Set(failed.keys()) });

    await deps.store.log(
      plan.tables
        .filter(ok)
        .flatMap((t) => [
          ...t.conflicts.filter((c) => c.resolution === "db-wins").map(conflictToLog),
          ...t.issues.filter((i) => i.isNew).map(issueToLog),
        ]),
    );

    const next: Baseline = finalizeBaseline(plan, ids, specs);
    for (const table of failed.keys()) {
      next.tables[table] = previous?.tables[table] ?? {};
      for (const id of Object.keys(next.issues ?? {})) if (id.startsWith(`${table}::`)) delete next.issues![id];
      for (const [id, sig] of Object.entries(previous?.issues ?? {})) if (id.startsWith(`${table}::`)) next.issues![id] = sig;
    }

    const errors = [
      ...plan.tables.filter((t) => t.error).map((t) => t.error!),
      ...[...failed].map(([t, m]) => `DB ${t}: ${m}`),
    ];
    const released = await deps.store.releaseLease(token, next, errors.length ? errors.join(" | ").slice(0, 2000) : null);
    if (!released) errors.push("Lease expired before the run finished; baseline not stored.");
    return {
      status: errors.length ? "partial" : "ok",
      durationMs: elapsed(),
      policy,
      tables: summarize(plan, failed),
      sheet: sheetSummary,
      errors: errors.length ? errors : undefined,
    };
  } catch (e) {
    const msg = safeMessage(e);
    await deps.store.releaseLease(token, null, msg).catch(() => undefined);
    return { status: "error", durationMs: elapsed(), policy, errors: [msg] };
  }
}
