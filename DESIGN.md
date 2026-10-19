# DESIGN.md: JOUMPA People Development Tracker

Owner direction (12 Okt 2026): use the same UI/UX as the Garuda People Development Tracker
(`~/Desktop/garuda tracker`, its DESIGN.md and components are the reference), same neutral palette,
but the blue/navy accent becomes **emerald green** (Gapura's own colour). Simple and professional,
production tool. This file is the single source of truth for UI work in this repo.

Reading this as: an internal operations tool for JOUMPA (meet & assist) station PICs (phone, at the
airport) and KPS head office (laptop, 5 stations), Gapura-branded, quiet and data-first.
**Dial: ENERGY 1 / RHYTHM 1 / MOTION 1.**

## Principles (same as Garuda)

1. **One job per screen.** Each screen is built around the one decision the user makes there.
2. **The data is the loudest thing.** Small headings, short copy, colour only for exceptions.
3. **No explanation paragraphs.** No page descriptions, no "Cara mengisi" tips. One meta line per page
   maximum (counts + noun, e.g. "SUB · Minggu ke-2 · 4 dari 5 dinilai"). Help lives in labels,
   placeholders and one optional "Bantuan" popover per grid.
4. **Product vocabulary, not spreadsheet vocabulary.** Never show: workbook, sheet, sel kuning,
   kolom H, rumus, tabel 7.2 / 6.1 / 6.2 references, dummy. Use "halaman", "isian",
   "dihitung otomatis", "kriteria kelulusan".
5. **Honest numbers.** Every number comes from data; empty is "–" with a reason.

## Identity

- Logo: co-brand lockup (`components/shell/Logo.tsx`), JOUMPA Airport VIP Service
  (`public/brand/joumpa-airport-vip-service.png`, at 0.6 of the Gapura height for optical balance), a 1px
  --line divider, then Gapura Airport Services (`public/brand/gapura-airport-services.png`). Always on white
  (the JOUMPA tagline is dark grey). Set height, width auto, never recolour, stretch or crop. Sizes are the
  Gapura height: sidebar 24px (in a white chip), phone top bar 24px, login 40px, print 32px.
- **Identity motif:** station codes (SUB, DPS, CGK, HLP, KNO) set in tabular semibold as short codes;
  the scope line ("Stasiun SUB", "KPS · semua stasiun") sits under the logo in the sidebar.
- **Emerald replaces navy.** Deep emerald carries primary buttons, active nav and focus; the bright
  emerald of the Gapura mark appears only as a small non-text accent (the "now" dot, a 2px rule
  under the sidebar logo). It is never used for text: it is 2.78:1 on white.

## Tokens (light only; reports are printed)

Contrast measured with the antislop contrast checker.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--bg` | #f7f8fa | page | |
| `--surface` | #ffffff | panels, tables, inputs | |
| `--surface-sunken` | #f1f3f6 | table headers, computed (read-only) cells | |
| `--ink` | #1c2433 | text | 15.6:1 on surface |
| `--ink-muted` | #535b68 | secondary text | 6.85:1 surface, 6.17 sunken |
| `--line` | #d5dae1 | dividers only | |
| `--line-strong` | #7c8390 | control borders | 3.81:1 |
| `--brand` | #0f6b4a | deep emerald: primary button, active nav text, focus ring | white on it 6.52:1; on #f7f8fa 6.13:1 |
| `--brand-strong` | #0b5a3e | hover/pressed | white on it 8.25:1 |
| `--brand-tint` | #e3f2ea | active nav fill, selected row | brand on it 5.63:1 |
| `--accent` | #0e7a53 | "now" label, inline links | 5.35:1 on white |
| `--accent-bright` | #3fae7a | non-text only: "now" dot, logo rule | decorative |
| good | #1d6b40 on #e6f3ea | Sesuai, Normal, Memenuhi, Selesai, Lulus, Tepat waktu | 5.69:1 |
| warning | #8a4b00 on #fdf1d8 | Perlu Perbaikan, Overweight, Kurus, Jatuh tempo ≤ 7 hari, Menunggu | 6.07:1 |
| critical | #a1261b on #fbe7e3 | Tidak Sesuai, Obesitas, OVERDUE, Tidak Memenuhi, Belum lulus | 6.28:1 |
| progress | #6b3fa0 on #f1ebf8 | On Progress, Rutin – pantau, Coaching 30 Hari | 6.32:1 |
| neutral | `--ink-muted` on #eceef2 | Belum Mulai, Tertunda, no data | 5.9:1 |

Good-status green sits next to the emerald brand: status is always shown as text, and good/neutral are
plain text (no fill), so it is never confused with an action. No gradients, no yellow input tint:
editable cells are white with a `--line-strong` border on hover/focus, computed cells sit on
`--surface-sunken` in `--ink-muted`, and a two-item legend ("Isian" / "Dihitung otomatis") is the second cue.

## Typography, space, shape, depth, motion

Identical to the Garuda DESIGN.md: Plus Jakarta Sans 400/600, tabular numbers, scale 13/14/16/20
(page title 20/600), sentence case, no em dash, no exclamation marks; spacing 4/8/12/16/24/32/48,
gutters 16/24/32; rows 40px (tables) / 36px (entry grids) / ≥ 48px (phone lists); tap targets ≥ 44px
below 1024px; radius 6 controls, 8 panels, 4 status labels; borders only, `--shadow-float` for menus,
dialogs and the phone sheet; transitions ≤ 120ms, none with reduced motion.

## Shell and navigation (v2, 19 Okt 2026)

- **≥1024px:** fixed left sidebar 232px (logo, scope card with the next BMI check, "Cek BMI ke-2: 26 Okt"):
  - **Pantau:** Beranda, Laporan Bulanan
  - **Tindak lanjut:** Rencana Aksi, Cek BMI
  - **Data SDM:** Tracker Staf, Penggantian SDM
  - **Pengelolaan** (owner only): Tautan Akses, Akun Cabang, Parameter, Sinkronisasi
- A single-station link or account sees **Rencana Aksi and Cek BMI only** (its home is Rencana Aksi);
  a branch account's Cek BMI keeps v1's name "BMI Monitoring Tracker".
- **<1024px:** 56px top bar (logo, scope code, Menu); **<640px:** the Menu moves to the bottom bar
  (Beranda, Rencana Aksi, Cek BMI, Menu); "Menu" shows as current when the page lives in it.

## Screens (focal element → primary action)

Every screen has the same grammar: PageHeader banner (title = the menu label, one meta line of counts or
deadlines, at most one primary action), a summary row (MetricCards, compact on phones), a Toolbar of
URL-backed filters, then the grid (desktop) or cards (phones).

- **Beranda** (KPS, owner). KPI cards that link to their tracker; "Progres per cabang"; "Progres rencana
  aksi per area"; "Linimasa kunci". "Tindak lanjut terlambat" counts Tracker Staf, Penggantian and Rencana
  Aksi (Cek BMI has its own lateness on its page).
- **Rencana Aksi** (every scope). Cards on phones with "Perbarui"; grid on desktop. Full CRUD within the
  caller's Cabang; delete archives (owner restores).
- **Cek BMI.** v1's tracker on pd_ tables. A check is late only after its window closes (first check
  date + interval − 1); entry dates default to today.
- **Tracker Staf** (KPS, owner). One row per person; the PIC input columns carry a light cream tint
  (owner's request, overriding "no yellow input tint" for these seven columns only).
- **Penggantian SDM** (KPS, owner). Reminder when "Nama pengganti" has no Tracker Staf row.
- **Laporan Bulanan** (KPS, owner). Oldest period first (the next report due on top); "–" when there is
  nothing to count.

Shared rules:
- **Filters** list the Cabang / stations that hold data (35 stations exist, the programme covers five
  Cabang); add dialogs list those first, then the rest.
- **Dialog footer:** left, `Button variant="delete"` "Hapus <noun>" (opens a confirmation); right,
  "Batal" then the primary "Simpan perubahan" / "Simpan <noun>".
- **Phone card action:** "Perbarui". **Counts:** "N <noun>" (rencana aksi, staf, usulan, laporan), never
  "baris". **Last change:** "Diubah lewat <link name | tautan ini | pengelola, akun cabang, atau Google Sheet>, <time>".
- **Status colours** come only from `components/ui/StatusChip.tsx` (RULE_TONES, PD_TONES); no local tone maps.

## Theme revision (15 Okt 2026): same look as the Garuda tracker, in Gapura green

Applied from the tokens in `app/globals.css`; the logo and CRUD behaviour are unchanged.
- Sidebar and phone menu sheet are deep Gapura green (`--navy` #0f2f26, white on it 14.4:1) with the logo
  on a white chip (never recoloured). Group headings #a3c4b5 (7.6:1), secondary text #b4d2c4 (8.9:1).
  See "Sidebar revision (18 Okt 2026)" for the current nav rows.
- Primary colour stays deep emerald (`--brand` #0f6b4a); page `--bg` #f4f8f6.
- Every page opens with the `.hero` banner (PageHeader): deep green to emerald, optional eyebrow, title,
  one meta line, actions restyled for the dark banner (`.hero-actions`). Plain in print.
- `MetricCards` gives four-up summaries. Radii 10 controls, 14 panels, 6 status labels; panels carry
  `--shadow-card`; good status labels are tinted too.
This supersedes the earlier "borders only", "4px radius" and white-sidebar rules.

## Cek BMI (15 Okt 2026): the Garuda BMI Monitoring Tracker, on the JOUMPA sheet

Same screen and behaviour as the Garuda tracker (banner, four counts, one workspace with filters, the
spreadsheet-style table, edit dialogs, profile panel, CSV export, phone cards). The columns follow the
JOUMPA tab "Cek BMI 2 Mingguan":
- Identity: No, ID SDM (No Pegawai = NIPP for a branch account), Nama Petugas, Stasiun, L/P.
- Every check: Tgl Cek, Tinggi (cm), Berat (kg), BMI, Kategori. No Komitmen/Target, no Touch Point,
  no Feedback/Remarks, no "Ada Catatan BMI" (the JOUMPA sheet has none of them).
- Summary: Tinggi/Berat Terakhir, Δ Berat vs Cek Pertama, BMI and Kategori Terakhir, Syarat Tinggi Badan,
  then the derived Cek Berikutnya and Status Jadwal, and Catatan / Program Penyesuaian BB.
- Checks are named "BMI Cek ke-N (Periode 12-25 Oct 2026)" everywhere (lib/bmi-periods.ts). Everyone is
  checked every `bmi_interval_days`; the number of checks is 1 to 52 (Parameter) and cannot drop below a
  check that has data. Every check, the first included, can be edited.
- Access: a station link (not KPS) and a single-station branch account have the Cek BMI menu only; their
  home and every other address redirect to Cek BMI. KPS links, KPS accounts and the owner keep every page.

## Sidebar revision (18 Okt 2026)

Sidebar (≥1024px) and the phone menu sheet share one layout, in three bands split by 1px white/15 hairlines:
- **Identity:** logo on a white chip, then the scope card (white/6 fill, white/12 inset ring): pin icon +
  scope line, calendar icon + programme week.
- **Nav:** each group (menu) is an uppercase 13/600 caption (#a3c4b5) over its items; groups are separated by a
  hairline. Every item is icon + label: 20px icons from `components/shell/NavIcon.tsx` (one family, 24 grid,
  1.75 stroke, Lucide-style), inactive text #d3e6dd (11.1:1) with icons #8db3a3 (6.3:1), hover white/8 and
  white. Rows 36px from 1024px, 44px below.
- **Sub-items:** indented 12px under their group caption on a 1px white/20 vertical guide line that runs
  from the caption to the last item. Long labels wrap to a second line instead of being cut off.
- **Current page:** a light pill, `--brand-tint` fill with navy 600 text (12.5:1) and a `--brand` icon. The
  pill itself is 12.5:1 against the sidebar, so the state never rests on colour alone. No side stripe.
- **Footer:** the account (user icon) or link label (link icon) and a "Keluar" row, on the same icon column.
- Every icon, logo and label in the sidebar sits on one 24px column. Focus ring #a9e9b9 (10.3:1).
- Phone bottom bar: icon over label; the current page gets a `--brand-tint` pill behind its icon and brand
  600 text. The cells share the width, so a BMI-only account gets two wide cells.
