import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { merge } from "../merge";
import { SupabaseSyncStore, conflictToLog, issueToLog } from "../supabase";
import { World } from "../testing/fakes";
import { bmiRow, smallDb, staffRow } from "../testing/fixtures";

/** Records every PostgREST call as "table.op(args)" in order. */
function recordingClient(opts: { failOn?: string; rpc?: Record<string, unknown>; rows?: Record<string, unknown[]>; inserted?: Record<string, unknown> } = {}) {
  const calls: string[] = [];
  let nextId = 100;
  const builder = (table: string) => {
    let op = "";
    const parts: string[] = [];
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      parts.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      if (["upsert", "update", "delete", "insert", "select"].includes(name) && !op) op = name;
      return b;
    };
    for (const n of ["select", "upsert", "update", "delete", "insert", "eq", "is", "in", "match", "order", "single", "maybeSingle"]) b[n] = chain(n);
    b.range = (from: number) => {
      parts.push(`range(${from})`);
      return b;
    };
    b.then = (resolve: (v: unknown) => void) => {
      const line = `${table}.${parts.join(".")}`;
      calls.push(line);
      if (opts.failOn && line.includes(opts.failOn)) return resolve({ data: null, error: { code: "23514", message: "violates check", details: "Failing row contains (secret)" } });
      if (op === "insert") return resolve({ data: opts.inserted?.[table] ?? { id: nextId++ }, error: null });
      if (op === "select") return resolve({ data: opts.rows?.[table] ?? [], error: null });
      return resolve({ data: null, error: null });
    };
    return b;
  };
  const client = {
    from: (t: string) => builder(t),
    rpc: async (name: string, args: unknown) => {
      calls.push(`rpc.${name}(${JSON.stringify(args)})`);
      return { data: opts.rpc?.[name] ?? null, error: null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const TS = "Tracker Staf";
const CB = "Cek BMI";
const PG = "Penggantian SDM";
const RA = "Rencana Aksi";
const LB = "Laporan Bulanan";
const PB = "Parameter BMI";

const rowOf = (w: World, tab: string, header: string, value: unknown) => w.sheet.rows(tab).findIndex((r) => r[header] === value) + 2;

describe("SupabaseSyncStore.apply", () => {
  test("parents before children for writes, children first for deletes, settings in one update, Rencana Aksi archived", async () => {
    const w = new World(smallDb());
    w.sync();
    w.db.rows("pd_staff").push(staffRow("KNO-01", 9));
    w.db.rows("pd_bmi_checks").push(bmiRow(5, "KNO-01", 1));
    w.sync(); // KNO-01 is now known on both sides
    w.sheet.setCell(PB, rowOf(w, PB, "Parameter", "bmi_first_check"), "Nilai", "19/10/2026");
    w.sheet.setCell(PB, rowOf(w, PB, "Parameter", "bmi_interval_days"), "Nilai", 7);
    // Sheet: delete DPS-01; add a person without ID SDM; clear SUB-01's check; add a check for KNO-01.
    const ts = w.sheet.tabs.get(TS)!.values;
    ts.splice(ts.findIndex((r) => r[0] === "DPS-01"), 1);
    const n = ts.length + 1;
    w.sheet.setCell(TS, n, "Stn", "BPN");
    w.sheet.setCell(TS, n, "Nama", "Baru");
    const sub01 = rowOf(w, CB, "ID SDM", "SUB-01");
    w.sheet.setCell(CB, sub01, "Tinggi (cm)", "");
    w.sheet.setCell(CB, sub01, "Berat (kg)", "");
    const m = w.sheet.rows(CB).length + 2;
    w.sheet.setCell(CB, m, "ID SDM", "KNO-01");
    w.sheet.setCell(CB, m, "Cek Ke", 2);
    w.sheet.setCell(CB, m, "Tinggi (cm)", 160);
    w.sheet.setCell(CB, m, "Berat (kg)", 55);
    w.sheet.setCell(PG, w.sheet.rows(PG).length + 2, "Nama", "X");
    const ra = w.sheet.tabs.get(RA)!.values;
    ra.splice(rowOf(w, RA, "ID Sistem", 1) - 1, 1);
    w.sheet.setCell(LB, rowOf(w, LB, "Cabang", "SUB"), "Catatan", "ok");
    const plan = w.plan();

    const { client, calls } = recordingClient({ inserted: { pd_staff: { code: "BPN-01" } } });
    const res = await new SupabaseSyncStore(client).apply(plan);
    expect(res.failed.size).toBe(0);
    // Text code for pd_staff, identity id for pd_replacements.
    expect([...res.ids]).toEqual([[1, "BPN-01"], [2, 100]]);
    const idx = (s: string) => calls.findIndex((c) => c.includes(s));
    expect(calls.filter((c) => c.startsWith("pd_settings."))).toEqual(['pd_settings.update({"bmi_first_check":"2026-10-19","bmi_interval_days":7}).eq("id",1)']);
    expect(calls[idx("pd_staff.insert")]).toContain('select("code").single()');
    expect(idx("pd_staff.insert")).toBeLessThan(idx("pd_bmi_checks.upsert"));
    expect(calls[idx("pd_bmi_checks.upsert")]).toContain('"onConflict":"staff_code,period"');
    expect(calls[idx("pd_replacements.insert")]).toContain('select("id").single()');
    expect(calls[idx("pd_monthly_reports.update")]).toContain('match({"report_group":"SUB","period":"2026-10-01"})');
    // Deletes: children first. Rencana Aksi is archived, never deleted.
    expect(calls.some((c) => c.startsWith("pd_action_plans.delete"))).toBe(false);
    expect(calls[idx("pd_action_plans.update")]).toMatch(/^pd_action_plans\.update\(\{"archived_at":"\d{4}-\d{2}-\d{2}T[^"]+"\}\)\.in\("id",\[1\]\)$/);
    expect(idx("pd_action_plans.update")).toBeLessThan(idx("pd_bmi_checks.delete"));
    expect(calls[idx("pd_bmi_checks.delete")]).toContain('match({"staff_code":"SUB-01","period":1})');
    expect(idx("pd_bmi_checks.delete")).toBeLessThan(idx("pd_staff.delete"));
    expect(calls[idx("pd_staff.delete")]).toContain('in("code",["DPS-01"])');
  });

  test("a failing table is reported with code + message only (no row details) and others continue", async () => {
    const w = new World(smallDb());
    w.sync();
    w.sheet.setCell(TS, 2, "Catatan progres", "x");
    w.sheet.setCell(RA, 2, "PIC", "y");
    const { client, calls } = recordingClient({ failOn: "pd_staff.update" });
    const res = await new SupabaseSyncStore(client).apply(w.plan());
    expect([...res.failed]).toEqual([["pd_staff", "23514: violates check"]]);
    expect(calls.some((c) => c.startsWith("pd_action_plans.update"))).toBe(true);
  });

  test("a failing table's deletes are not attempted", async () => {
    const w = new World(smallDb());
    w.sync();
    w.sheet.setCell(TS, 2, "Catatan progres", "x");
    w.sheet.tabs.get(TS)!.values.splice(3, 1);
    const { client, calls } = recordingClient({ failOn: "pd_staff.update" });
    await new SupabaseSyncStore(client).apply(w.plan());
    expect(calls.some((c) => c.startsWith("pd_staff.delete"))).toBe(false);
  });
});

describe("SupabaseSyncStore lease + state", () => {
  test("RPC names and argument names match the pd_sync migration", async () => {
    const { client, calls } = recordingClient({ rpc: { pd_sync_claim_lease: "tok", pd_sync_release_lease: true } });
    const store = new SupabaseSyncStore(client);
    expect(await store.claimLease(60)).toBe("tok");
    expect(await store.releaseLease("tok", null, "x")).toBe(true);
    expect(calls).toEqual(['rpc.pd_sync_claim_lease({"p_ttl_seconds":60})', 'rpc.pd_sync_release_lease({"p_token":"tok","p_baseline":null,"p_error":"x"})']);
  });

  test("the baseline is read from pd_sync_state; an empty '{}' baseline reads as first run", async () => {
    const rec = recordingClient({ rows: { pd_sync_state: [] } });
    expect(await new SupabaseSyncStore(rec.client).readBaseline()).toBeNull();
    expect(rec.calls).toEqual(['pd_sync_state.select("baseline").eq("id",true).maybeSingle()']);

    const { client } = recordingClient();
    (client as unknown as { from: unknown }).from = () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { baseline: {} }, error: null }) }) }),
    });
    expect(await new SupabaseSyncStore(client).readBaseline()).toBeNull();
  });

  test("readAll: stations, pd_areas names, tables paged by key, archived plans left out", async () => {
    const { client, calls } = recordingClient({
      rows: { pd_settings: [{ id: 1 }], pd_areas: [{ name: "Grooming" }, { name: "BMI" }], stations: [{ code: "SUB", report_group: "SUB" }] },
    });
    const snap = await new SupabaseSyncStore(client).readAll();
    expect(snap.pd_settings).toEqual([{ id: 1 }]);
    expect(snap.areas).toEqual(["Grooming", "BMI"]);
    expect(snap.stations).toEqual([{ code: "SUB", report_group: "SUB" }]);
    expect(calls).toContain('pd_areas.select("name").order("sort")');
    expect(calls).toContain('pd_settings.select("*").eq("id",1)');
    expect(calls.find((c) => c.startsWith("pd_bmi_checks."))).toBe(
      'pd_bmi_checks.select("staff_code,period,check_date,height_cm,weight_kg").order("staff_code",{"ascending":true}).order("period",{"ascending":true}).range(0)',
    );
    expect(calls.find((c) => c.startsWith("pd_action_plans."))).toContain('.is("archived_at",null).order("id",{"ascending":true}).range(0)');
    expect(calls.find((c) => c.startsWith("pd_staff."))).not.toContain(".is(");
    expect(calls.find((c) => c.startsWith("pd_staff."))).toContain('order("code",{"ascending":true})');
    expect(calls.filter((c) => /^(sync_|staff\.|settings\.)/.test(c))).toEqual([]);
  });

  test("log writes to pd_sync_conflicts", async () => {
    const { client, calls } = recordingClient();
    await new SupabaseSyncStore(client).log([
      { table_name: "pd_staff", row_key: "SUB-01", column_name: "name", baseline: "a", sheet_value: "b", db_value: "c", resolution: "db-wins" },
    ]);
    expect(calls).toEqual(['pd_sync_conflicts.insert([{"table_name":"pd_staff","row_key":"SUB-01","column_name":"name","baseline":"a","sheet_value":"b","db_value":"c","resolution":"db-wins"}])']);
  });
});

describe("log entries", () => {
  test("issueToLog uses rejected:<kind>; a row without key is named by its sheet row", () => {
    const w = new World(smallDb());
    w.sync();
    const r = w.sheet.rows(TS).findIndex((x) => x["ID SDM"] === "SUB-01") + 2;
    w.sheet.setCell(TS, r, "Praktik awal", 9);
    const n = w.sheet.rows(LB).length + 2;
    w.sheet.setCell(LB, n, "Periode", "2026-11-01");
    w.sheet.setCell(LB, n, "Catatan", "tanpa cabang");
    const plan = merge({ baseline: w.baseline, sheet: w.sheet.snapshot(), db: w.db.snapshot(), specs: w.specs });
    const issue = plan.tables.find((t) => t.table === "pd_staff")!.issues[0];
    expect(issueToLog(issue)).toEqual({
      table_name: "pd_staff",
      row_key: "SUB-01",
      column_name: "initial_practice",
      baseline: null,
      sheet_value: 9,
      db_value: 3,
      resolution: "rejected:invalid_value",
    });
    const missing = plan.tables.find((t) => t.table === "pd_monthly_reports")!.issues[0];
    expect(issueToLog(missing)).toMatchObject({ table_name: "pd_monthly_reports", row_key: `#${n}`, column_name: "report_group", resolution: "rejected:missing_key" });
  });

  test("conflictToLog keeps the three values and the policy", () => {
    expect(
      conflictToLog({ table: "pd_action_plans", rowKey: "2", column: "status", baseline: "Proses", sheet: "Selesai", db: "Batal / N.A.", resolution: "db-wins" }),
    ).toEqual({ table_name: "pd_action_plans", row_key: "2", column_name: "status", baseline: "Proses", sheet_value: "Selesai", db_value: "Batal / N.A.", resolution: "db-wins" });
  });
});
