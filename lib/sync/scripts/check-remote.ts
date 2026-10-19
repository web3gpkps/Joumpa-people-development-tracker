/**
 * Read-only checks against the real Supabase project and the real Google Sheet.
 *
 *   bun lib/sync/scripts/check-remote.ts            # DB counts + dry run vs the real workbook + in-memory replay
 *   bun lib/sync/scripts/check-remote.ts --lease    # also claim + immediately release the lease
 *
 * Writes nothing to any table or to the sheet (the Google token has read-only scopes; no apply is
 * called). With --lease the lease RPCs run once; release passes no baseline and a short note as
 * p_error. Prints counts only, never cell contents.
 */
import { JWT } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";
import { countOps, projectAll, tabsToRead, translate } from "../layouts";
import { countPlan, isPlanEmpty, merge } from "../merge";
import { normalize } from "../normalize";
import { GoogleSheets, TARGET_LOCALE, TARGET_TZ } from "../sheets";
import { SupabaseSyncStore } from "../supabase";
import { SYNC_TABLES, dataColumns } from "../tables";
import { FakeWorkbook, WorkbookWorld } from "../testing/workbook";
import { localServiceAccount } from "./local-env";

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

  const specs = SYNC_TABLES;
  const store = new SupabaseSyncStore(client, specs);

  // 1. DB reads
  const db = await store.readAll();
  const baseline = await store.readBaseline();
  console.log("DB rows:", Object.fromEntries(Object.entries(db).map(([t, r]) => [t, r?.length ?? 0])));
  console.log("stored baseline present:", baseline !== null);
  for (const spec of specs) {
    const bad: Record<string, number> = {};
    for (const row of db[spec.table] ?? []) {
      if (spec.kv) {
        for (const e of spec.kv.entries) if (!normalize(row[e.key], e.type).ok) bad[e.key] = (bad[e.key] ?? 0) + 1;
        continue;
      }
      for (const c of dataColumns(spec)) if (!normalize(row[c.db], c.type).ok) bad[c.db] = (bad[c.db] ?? 0) + 1;
    }
    if (Object.keys(bad).length) console.log(`  ${spec.table}: values outside the sheet's validation rules:`, bad);
  }

  // 2. Lease (optional)
  if (process.argv.includes("--lease")) {
    const token = await store.claimLease(60);
    console.log("lease claimed:", token !== null);
    if (token) console.log("lease released:", await store.releaseLease(token, null, "Pemeriksaan koneksi saja; belum ada sinkronisasi."));
  }

  // 3. Dry run against the real workbook (read-only scopes; nothing applied)
  const sa = localServiceAccount();
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = new GoogleSheets(process.env.GOOGLE_SHEETS_ID!, async () => (await jwt.getAccessToken()).token!);
  const real = await sheets.read(tabsToRead(specs));
  console.log("tabs read:", Object.keys(real.tabs).length, "| locale switch needed:", real.locale !== TARGET_LOCALE || real.timeZone !== TARGET_TZ);
  const { sheet, projections } = projectAll(real, specs);
  for (const [t, p] of projections) if (!p.error) console.log(`  ${t}: ${(p.virtual?.values.length ?? 1) - 1} virtual rows, ${p.virtual?.locked?.size ?? 0} locked (formula/synthetic) cells`);
  const plan = merge({ baseline, sheet, db, specs });
  const ops = translate(plan, projections, real);
  console.log("dry-run plan (nothing applied):");
  for (const [t, c] of Object.entries(countPlan(plan))) console.log(`  ${t}:`, JSON.stringify(c));
  for (const t of plan.tables) {
    if (t.error) console.log(`  ${t.table} ERROR: ${t.error}`);
    const kinds: Record<string, number> = {};
    for (const i of t.issues) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
    if (Object.keys(kinds).length) console.log(`  ${t.table} issues:`, JSON.stringify(kinds));
  }
  console.log("sheet operations:", JSON.stringify(countOps(ops)));
  const byTarget: Record<string, number> = {};
  for (const w of ops.writes) {
    const k = `${w.tab} col ${w.col + 1}`;
    byTarget[k] = (byTarget[k] ?? 0) + 1;
  }
  console.log("cell writes by tab/column:", JSON.stringify(byTarget));
  console.log("header cells:", JSON.stringify(ops.headerCells.map((h) => `${h.tab} row ${h.row} col ${h.col + 1}${h.hide ? " (hidden)" : ""}`)));

  // 4. Replay in memory: copy of the real workbook + real DB rows, two syncs (no remote writes)
  const w = new WorkbookWorld(db, { book: FakeWorkbook.fromSnapshot(real) });
  w.specs = specs;
  w.sync();
  const second = w.prepare();
  console.log("in-memory replay: second run empty:", isPlanEmpty(second.plan), JSON.stringify(second.counts));
}

main().catch((e) => {
  console.error("check failed:", e instanceof Error ? e.message.slice(0, 300) : "unknown");
  process.exit(1);
});
