/* eslint-disable @typescript-eslint/no-explicit-any -- introspection rows from PGlite are untyped */
// Regenerates lib/database.types.ts from supabase/migrations without Docker (PGlite = Postgres in WASM):
//   bun scripts/gen-types.ts supabase/baseline-prod,supabase/migrations lib/database.types.ts
// (comma-separated migration folders, applied in order)
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync, writeFileSync } from "fs";
const [dir, typesFile] = process.argv.slice(2);
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema extensions; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
for (const d of dir.split(","))
  for (const f of readdirSync(d).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(`${d}/${f}`, "utf8"));
const ts = (t: string) => ({ text: "string", uuid: "string", date: "string", "timestamp with time zone": "string",
  numeric: "number", smallint: "number", integer: "number", bigint: "number", boolean: "boolean", void: "undefined", jsonb: "Json", "text[]": "string[]" } as any)[t] ?? (() => { throw new Error("type " + t); })();
const cols: any[] = (await db.query(`select table_name, column_name, data_type, udt_name, is_nullable, column_default, is_identity
  from information_schema.columns where table_schema='public' order by table_name, column_name`)).rows;
const fks: any[] = (await db.query(`select c.conname, rel.relname tbl, ref.relname reft,
   (select array_agg(a.attname order by k.ord) from unnest(c.conkey) with ordinality k(n,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n) cols,
   (select array_agg(a.attname order by k.ord) from unnest(c.confkey) with ordinality k(n,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.n) refcols,
   exists(select 1 from pg_constraint u where u.conrelid=c.conrelid and u.contype in ('u','p') and u.conkey=c.conkey) one
  from pg_constraint c join pg_class rel on rel.oid=c.conrelid join pg_class ref on ref.oid=c.confrelid
  join pg_namespace n on n.oid=rel.relnamespace where c.contype='f' and n.nspname='public' order by c.conname`)).rows;
const tables = [...new Set(cols.map((c) => c.table_name))].sort();
let out = "    Tables: {\n";
for (const t of tables) {
  const cs = cols.filter((c) => c.table_name === t);
  const line = (c: any, mode: string) => {
    const nul = c.is_nullable === "YES";
    const opt = mode === "Update" || (mode === "Insert" && (nul || c.column_default != null || c.is_identity === "YES"));
    const type = c.data_type === "USER-DEFINED" ? `Database["public"]["Enums"]["${c.udt_name}"]` : ts(c.data_type);
    return `          ${c.column_name}${opt ? "?" : ""}: ${type}${nul ? " | null" : ""}`;
  };
  out += `      ${t}: {\n`;
  for (const mode of ["Row", "Insert", "Update"]) out += `        ${mode}: {\n${cs.map((c) => line(c, mode)).join("\n")}\n        }\n`;
  const rel = fks.filter((f) => f.tbl === t);
  out += rel.length ? `        Relationships: [\n${rel.map((f) => `          {\n            foreignKeyName: "${f.conname}"\n            columns: ${JSON.stringify(f.cols)}\n            isOneToOne: ${f.one}\n            referencedRelation: "${f.reft}"\n            referencedColumns: ${JSON.stringify(f.refcols)}\n          },`).join("\n")}\n        ]\n` : "        Relationships: []\n";
  out += "      }\n";
}
out += "    }\n    Views: {\n      [_ in never]: never\n    }\n    Functions: {\n";
const fns: any[] = (await db.query(`select p.proname, pg_get_function_result(p.oid) res, p.pronargs, p.pronargdefaults,
   coalesce(p.proargnames, '{}') names, (select array_agg(format_type(t, null) order by o) from unnest(p.proargtypes) with ordinality x(t,o)) types
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
   and p.proname not in ('graphql') order by p.proname`)).rows;
const rt = (r: string) => r === "trigger" ? null : ts(r);
for (const f of fns) {
  const r = rt(f.res); if (!r) continue;
  if (f.pronargs === 0) { out += `      ${f.proname}: { Args: never; Returns: ${r} }\n`; continue; }
  const args = f.names.slice(0, f.pronargs).map((n: string, i: number) => ({ n, t: ts(f.types[i]), opt: i >= f.pronargs - f.pronargdefaults }));
  args.sort((a: any, b: any) => a.n.localeCompare(b.n));
  if (args.length === 1) { out += `      ${f.proname}: { Args: { ${args[0].n}${args[0].opt ? "?" : ""}: ${args[0].t} }; Returns: ${r} }\n`; continue; }
  out += `      ${f.proname}: {\n        Args: {\n${args.map((a: any) => `          ${a.n}${a.opt ? "?" : ""}: ${a.t}`).join("\n")}\n        }\n        Returns: ${r}\n      }\n`;
}
out += "    }\n";
const enums: any[] = (await db.query(`select t.typname, array_agg(e.enumlabel order by e.enumsortorder) labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'public' group by t.typname order by t.typname`)).rows;
out += enums.length
  ? `    Enums: {\n${enums.map((e) => `      ${e.typname}: ${e.labels.map((l: string) => JSON.stringify(l)).join(" | ")}`).join("\n")}\n    }\n`
  : "    Enums: {\n      [_ in never]: never\n    }\n";
// The checked-out file may use CRLF; work on LF and write back with the original line endings.
const raw = readFileSync(typesFile, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const src = raw.replace(/\r\n/g, "\n");
const start = src.indexOf("  public: {\n    Tables: {");
if (start < 0) throw new Error("public Tables block not found in " + typesFile);
const from = start + "  public: {\n".length;
const end = src.indexOf("    CompositeTypes: {", from);
const next = src.slice(0, from) + out + src.slice(end);
writeFileSync(typesFile, eol === "\n" ? next : next.replace(/\n/g, eol));
console.log("tables", tables.length, "functions", fns.length);
