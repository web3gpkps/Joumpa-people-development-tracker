/**
 * One-time import for v2: the workbook in the Google Sheet (master) + v1's Cek BMI data → pd_ tables.
 *
 *   bun scripts/v2-import.ts                 # dry run: reads both, writes the SQL to --out, prints counts
 *   bun scripts/v2-import.ts --apply         # also runs that SQL in one transaction (psql, SUPABASE_DB_URL)
 *   bun scripts/v2-import.ts --out <file>    # where the SQL goes (default: ./scripts/out/v2-import.sql)
 *
 * The dry run only reads (the sheet with a read-only scope, v1's tables with the service role); --apply
 * also writes Tracker Staf W "ID SDM", so the first sync sees Cek BMI. The SQL holds
 * real names, so it goes to scripts/out/ (gitignored) or the path given. The rows are parsed with the
 * sync engine's own projection and normalisation, so the first sync finds nothing to change; it only
 * writes the generated ids (ID SDM, ID Sistem) into the sheet by matching the rows (adoptBy).
 *
 * Staff codes: v1's code for the people v1 knows (matched by name), the station's next number for the
 * others (BPN-01.., SUB-06.., CGK-28, DPS-27 with v1's data of 19 Okt 2026). Their NIPP, L/P, BMI note
 * and BMI checks come from v1. Refuses to run when pd_staff already has rows.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { projectAll, tabsToRead } from "../lib/sync/layouts";
import { normalize } from "../lib/sync/normalize";
import { GoogleSheets, serviceAccountTokenSource } from "../lib/sync/sheets";
import { SYNC_TABLES, specFor } from "../lib/sync/tables";
import type { Canon, CanonRow, SyncTable } from "../lib/sync/types";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : "scripts/out/v2-import.sql";

const env = process.env;
const need = (k: string) => {
  const v = env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const normName = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function insert(table: string, rows: Record<string, unknown>[]): string {
  if (!rows.length) return `-- ${table}: no rows\n`;
  const cols = Object.keys(rows[0]);
  const values = rows.map((r) => `  (${cols.map((c) => sqlValue(r[c])).join(", ")})`).join(",\n");
  return `insert into public.${table} (${cols.join(", ")}) values\n${values};\n`;
}

/** Rows left out because a required column is empty (e.g. a footnote typed under the table). */
const skipped: string[] = [];
/** Sheet row number of each parsed row. */
const sheetRowOf = new Map<CanonRow, number>();

/** Sheet rows of one table, as the sync engine reads them (canonical values, formulas skipped). */
function sheetRows(virtualTabs: ReturnType<typeof projectAll>["sheet"]["tabs"], table: SyncTable): CanonRow[] {
  const spec = specFor(table);
  const tab = virtualTabs[spec.tab];
  if (!tab) throw new Error(`tab ${spec.tab} missing or unreadable`);
  const [header, ...rows] = tab.values;
  const out: CanonRow[] = [];
  rows.forEach((raw, i) => {
    const row: CanonRow = {};
    let filled = false;
    spec.columns.forEach((c, ci) => {
      if (tab.locked?.has(`${i + 2}:${ci}`)) return;
      const n = normalize(raw?.[ci], c.type);
      if (!n.ok) throw new Error(`${spec.tab} row ${i + 2}, "${header[ci]}": ${n.message}`);
      row[c.db] = n.value;
      if (n.value !== null && !spec.key.includes(c.db)) filled = true;
    });
    const present = spec.absentUnless ? spec.absentUnless.some((c) => row[c] !== null) : filled;
    if (!present) return;
    const missing = spec.columns.filter((c) => c.required && c.defaultValue === undefined && row[c.db] === null && !spec.key.includes(c.db));
    if (missing.length) {
      skipped.push(`${spec.tab} baris ${i + 5}: ${missing.map((c) => c.header).join(", ")} kosong`);
      return;
    }
    sheetRowOf.set(row, i + 5);
    out.push(row);
  });
  return out;
}

async function main() {
  // ---- read the sheet (read-only scope)
  const sheets = new GoogleSheets(
    need("GOOGLE_SHEETS_ID"),
    serviceAccountTokenSource(env, ["https://www.googleapis.com/auth/spreadsheets.readonly"]),
    { setLocale: false },
  );
  const wanted = tabsToRead(SYNC_TABLES).filter((t) => !["Cek BMI", "Parameter BMI"].includes(t));
  const real = await sheets.read(wanted);
  const { sheet } = projectAll(real, SYNC_TABLES.filter((s) => wanted.includes(s.tab)));
  for (const [tab, err] of Object.entries(sheet.errors ?? {})) {
    // ID SDM / ID Sistem are added by the first sync; their absence is not an error here.
    if (!/ID SDM|ID Sistem/.test(err)) throw new Error(`${tab}: ${err}`);
  }

  // ---- read v1 (service role, reads only)
  const db = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const [v1Staff, v1Bmi, v1Settings, pdStaff, stations] = await Promise.all([
    db.from("staff").select("code, station, name, nipp, gender, bmi_note"),
    db.from("bmi_checks").select("staff_code, period, check_date, height_cm, weight_kg"),
    db.from("settings").select("bmi_first_check, bmi_interval_days, bmi_periods, bmi_underweight_below, bmi_normal_max, bmi_overweight_max, min_height_female, min_height_male").eq("id", 1).single(),
    db.from("pd_staff").select("code", { count: "exact", head: true }),
    db.from("stations").select("code, report_group"),
  ]);
  for (const r of [v1Staff, v1Bmi, v1Settings, stations]) if (r.error) throw new Error(r.error.message);
  if (pdStaff.error && apply) throw new Error(`pd_staff not readable (migrations applied?): ${pdStaff.error.message}`);
  if (pdStaff.error) console.log("note: pd_ tables are not in the database yet (dry run continues)");
  if ((pdStaff.count ?? 0) > 0) throw new Error(`pd_staff already has ${pdStaff.count} rows: import refused.`);

  const v1ByName = new Map<string, NonNullable<typeof v1Staff.data>[number]>();
  for (const s of v1Staff.data ?? []) v1ByName.set(normName(s.name), s);
  const nextNo = new Map<string, number>();
  for (const s of v1Staff.data ?? []) {
    const m = /^([A-Z0-9]+)-(\d+)$/.exec(s.code);
    if (m) nextNo.set(m[1], Math.max(nextNo.get(m[1]) ?? 0, Number(m[2])));
  }

  // ---- Tracker Staf
  const staffRows = sheetRows(sheet.tabs, "pd_staff");
  const codeOf = new Map<string, string>();
  const idCells: { row: number; code: string }[] = [];
  const staff = staffRows.map((r, i) => {
    const v1 = v1ByName.get(normName(String(r.name)));
    const station = String(r.station);
    let code = v1?.code;
    if (!code) {
      const n = (nextNo.get(station) ?? 0) + 1;
      nextNo.set(station, n);
      code = `${station}-${String(n).padStart(2, "0")}`;
    }
    codeOf.set(normName(String(r.name)), code);
    idCells.push({ row: sheetRowOf.get(r)!, code });
    const { code: _drop, report_group: _rg, gender: _g, nipp: _n, bmi_note: _b, ...rest } = r;
    void _drop; void _rg; void _g; void _n; void _b;
    return { code, ...rest, nipp: v1?.nipp ?? null, gender: v1?.gender ?? null, bmi_note: v1?.bmi_note ?? null, sort_order: i + 1, matched: !!v1 };
  });
  const dupCodes = staff.map((s) => s.code).filter((c, i, a) => a.indexOf(c) !== i);
  if (dupCodes.length) throw new Error(`duplicate staff codes: ${dupCodes.join(", ")}`);

  const codes = new Set(staff.map((s) => s.code));
  const bmi = (v1Bmi.data ?? []).filter((b) => codes.has(b.staff_code));

  // ---- Penggantian SDM, Rencana Aksi, Laporan Bulanan
  // Every Penggantian row names someone in Tracker Staf; a row that does not (e.g. a note typed under
  // the table) is reported and left out.
  const replacements = sheetRows(sheet.tabs, "pd_replacements")
    .map((r): CanonRow => {
      const { id: _id, ...rest } = r;
      void _id;
      return { ...rest, staff_code: codeOf.get(normName(String(r.name))) ?? null };
    })
    .filter((r) => {
      if (r.staff_code) return true;
      skipped.push(`Penggantian SDM: "${String(r.name).slice(0, 40)}" tidak ada di Tracker Staf`);
      return false;
    })
    .map((r, i) => ({ ...r, sort_order: i + 1 }));
  const plans = sheetRows(sheet.tabs, "pd_action_plans").map((r, i) => {
    const { id: _id, ...rest } = r;
    void _id;
    return { ...rest, sort_order: i + 1 };
  });
  const monthly = sheetRows(sheet.tabs, "pd_monthly_reports");

  // ---- SQL
  const settings = v1Settings.data!;
  const sql = [
    "-- v2 import (generated by scripts/v2-import.ts). Real names inside: keep out of git.",
    "begin;",
    `update public.pd_settings set ${Object.entries(settings).map(([k, v]) => `${k} = ${sqlValue(v as Canon)}`).join(", ")} where id = 1;`,
    insert("pd_staff", staff.map(({ matched: _m, ...s }) => { void _m; return s; })),
    insert("pd_bmi_checks", bmi),
    insert("pd_replacements", replacements),
    insert("pd_action_plans", plans),
    insert("pd_monthly_reports", monthly),
    "commit;",
    "",
  ].join("\n");
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, sql, { mode: 0o600 });

  const newStaff = staff.filter((s) => !s.matched).map((s) => s.code);
  console.log(
    JSON.stringify(
      {
        staff: staff.length,
        staffFromV1: staff.length - newStaff.length,
        newStaffCodes: newStaff,
        v1StaffNotInSheet: (v1Staff.data ?? []).filter((s) => !codes.has(s.code)).map((s) => s.code),
        bmiChecks: bmi.length,
        nippCopied: staff.filter((s) => s.nipp).length,
        replacements: replacements.length,
        actionPlans: plans.length,
        monthlyReports: monthly.length,
        skippedRows: skipped,
        sql: outFile,
      },
      null,
      2,
    ),
  );

  if (!apply) return;
  const res = spawnSync("psql", [need("SUPABASE_DB_URL"), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", outFile], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`psql failed: ${(res.stderr || "").replace(/postgres(ql)?:\/\/\S+/g, "<db-url>").slice(0, 500)}`);
  console.log("database: applied");

  // Tracker Staf W "ID SDM": written now, so the first sync already sees Cek BMI (its ID SDM formulas
  // read this column). The sync adopts the other id columns (ID Sistem) itself.
  const writeToken = serviceAccountTokenSource(env, ["https://www.googleapis.com/auth/spreadsheets"]);
  const data = [
    { range: "'Tracker Staf'!W4", values: [["ID SDM"]] },
    ...idCells.map((c) => ({ range: `'Tracker Staf'!W${c.row}`, values: [[c.code]] })),
  ];
  const put = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(need("GOOGLE_SHEETS_ID"))}/values:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${await writeToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ valueInputOption: "RAW", data }),
    },
  );
  if (!put.ok) throw new Error(`sheet: writing ID SDM failed (HTTP ${put.status})`);
  console.log(`sheet: ID SDM written for ${idCells.length} staff`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
