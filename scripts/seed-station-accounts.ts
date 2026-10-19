/**
 * Seeds one approved branch account per station (public.stations), each with its own random password,
 * and writes the list to a CSV for the owner to hand over.
 *
 *   bun scripts/seed-station-accounts.ts                      # create what is missing
 *   bun scripts/seed-station-accounts.ts --dry-run            # list only
 *   bun scripts/seed-station-accounts.ts --out scripts/out/x.csv
 *
 * Email: <kode station huruf kecil>@gapura.id. Accounts are created with the e-mail already confirmed and
 * are set `active` for their own station. Existing accounts are left alone (nothing is overwritten; their
 * password is not in the CSV). The CSV is the only place the passwords appear: keep it under scripts/out
 * (gitignored), hand it over once, and delete it. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { temporaryPassword } from "../lib/accounts/temp-password";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes("--dry-run");
const outIndex = process.argv.indexOf("--out");
const out = outIndex > 0 ? process.argv[outIndex + 1] : "scripts/out/akun-cabang.csv";

if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: stations, error } = await db
  .from("stations")
  .select("code, report_group")
  .order("sort")
  .order("code");
if (error || !stations) throw new Error(`stations: ${error?.message ?? "no data"}`);

const existing = new Set<string>();
for (let page = 1; ; page++) {
  const { data, error: listError } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (listError) throw new Error(`listUsers: ${listError.message}`);
  for (const u of data.users) if (u.email) existing.add(u.email.toLowerCase());
  if (data.users.length < 1000) break;
}

const csv = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const lines = ["Stasiun,Kelompok Laporan,Email,Kata sandi"];
let created = 0;
let skipped = 0;
for (const { code, report_group } of stations) {
  const email = `${code.toLowerCase()}@gapura.id`;
  if (existing.has(email)) {
    skipped++;
    console.log(`skip    ${code}  ${email} (already exists)`);
    continue;
  }
  if (dryRun) {
    console.log(`would   ${code}  ${email}`);
    continue;
  }
  const password = temporaryPassword();
  const { data, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Akun Stasiun ${code}`, branch_code: code },
  });
  if (createError || !data.user) {
    console.log(`FAILED  ${code}  ${email}: ${createError?.message ?? "no user"}`);
    continue;
  }
  // The sign-up trigger made the profile `pending`; the seed approves it.
  const { error: approveError } = await db.from("profiles").update({ status: "active" }).eq("id", data.user.id);
  if (approveError) {
    console.log(`PENDING ${code}  ${email}: created but not approved (${approveError.message})`);
    continue;
  }
  lines.push([code, report_group, email, password].map(csv).join(","));
  created++;
  console.log(`created ${code}  ${email}`);
}

if (created > 0) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join("\n") + "\n", { mode: 0o600 });
  console.log(`\nPasswords written to ${out} (only place they appear).`);
}
console.log(`${created} created, ${skipped} skipped, ${stations.length} stations.`);
