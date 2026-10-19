# Google Sheets two-way sync: operator notes

Supabase is the primary store. The Google Sheet (`GOOGLE_SHEETS_ID`) is the workbook "Tracker Tindak
Lanjut People Development JOUMPA" plus the tabs `Cek BMI` and `Parameter BMI` (added by
`scripts/v2-setup-sheet.ts`), kept as a live replica people may edit **in its own layout** (its formulas
and Dashboard keep working). v2 shares the Supabase project with v1 but has its own state
(`pd_sync_state`, `pd_sync_conflicts`, lease RPCs `pd_sync_*`, Vault secrets `pd_sync_*`, cron job). The engine replicates both ways with
**lease + baseline snapshot + per-cell 3-way merge + conflict log**. Contract: `docs/SPEC.md` →
"Google Sheets two-way replication".

## Architecture

```
 pg_cron (1/min) ─┐                     ┌──────────── POST /api/sync/run (Vercel, Node) ─────────────┐
 DB trigger ping ─┼─ Bearer secret ───▶ │ 1 claim lease     sync_claim_lease(60) → uuid | null          │
 Apps Script ping ┘                     │ 2 read            sync_state.baseline + synced tables         │
                                        │                   Sheets: metadata + values + formulas        │
                                        │ 3 project         workbook layouts → row-1 tables (layouts.ts)│
                                        │ 4 merge (pure)    merge.ts → Plan                             │
                                        │ 5 translate       Plan → real cell ops; refuses formula cells │
                                        │ 6 write DB        parents first, deletes children first       │
                                        │ 7 log sheet-wins  sync_conflicts                              │
                                        │ 8 write Sheet     setup → values → formula copies/notes       │
                                        │ 9 log db-wins + new validation problems                       │
                                        │10 release lease   sync_release_lease(token, baseline, err)    │
                                        └───────────────────────────────────────────────────────────────┘
```

| File | Role |
|---|---|
| `lib/sync/tables.ts` | What is synced: keys, column types, workbook header texts, presence/placement rules |
| `lib/sync/layouts.ts` | Workbook layouts ↔ row-1 tables: projection, formula detection, translation to cell writes |
| `lib/sync/normalize.ts` | Canonical values (`"4"`/`4`/`4.0` → 4; serial / `12/10/2026` / `12 Okt 2026` → `2026-10-12`) and validation |
| `lib/sync/merge.ts` | Pure merge engine → `Plan` (DB ops, sheet ops, conflicts, issues, new baseline) |
| `lib/sync/sheets.ts` | Sheets REST v4 adapter (fetch + google-auth-library JWT) |
| `lib/sync/supabase.ts` | Service-role adapter: lease RPCs, reads, ordered writes, conflict log |
| `lib/sync/run.ts` | One run, failure handling |
| `lib/sync/auth.ts` | Constant-time Bearer check |
| `app/api/sync/run/route.ts` | HTTP entry point |
| `apps-script/` | Sheet-side ping trigger + menu (setup in Bahasa Indonesia) |
| `lib/sync/scripts/probe-sheet.ts` | Read-only probe of the real sheet (tabs, sizes) |
| `lib/sync/scripts/check-remote.ts` | Read-only: DB counts, dry run against the real workbook, in-memory replay |

Tests: `bun test lib/sync` (engine cases, every workbook layout end to end on an in-memory copy of the
workbook, adapters with mocked HTTP, orchestrator failure paths).

## Where each table lives

All native tabs: header on row 4, data from row 5 (Cek BMI: header rows 4 and 5, data from row 6).

| Table | Tab | Key | Synced input columns | Notes |
|---|---|---|---|---|
| pd_settings | `Parameter BMI`, label B / value C | label text in B | C | `pd_settings_guard_bmi_periods` refuses fewer periods than used |
| pd_staff | `Tracker Staf` | W `ID SDM` (added; DB-generated `<STN>-NN` for new rows, adopted by Stn + Nama on a first run) | B Nama, C Cabang (put back from Stn by the DB), D Stn, E Usulan, F–R inputs, T Keputusan akhir, U Catatan progres; **L/P, NIPP and the BMI note are in `Cek BMI` F, G and the note column, on row + 1** | no Nama = absent; S, V are formulas |
| pd_bmi_checks | `Cek BMI` (wide) | B (formula `='Tracker Staf'!W`) + period | per period: Tgl Cek / Tinggi / Berat | long in the DB; Tinggi and Berat both empty = absent |
| pd_replacements | `Penggantian SDM` | S `ID Sistem` (hidden, added) | B–M, O–Q, T `ID SDM` (added) | Nama/Cabang follow `ID SDM` in the DB; N, R formulas |
| pd_action_plans | `Rencana Aksi` | N `ID Sistem` (hidden, added) | A No … L Kendala | **% Progres is a fraction in the sheet (0.5 = 50%) and 0..100 in the DB.** Area checked against `pd_areas`. Archived rows are absent; a row cleared in the sheet is **archived**, not deleted |
| pd_monthly_reports | `Laporan Bulanan` | A Cabang + B Periode (`Okt 2026` ↔ `2026-10-01`) | C, D, F, G, J–M | E, H, I formulas |

**Never touched:** `Petunjuk`, `Dashboard`, `Referensi`. **Never synced:** `pd_share_links`, `pd_areas`,
`pd_sync_*`, v1's tables, and attribution/meta columns.

A dash ("-", "–") in a number or date cell reads as empty. Cabang columns are checked against the report
groups in `public.stations`, Stn against its codes, Area against `pd_areas` (any case; written back as
stored).

Generic rules for workbook tabs:

- **A cell holding a formula is never read as input and never written.** Keys may come from formulas
  (Cek BMI's ID SDM): their computed value is used.
- **Rows are never inserted or deleted** in workbook tabs (other tabs reference them by position). Deletes
  clear the record's input cells; new records fill free rows or extend below the block with the first data
  row's formulas copied.
- Headers are matched by text on the header row (whitespace-insensitive). A renamed or missing header is a
  hard error for that table; other tables continue (`partial`).
- Cek BMI's ID SDM reads Tracker Staf W. `scripts/v2-import.ts` writes W, so the first run sees every BMI
  row; a person added later in the sheet without an ID gets one on that run and their BMI row is read on
  the next.


## Merge rules

Per table → per row key → per cell, against the baseline (values both sides agreed on after the last run):

| Sheet vs baseline | DB vs baseline | Result |
|---|---|---|
| same | same | nothing |
| changed | same | write DB |
| same | changed | write sheet |
| changed | changed, equal | nothing (baseline updated) |
| changed | changed, different | **conflict**: `CONFLICT_POLICY` decides (default **db-wins**); the loser is logged |

Rows: new on one side → inserted on the other. In baseline but gone (absent) on one side → deleted on the
other. Delete on one side + edit on the other → whole-row conflict, same policy (`column_name` NULL).
Deleting a staff member clears their Log/BMI entries in the sheet and `ID SDM` in Penggantian (FK cascade /
set null) in the same run. Rows without a baseline entry (first run) merge as a union: an empty cell on
one side takes the other side's value; only two different non-empty values are a conflict.

Guards and validation:

- **Deletion guard**: deletes reach the other side on the next run. Only an extreme one, more than
  `max(10 rows, 50 %)` of a table's baseline rows deleted in one direction in one run (e.g. a tab cleared
  by accident), is held back and logged once as `rejected:deletes_skipped`. /admin/sinkronisasi then shows
  "Penghapusan ditahan" with **Terapkan penghapusan** (one run with `allowMassDelete` for those tables; the
  log rows are marked reviewed). API override for one run: `{"allowMassDelete": ["staff"]}`.
- **Invalid sheet values** (score 7, height 300, unknown option, bad date, `% Progres` > 100%, required
  cell cleared, unknown `ID SDM`, settings breaking the DB's cross-field checks) are never written. The cell
  gets a note, the baseline keeps the old value, `rejected:<kind>` is logged once; the note clears when the
  value is fixed. An invalid value never wins a conflict; if the DB changed meanwhile its value replaces it.
- **Duplicate keys** (e.g. the same staff + week twice in Log): every copy is noted and the key is not
  synced until the duplicate is removed (nothing is picked silently).
- **Generated ids**: a new Penggantian row without `ID Sistem` is inserted and its id written back. An
  id-less row matching exactly one unknown DB row on Stasiun + Nama SDM Diganti is linked instead (first
  run; or an id lost because the sheet write failed after the insert).

Idempotent: after a run, merging again yields an empty plan (tested for every case, and replayed on a copy
of the real workbook with the real DB rows).

## Environment

### Vercel (server only; never `NEXT_PUBLIC_`, except the URL)

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) | yes | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) | yes | service role; bypasses RLS |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | yes | service-account JSON on **one line**, or base64 of it. Fallback: `GOOGLE_PRIVATE_KEY` holding the JSON (legacy) |
| `GOOGLE_SHEETS_ID` | yes | spreadsheet id of the workbook |
| `SYNC_SECRET` | yes | ≥ 16 chars (`openssl rand -hex 32`); full access incl. dry run / options |
| `SYNC_PING_SECRET` | yes | ≥ 16 chars, different from `SYNC_SECRET`; can only trigger a run |
| `CONFLICT_POLICY` | no | `db-wins` (default) or `sheet-wins` |
| `SYNC_SHEET_LOCALE` | no | `off` stops the engine from setting the sheet to `id_ID` / `Asia/Jakarta` |

Credentials are read at request time, so rotating the Google key or a secret needs only an env update and
redeploy. The repo's `.env` holds the JSON as a multi-line quoted value, which dotenv (Next, Bun, Supabase
CLI) truncates; for local `next dev` put the JSON on one line in `GOOGLE_SERVICE_ACCOUNT_JSON`
(`jq -c . key.json`). The local scripts read the raw block directly.

### Supabase Vault (pg_cron + change trigger, see `*_pd_sync.sql`, `production-setup.sql`)

| Secret name | Value |
|---|---|
| `pd_sync_run_url` | `https://<app-domain>/api/sync/run` |
| `pd_sync_secret` | the value of `SYNC_PING_SECRET` (least privilege; `SYNC_SECRET` also works) |

### Apps Script (standalone project, Script Properties): `SHEET_ID`, `SYNC_URL`, `SYNC_PING_SECRET`. See `apps-script/README.md`.

### Google

- The service account must be an **Editor** of the spreadsheet; the Google Sheets API enabled in its GCP
  project. (The read-only probe uses the Drive API only to report edit permission; it is currently disabled,
  so confirm Editor access in the Share dialog.)
- The engine sets the spreadsheet locale to `id_ID` and time zone to `Asia/Jakarta` (once, when they
  differ): `TODAY()` in Parameter C23 drives OVERDUE flags and must be the Jakarta date, and typed dates
  must read as D/M/Y.

## HTTP API

`POST /api/sync/run`, `Authorization: Bearer <secret>`. GET → 405.

| Caller | Body (optional, JSON) |
|---|---|
| `SYNC_SECRET` | `{"dryRun": true}` reads both sides and returns the plan's counts (writes nothing, takes no lease). `{"conflictPolicy": "sheet-wins"}` for one run. `{"allowMassDelete": ["staff"]}` lifts the guard for named tables for one run. |
| `SYNC_PING_SECRET` | ignored; a normal run |

Response (counts only, never row data): `{ ok, caller, status: ok|partial|busy|dry-run|error, durationMs,
policy, tables: { <table>: { dbInserts, dbUpdates, dbDeletes, sheetCellUpdates, sheetAppends,
sheetRowDeletes, conflicts, newIssues, openIssues, createTab, error, dbFailed? } }, sheet: { createTabs,
headerCells, cellWrites, formulaCopies, notes, rowDeletes, appends, grow, tabsWritten, setLocale }, errors? }`.
HTTP 200 except `error` (500), unauthorized (401), not configured (503).

## Failure modes

| What happens | Effect | What to do |
|---|---|---|
| Two triggers at once | second gets `busy` (lease) | nothing |
| Run dies mid-way | lease expires after 60 s; baseline not stored | nothing; next run converges |
| Plan would touch a formula cell or an untouched tab | run aborts before any write (`LayoutViolation`) | a bug or a changed workbook layout: check the error, fix the layout map |
| Sheets API error / no edit permission | `error`; DB writes of that run stay; baseline not stored | fix permission/quota; next run completes the sheet side (sheet-wins conflicts were already logged) |
| One table's DB writes fail | that table skipped (sheet + baseline), others continue; `partial` | read `last_error` (`DB <table>: <code>: <message>`) |
| Header renamed / column moved out | that table frozen; `partial`; `rejected:header_error` logged once | restore the header text (`lib/sync/tables.ts` lists them) |
| Staff beyond the Cek BMI rows (more than 300 Tracker Staf rows) | their L/P, NIPP, note and checks have no cell | extend `Cek BMI` with more formula rows (copy the last row down) |
| BMI period > 5 in the DB | `rejected:no_sheet_row` | add period columns to the workbook, or ignore |
| More than half of a tab cleared at once | deletes held back; `rejected:deletes_skipped` | restore (Version history), or **Terapkan penghapusan** on /admin/sinkronisasi |
| Bad credentials / env | `error` naming the variable (never its value) | fix env |

## Resolving conflicts

`public.pd_sync_conflicts` (the admin UI lists rows with `resolved_at IS NULL`):

| `resolution` | Meaning | `sheet_value` / `db_value` |
|---|---|---|
| `db-wins` | both sides changed the cell; DB value kept and written over the sheet | the losing sheet value / the kept DB value |
| `sheet-wins` | same, policy sheet-wins; sheet value written to DB | kept sheet value / overwritten DB value |
| `rejected:invalid_value`, `rejected:required_missing`, `rejected:unknown_parent`, `rejected:duplicate_key`, `rejected:missing_key`, `rejected:unknown_setting`, `rejected:incomplete_row` | a sheet value was not written | offending sheet value / current DB value |
| `rejected:no_sheet_row` | a DB record has no place in the workbook (BMI period beyond the tab's columns, Parameter BMI label renamed) | row key / null |
| `rejected:deletes_skipped` | guard tripped (`column_name` `db` or `sheet` = whose deletes were skipped) | number of rows |
| `rejected:header_error` | a tab's header is broken | null |

`column_name` NULL with `row_key` set = whole-row delete-vs-edit conflict (values hold the rows). To undo a
resolution, edit the value in the web app or the sheet; the next run syncs it like any edit. Then set
`resolved_at`/`resolved_by` on the log row.

## Local scripts

```bash
bun lib/sync/scripts/probe-sheet.ts           # read-only: tab names, sizes (no cell contents)
bun lib/sync/scripts/check-remote.ts          # read-only: DB counts, dry run vs the real workbook, in-memory replay
bun lib/sync/scripts/check-remote.ts --lease  # also claim + release the lease once (sets last_error to a check note)
```

Both use read-only Google scopes and print counts only.

## First sync

1. `bun scripts/v2-setup-sheet.ts --apply` (tabs, formulas, locale), then `bun scripts/v2-import.ts --apply`
   (pd_ rows from the sheet + v1's BMI data; writes Tracker Staf W).
2. Dry run: `curl -sX POST -H "Authorization: Bearer $SYNC_SECRET" -H 'Content-Type: application/json'
   -d '{"dryRun":true}' https://<app>/api/sync/run`. Expect all `db*` counts 0 and only the id columns
   (Penggantian S/T, Rencana Aksi N) in `sheet.cellWrites`.
3. Real run (same curl without the body), then once more: every count should be 0.
