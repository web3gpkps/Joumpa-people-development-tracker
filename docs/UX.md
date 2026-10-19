# UX.md: JOUMPA Uplifting Action Tracker, usability redesign (8 Oct 2026)

Owner request: "make the dashboard and all UI/UX on every role and screen more user friendly;
best, most comfortable UX; a clearer dashboard; make BMI and other data entry easier, e.g. with
Excel-like tables." This file turns that into rules every engineer follows. DESIGN.md (12 Okt
2026, the Garuda tracker's UI with an emerald accent) sets the visual direction, the navigation and
the vocabulary, and wins where the two differ; this file sets how screens behave.

## 1. Mental model: the workbook's data, product vocabulary

The data and rules are the workbook's, but the screens use product names (DESIGN.md Principle 4):
never "sheet", "workbook" or "sel kuning" in the interface. Every role sees the same pages,
grouped in the nav (Pantau / Input mingguan / Data / Pengelolaan):

| Page (nav label) | Workbook source | Owner | KPS link | Station link |
|---|---|---|---|---|
| Beranda | Dashboard | all stations | all stations | own station |
| Laporan Mingguan | Laporan Mingguan | all + print | all + print | own + print |
| Penilaian Mingguan | Log Performa Mingguan + Rekap Performa | CRUD | CRUD | CRUD (own) |
| Cek BMI | Cek BMI 2 Mingguan | CRUD | CRUD | CRUD (own) |
| Tindak Lanjut | Tindak Lanjut | CRUD incl. add/delete items | update + KPS fields | update (own report group) |
| Data SDM | Master SDM | CRUD | edit, add | edit, add (own) |
| Penggantian SDM | Penggantian SDM | CRUD | CRUD | CRUD (own) |
| Tautan Akses, Parameter, Sinkronisasi | Parameter | owner only | | |

Owner area routes live under `/admin/*`, station workspace under `/s/[token]/*`. Same screen
components, one `access` prop decides scope, base path and which actions exist.

**Input vs computed cells** (DESIGN.md Tokens): editable cells are white with a border on hover,
computed cells (Rata-rata, Status, BMI, Kategori, Flag, Sisa hari) sit on the sunken grey in muted
text and are read-only. The two-item legend "Isian" / "Dihitung otomatis" (`GridLegend`) sits in
the grid toolbar. Status is always text (`StatusChip`, one tone map); only exceptions get a tint.

## 2. Spreadsheet grid for every bulk entry (desktop and tablet ≥ 900 px)

One shared `DataGrid` component, used by Penilaian Mingguan, Cek BMI, Data SDM, Tindak Lanjut and
Penggantian SDM. It must feel like Excel / Google Sheets:

- **Freeze panes**: sticky header row(s) and sticky ID + Nama columns. Column groups with a
  group header (e.g. Cek BMI: "Cek ke-1 (12 Okt)" over Tgl / TB / BB / BMI / Kategori, five groups
  side by side like the workbook; the current period's group is highlighted and scrolled into view).
- **Selection and keys**: click or arrow keys move the active cell; typing starts editing and
  replaces the value; Enter or F2 edits; Enter commits and moves down; Tab / Shift+Tab move
  right / left; Esc cancels the edit; Delete / Backspace clears the selected cells; Home / End
  jump within the row. Visible active-cell outline (brand colour, 2 px), never colour-only.
- **Paste from Excel / Google Sheets**: Ctrl/Cmd+V of a copied block (tab-separated rows) fills
  cells from the active cell, validated per cell; Ctrl/Cmd+C copies the selection as TSV.
- **Cell editors by type**: number (decimal comma accepted, numeric keypad), score 1–5, date
  (type `12/10/2026` or pick), dropdown for enums (L/P, status, kesimpulan, Ya/Belum, scope),
  long text opens a small editor popover.
- **Validation**: invalid cells get a red outline + message on focus/hover and are not saved;
  the rest of the row still saves. Ranges come from the DB checks (score 1–5, TB 120–210, BB 30–200,
  progress 0–100).
- **Saving: automatic, per row**, a short moment after the last committed cell (and on leaving the
  row). A narrow status column at the row start shows saving / saved / error (icon + text for
  screen readers). Nothing typed is ever lost on an error; a retry control appears. A "Belum
  tersimpan: N baris" counter sits in the grid toolbar. Leaving the page with unsaved rows asks first.
- **Toolbar**: station select (KPS/owner: one `StationSelect`, "Semua stasiun" first), search by
  name or ID, `WeekSelect` (week or BMI period, with ‹ › steppers) where relevant, the legend,
  "Tambah baris" where adding is allowed, and a count ("75 SDM · 12 sudah dinilai"). Filter state
  lives in the URL.
- **Delete**: row-level "Hapus" with confirmation; for scores / BMI, clearing all input cells of
  a row deletes that entry after a confirmation.
- Accessible: ARIA grid roles, every cell reachable by keyboard, labels announced
  ("SUB-01, Petugas Contoh, B Grooming"), focus visible.

**Phones (< 900 px)**: a 15-column grid is not usable on a phone. Show the same data as one card
per staff / item with large inputs (44 px), saving per card, same validation and status. Cek BMI on
a phone at the station is the main mobile flow: one staff card at a time is fine, with "Simpan &
berikutnya".

## 3. Beranda: clear at a glance

DESIGN.md Screens sets the Beranda layout (station link: this week's to-do list; KPS/owner: a
station table worst first). The questions it answers, in this order:
1. **Where are we in the programme?** One line, "Minggu ke-N dari 10" (also in the sidebar); there
   is no week rail in the chrome.
2. **What needs action now?** The "Perlu ditangani" list (overdue / due ≤ 7 days, staff not yet
   scored this week, staff not yet measured this period, replacements at risk), each item a link.
3. **How is each station doing?** A compact comparison, one row per station: SDM dinilai minggu ini
   (n/m with a bar), rata-rata skor vs baseline, % Sesuai, BMI tercek periode ini (n/m), Tindak
   Lanjut selesai (n/13) and OVERDUE count. Every row links to the filtered page.

No KPI tile strips. Numbers are real only, never an invented delta; before the programme starts
the page says so instead of showing zeros as if they were results.

## 4. Comfort details that apply everywhere
- No "Cara mengisi" tips and no page descriptions: help lives in labels, placeholders and at most
  one "Bantuan" popover per grid. One meta line per page (`PageHeader meta`).
- Remember per browser: last station filter, last week/period (guarded localStorage).
- Dates shown as `12 Okt 2026`; numbers with comma decimals; tabular figures in grids.
- Loading: static skeleton rows that match the grid (`TableSkeleton`). Empty states: why + next
  action. Errors: plain words, never raw database text or column names.
- Every change shows who made it last ("Diubah lewat tautan SUB, 8 Okt 07.55" or "pengelola").
- Speed: the grid must stay smooth with 75 rows × 30 columns (memoised rows, no full re-render on
  each keystroke).
