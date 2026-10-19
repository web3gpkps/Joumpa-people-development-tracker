# JOUMPA People Development Tracker

**Monitoring Tindak Lanjut People Development SDM JOUMPA**

Aplikasi web untuk memantau tindak lanjut People Development SDM JOUMPA di lima cabang (CGK & HLP, DPS,
SUB, KNO, BPN), Customer Service Division PT Gapura Angkasa. Isinya mengikuti workbook "Tracker Tindak
Lanjut People Development JOUMPA" (Dashboard, Tracker Staf, Penggantian SDM, Rencana Aksi, Laporan
Bulanan, Referensi) ditambah **Cek BMI** dari JOUMPA Uplifting Action Tracker (v1).

v1 tetap berjalan di alamatnya sendiri. Kedua aplikasi memakai **project Supabase yang sama**: tabel v2
berawalan `pd_` dan tidak pernah mengubah tabel v1. Yang dipakai bersama (hanya dibaca oleh v2): login
(`auth.users`), akun cabang (`profiles`), daftar stasiun (`stations`) dan pemilik (`admins`).

## Siapa memakai apa

| Peran | Akses | Halaman |
|---|---|---|
| Stasiun (salah satu dari 35 kode di `stations`) | tautan `/s/<token>` atau akun cabang di `/cabang` | **Rencana Aksi** (tambah, ubah, hapus = arsip, untuk Cabang-nya sendiri) dan **Cek BMI** (stasiunnya sendiri) |
| KPS | tautan lingkup KPS atau akun cabang KPS | semua halaman, semua cabang |
| Pemilik | `/login`, area `/admin` | semua halaman + Tautan Akses, Akun Cabang, Parameter (BMI dan Area), Sinkronisasi; memulihkan Rencana Aksi yang diarsipkan |

Akun cabang dipakai bersama v1: persetujuan, ganti kata sandi dan hapus akun berlaku di kedua aplikasi.
Tautan `/s/<token>` terpisah per aplikasi.

Google Sheet replika (workbook di atas + tab `Cek BMI` dan `Parameter BMI`) tersinkron dua arah dengan
database; lihat `docs/SYNC.md` dan `apps-script/README.md`.

## Teknologi

Next.js 16 (App Router, Cache Components), React 19, TypeScript, Tailwind CSS 4, Supabase (Postgres, Auth,
RLS), Vercel, Google Sheets API dan Apps Script. Paket dikelola dengan bun.

## Menjalankan secara lokal

```bash
bun install
cp .env.example .env.local   # lalu isi nilainya
bun run dev
```

| Variabel | Untuk |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | koneksi aplikasi ke Supabase (sama dengan v1) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | mesin sinkronisasi, hanya di server |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_ID` | akses service account ke Google Sheet v2 |
| `SYNC_SECRET`, `SYNC_PING_SECRET` | otorisasi `POST /api/sync/run` (cron dan Apps Script), **berbeda dari v1** |
| `CONFLICT_POLICY` | opsional, bawaan `db-wins` |

Jangan pernah menaruh kunci service role atau kunci Google di variabel `NEXT_PUBLIC_*`.

## Database

- `supabase/baseline-prod/`: migrasi v1 apa adanya. **Tidak pernah dijalankan dari repo ini**; hanya dipakai
  tes supaya PGlite meniru database bersama.
- `supabase/migrations/`: migrasi v2 (`pd_*`), murni menambah. Diterapkan dengan psql, berurutan:

```bash
for f in supabase/migrations/*.sql; do psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$f"; done
```

- `supabase/production-setup.sql`: secret Vault dan cron v2 (sekali, setelah deploy).

Tes keamanan SQL tanpa Docker (PGlite, migrasi v1 lalu v2):

```bash
bun tests/sql/run.ts          # semua file
bun tests/sql/run.ts 20       # hanya tes v2
```

Tipe TypeScript dari migrasi: `bun scripts/gen-types.ts supabase/baseline-prod,supabase/migrations lib/database.types.ts`.

## Peluncuran (sekali)

1. Terapkan migrasi v2 (di atas).
2. `bun scripts/v2-setup-sheet.ts` (lihat dulu), lalu `--apply`: menyiapkan Google Sheet (tab Cek BMI dan
   Parameter BMI, rumus Flag, rentang Dashboard, catatan kaki ke Petunjuk, lokal Indonesia).
3. `bun scripts/v2-import.ts` (lihat dulu), lalu `--apply`: mengisi tabel `pd_` dari Sheet, dengan kode staf,
   NIPP, L/P, catatan dan cek BMI dari v1. SQL-nya berisi nama, jadi disimpan di `scripts/out/` (diabaikan git).
4. Deploy ke Vercel, isi env, jalankan `production-setup.sql`, pasang Apps Script.
5. Sinkronisasi pertama mengisi kolom `ID SDM` / `ID Sistem` di Sheet.

## Tes

```bash
bun test                  # rumus workbook, BMI, grid, sinkronisasi, komponen
bun tests/sql/run.ts      # tes keamanan SQL di PGlite
bun run lint
bun run build
```

## Dokumen

- `docs/UX.md` dan `DESIGN.md`: perilaku layar dan arah visual
- `docs/SYNC.md` dan `apps-script/README.md`: sinkronisasi Google Sheet
- `lib/pd-rules.ts`: rumus workbook (Flag, Hasil penilaian ulang, Lulus training, Dashboard)

Workbook sumber dan data impor berisi nama petugas, jadi tidak disimpan di repositori ini.
