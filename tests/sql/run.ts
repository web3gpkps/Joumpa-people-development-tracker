// Runs the SQL security tests without Docker: each tests/sql/*.test.sql gets a fresh PGlite
// (Postgres in WASM) with the Supabase stubs, every migration and a pgTAP-compatible shim.
//   bun tests/sql/run.ts                 all files
//   bun tests/sql/run.ts 03 06           only files whose name contains "03" or "06"
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const testDir = join(root, "tests", "sql");
// v1's migrations (the shared database as it is in production), then v2's own.
const migrationDirs = [join(root, "supabase", "baseline-prod"), join(root, "supabase", "migrations")];
const read = (path: string) => readFileSync(path, "utf8");

const bootstrap = read(join(testDir, "lib", "bootstrap.sql"));
const tap = read(join(testDir, "lib", "tap.sql"));
const migrations = migrationDirs.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, sql: read(join(dir, f)) })),
);

const filters = process.argv.slice(2);
const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.sql"))
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)))
  .sort();

if (files.length === 0) {
  console.error("No test files matched.");
  process.exit(1);
}

type PgError = Error & { detail?: string; where?: string; position?: string };

function describe(error: unknown): string {
  const e = error as PgError;
  return [e.message, e.detail, e.where].filter(Boolean).join("\n");
}

async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(bootstrap);
  for (const m of migrations) {
    try {
      await db.exec(m.sql);
    } catch (error) {
      throw new Error(`migration ${m.name} failed: ${describe(error)}`);
    }
  }
  await db.exec(tap);
  // Tests call ok(), is(), … unqualified, as with pgTAP installed in extensions.
  await db.exec("set search_path = public, tap, extensions");
  return db;
}

// pgTAP itself is not installed here; the shim stands in for it.
const withoutPgtap = (sql: string) =>
  sql.replace(/^\s*create extension if not exists pgtap[^;]*;\s*$/gim, "-- (pgTAP shim loaded by tests/sql/run.ts)");

let failedFiles = 0;
let assertions = 0;
const started = performance.now();

for (const file of files) {
  const t0 = performance.now();
  let db: PGlite | null = null;
  try {
    db = await freshDatabase();
    const results = await db.exec(withoutPgtap(read(join(testDir, file))));
    const finish = results.flatMap((r) => r.rows).find((row) => typeof row.finish === "string");
    const summary = (finish?.finish as string | undefined) ?? "no finish() row";
    const n = Number.parseInt(summary, 10);
    if (!Number.isFinite(n) || n === 0) throw new Error(`no assertions ran (${summary})`);
    assertions += n;
    console.log(`ok   ${file}: ${summary} (${Math.round(performance.now() - t0)} ms)`);
  } catch (error) {
    failedFiles++;
    console.log(`FAIL ${file}\n${describe(error).replace(/^/gm, "     ")}`);
  } finally {
    await db?.close();
  }
}

const seconds = ((performance.now() - started) / 1000).toFixed(1);
if (failedFiles > 0) {
  console.log(`\n${failedFiles} of ${files.length} files failed (${seconds} s).`);
  process.exit(1);
}
console.log(`\nAll ${files.length} files passed: ${assertions} assertions (${seconds} s).`);
