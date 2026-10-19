/**
 * One-time preparation of the v2 Google Sheet (the workbook as delivered) for the sync engine.
 *
 *   bun scripts/v2-setup-sheet.ts            # dry run: reads the sheet, prints what would change
 *   bun scripts/v2-setup-sheet.ts --apply    # makes the changes (needs Editor access)
 *
 * Changes, in this order (formulas are written while the sheet is still en_US, so commas parse):
 *  1. Notes typed under the tables (Tracker Staf, Penggantian SDM) move to Petunjuk: the engine
 *     would read them as rows. Petunjuk also gets lines for the two new tabs and the ID columns.
 *  2. Flag formulas treat a blank deadline as "no deadline" and "Batal / N.A." as done
 *     (Penggantian SDM R, Rencana Aksi M, Laporan Bulanan E), as lib/pd-rules.ts does.
 *  3. Dashboard formulas count to row 1000 instead of the last delivered row.
 *  4. New tab "Parameter BMI" (label/value, rows 5..12) with the BMI parameters.
 *  5. New tab "Cek BMI": one row per Tracker Staf row (ID SDM, Nama, Cabang, Stn by formula; L/P and
 *     NIPP as inputs), five check periods (Tgl Cek, Tinggi, Berat as inputs; BMI and Kategori by
 *     formula), the latest values, and "Catatan / Program Penyesuaian BB".
 *  6. Locale in_ID, time zone Asia/Jakarta (TODAY() is the Jakarta date).
 * The engine adds the ID SDM / ID Sistem columns itself on its first run and fills them.
 * Idempotent where it matters: a tab that already exists is left alone.
 */
import { a1Column, quoteTab, serviceAccountTokenSource } from "../lib/sync/sheets";
import { SETTINGS_ENTRIES } from "../lib/sync/tables";

const apply = process.argv.includes("--apply");
const env = process.env;
const id = env.GOOGLE_SHEETS_ID;
if (!id) throw new Error("GOOGLE_SHEETS_ID is not set");

const SCOPE = apply ? "https://www.googleapis.com/auth/spreadsheets" : "https://www.googleapis.com/auth/spreadsheets.readonly";
const token = serviceAccountTokenSource(env, [SCOPE]);
const API = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

type Meta = { properties: { locale: string; timeZone: string }; sheets: { properties: { sheetId: number; title: string } }[] };

const BMI_PERIODS = 5;
const BMI_ROWS = 300; // Tracker Staf rows 5..304 ↔ Cek BMI rows 6..305
const PARAM = "'Parameter BMI'!";

/** v1's BMI parameters on 19 Okt 2026 (the import copies the same values into pd_settings). */
const PARAM_VALUES: Record<string, string | number> = {
  bmi_first_check: "2026-10-12",
  bmi_interval_days: 14,
  bmi_periods: BMI_PERIODS,
  bmi_underweight_below: 18.5,
  bmi_normal_max: 25,
  bmi_overweight_max: 27,
  min_height_female: "",
  min_height_male: "",
};

const PENGGANTIAN_FLAG = (r: number) =>
  `=IF(I${r}="","",IF(I${r}="Batal / N.A.","Selesai",IF(AND(I${r}="Selesai",P${r}<>""),"Selesai",` +
  `IF(AND(I${r}<>"Selesai",F${r}<>"",TODAY()>F${r}),"Terlambat",IF(AND(P${r}="",O${r}<>"",TODAY()>O${r}),"Terlambat",` +
  `IF(AND(I${r}<>"Selesai",F${r}<>"",F${r}-TODAY()<=7),"Jatuh tempo ≤ 7 hari","On track"))))))`;
const RENCANA_FLAG = (r: number) =>
  `=IF(C${r}="","",IF(OR(H${r}="Selesai",H${r}="Batal / N.A."),"Selesai",IF(F${r}="","On track",` +
  `IF(TODAY()>F${r},"Terlambat",IF(F${r}-TODAY()<=7,"Jatuh tempo ≤ 7 hari","On track")))))`;
const LAPORAN_ON_TIME = (r: number) =>
  `=IF(A${r}="","",IF(D${r}="",IF(AND(C${r}<>"",TODAY()>C${r}),"Terlambat",""),IF(OR(C${r}="",D${r}<=C${r}),"Ya","Terlambat")))`;

function cekBmiGrid(): { header4: string[]; header5: string[]; rows: string[][]; noteCol: number } {
  const header4 = ["No", "ID SDM", "Nama", "Cabang", "Stn", "L/P", "NIPP"];
  const header5 = ["", "", "", "", "", "", ""];
  const start = (p: number) => 7 + (p - 1) * 5; // H = 7
  for (let p = 1; p <= BMI_PERIODS; p++) {
    header4.push(`="Cek ke-${p} (rencana "&TEXT(${PARAM}$C$5+${PARAM}$C$6*${p - 1},"dd/mm/yyyy")&")"`, "", "", "", "");
    header5.push("Tgl Cek", "Tinggi (cm)", "Berat (kg)", "BMI", "Kategori");
  }
  const after = start(BMI_PERIODS + 1);
  header4.push("Tinggi Terakhir (cm)", "Berat Terakhir (kg)", "Δ Berat vs Cek Pertama (kg)", "BMI Terakhir", "Kategori Terakhir", "Catatan / Program Penyesuaian BB");
  header5.push("", "", "", "", "", "");
  const noteCol = after + 5;

  const category = (cell: string) =>
    `IF(${cell}="","",IF(${cell}<${PARAM}$C$8,"Kurus",IF(${cell}<=${PARAM}$C$9,"Normal",IF(${cell}<=${PARAM}$C$10,"Overweight","Obesitas"))))`;
  const rows: string[][] = [];
  for (let i = 0; i < BMI_ROWS; i++) {
    const r = 6 + i;
    const t = 5 + i; // Tracker Staf row
    const row: string[] = [
      `=IF(B${r}="","",ROW()-5)`,
      `=IF('Tracker Staf'!$W${t}="","",'Tracker Staf'!$W${t})`,
      `=IF(B${r}="","",'Tracker Staf'!$B${t})`,
      `=IF(B${r}="","",'Tracker Staf'!$C${t})`,
      `=IF(B${r}="","",'Tracker Staf'!$D${t})`,
      "",
      "",
    ];
    for (let p = 1; p <= BMI_PERIODS; p++) {
      const h = `${a1Column(start(p) + 1)}${r}`;
      const w = `${a1Column(start(p) + 2)}${r}`;
      const b = `${a1Column(start(p) + 3)}${r}`;
      row.push("", "", "", `=IF(OR(${h}="",${w}=""),"",ROUND(${w}/(${h}/100)^2,1))`, `=${category(b)}`);
    }
    const latest = (offset: number) => {
      let f = '""';
      for (let p = 1; p <= BMI_PERIODS; p++) {
        const c = `${a1Column(start(p) + offset)}${r}`;
        f = `IF(${c}<>"",${c},${f})`;
      }
      return `=${f}`;
    };
    const first = (offset: number) => {
      let f = '""';
      for (let p = BMI_PERIODS; p >= 1; p--) {
        const c = `${a1Column(start(p) + offset)}${r}`;
        f = `IF(${c}<>"",${c},${f})`;
      }
      return f;
    };
    const lastW = `${a1Column(after + 1)}${r}`;
    const lastB = `${a1Column(after + 3)}${r}`;
    row.push(latest(1), latest(2), `=IF(${lastW}="","",ROUND(${lastW}-${first(2)},1))`, latest(3), `=${category(lastB)}`, "");
    rows.push(row);
  }
  return { header4, header5, rows, noteCol };
}

async function main() {
  const meta = await call<Meta>("GET", "?fields=properties(locale,timeZone),sheets(properties(sheetId,title))");
  const tabs = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const get = async (range: string, render = "FORMULA") =>
    (await call<{ values?: unknown[][] }>("GET", `/values/${encodeURIComponent(range)}?valueRenderOption=${render}`)).values ?? [];

  const plan: string[] = [];
  const valueWrites: { range: string; values: unknown[][] }[] = [];
  const requests: unknown[] = [];

  // 1. footnotes → Petunjuk
  const trackerTail = await get("'Tracker Staf'!A90:V95", "FORMATTED_VALUE");
  const pengTail = await get("'Penggantian SDM'!A17:R22", "FORMATTED_VALUE");
  const notes: string[] = [];
  trackerTail.forEach((row, i) => {
    const text = (row as string[]).find((v) => String(v ?? "").trim());
    if (text) {
      notes.push(`Tracker Staf: ${text}`);
      valueWrites.push({ range: `'Tracker Staf'!A${90 + i}:V${90 + i}`, values: [Array(22).fill("")] });
    }
  });
  pengTail.forEach((row, i) => {
    const text = (row as string[]).find((v) => String(v ?? "").trim());
    if (text) {
      notes.push(`Penggantian SDM: ${text}`);
      valueWrites.push({ range: `'Penggantian SDM'!A${17 + i}:R${17 + i}`, values: [Array(18).fill("")] });
    }
  });
  const petunjuk = await get("Petunjuk!A1:B60", "FORMATTED_VALUE");
  const nextRow = petunjuk.length + 2;
  const petunjukRows = [
    ["Cek BMI", "Tinggi & berat badan per 2 minggu, satu baris per staf Tracker Staf. Isi L/P, NIPP, Tgl Cek, Tinggi, Berat, dan catatan program. BMI dan kategori otomatis."],
    ["Parameter BMI", "Tanggal cek pertama, interval, jumlah cek, batas kategori BMI, syarat tinggi badan."],
    ["ID SDM / ID Sistem", "Diisi otomatis oleh aplikasi saat sinkronisasi. Jangan diubah atau dihapus; baris baru boleh dibiarkan kosong."],
    ...notes.map((n) => ["Catatan", n]),
  ];
  valueWrites.push({ range: `Petunjuk!A${nextRow}:B${nextRow + petunjukRows.length - 1}`, values: petunjukRows });
  plan.push(`Petunjuk: +${petunjukRows.length} baris (${notes.length} catatan dipindahkan dari bawah tabel)`);

  // 2. flag formulas
  const pengRows = (await get("'Penggantian SDM'!B5:B16", "FORMATTED_VALUE")).length;
  valueWrites.push({ range: `'Penggantian SDM'!R5:R${4 + pengRows}`, values: Array.from({ length: pengRows }, (_, i) => [PENGGANTIAN_FLAG(5 + i)]) });
  const raRows = (await get("'Rencana Aksi'!C5:C60", "FORMATTED_VALUE")).length;
  valueWrites.push({ range: `'Rencana Aksi'!M5:M${4 + raRows}`, values: Array.from({ length: raRows }, (_, i) => [RENCANA_FLAG(5 + i)]) });
  const lbRows = (await get("'Laporan Bulanan'!A5:A40", "FORMATTED_VALUE")).length;
  valueWrites.push({ range: `'Laporan Bulanan'!E5:E${4 + lbRows}`, values: Array.from({ length: lbRows }, (_, i) => [LAPORAN_ON_TIME(5 + i)]) });
  plan.push(`Flag: Penggantian R5:R${4 + pengRows}, Rencana Aksi M5:M${4 + raRows}, Laporan Bulanan E5:E${4 + lbRows}`);

  // 3. dashboard ranges
  const dash = await get("Dashboard!A1:L60");
  let widened = 0;
  const dashOut = dash.map((row) =>
    (row as unknown[]).map((cell) => {
      if (typeof cell !== "string" || !cell.startsWith("=")) return cell === undefined ? "" : cell;
      const next = cell
        .replace(/('Tracker Staf'!\$[A-Z]+\$5:\$[A-Z]+\$)89\b/g, "$11000")
        .replace(/('Penggantian SDM'!\$[A-Z]+\$5:\$[A-Z]+\$)16\b/g, "$11000")
        .replace(/('Rencana Aksi'!\$[A-Z]+\$5:\$[A-Z]+\$)60\b/g, "$11000");
      if (next !== cell) widened++;
      return next;
    }),
  );
  if (widened) valueWrites.push({ range: `Dashboard!A1:${a1Column(Math.max(...dashOut.map((r) => r.length)) - 1)}${dashOut.length}`, values: dashOut });
  plan.push(`Dashboard: ${widened} rumus diperlebar sampai baris 1000`);

  // 4 + 5. new tabs
  const newTabs: string[] = [];
  if (!tabs.has("Parameter BMI")) newTabs.push("Parameter BMI");
  if (!tabs.has("Cek BMI")) newTabs.push("Cek BMI");
  plan.push(newTabs.length ? `Tab baru: ${newTabs.join(", ")}` : "Tab Parameter BMI dan Cek BMI sudah ada: dilewati");
  const grid = cekBmiGrid();

  // 6. locale
  const localeChange = meta.properties.locale !== "in_ID" || meta.properties.timeZone !== "Asia/Jakarta";
  plan.push(localeChange ? `Locale ${meta.properties.locale} → in_ID, zona ${meta.properties.timeZone} → Asia/Jakarta` : "Locale sudah in_ID / Asia/Jakarta");

  console.log(plan.map((p) => `- ${p}`).join("\n"));
  if (!apply) {
    console.log("\nDry run: nothing written. Run with --apply to make these changes.");
    return;
  }

  // ---- apply
  if (newTabs.length) {
    await call("POST", ":batchUpdate", {
      requests: newTabs.map((title, i) => ({ addSheet: { properties: { title, index: 3 + i, gridProperties: { rowCount: title === "Cek BMI" ? BMI_ROWS + 10 : 30, columnCount: title === "Cek BMI" ? grid.header4.length + 2 : 6, frozenRowCount: title === "Cek BMI" ? 5 : 4 } } } })),
    });
    const after = await call<Meta>("GET", "?fields=sheets(properties(sheetId,title))");
    for (const s of after.sheets) tabs.set(s.properties.title, s.properties.sheetId);
  }
  if (newTabs.includes("Parameter BMI")) {
    valueWrites.push({
      range: `${PARAM}A1:C${4 + SETTINGS_ENTRIES.length}`,
      values: [
        ["Parameter Cek BMI", "", ""],
        ["Dipakai tab Cek BMI dan aplikasi. Ubah di sini atau di halaman Parameter aplikasi.", "", ""],
        ["", "", ""],
        ["", "Parameter", "Nilai"],
        ...SETTINGS_ENTRIES.map((e) => ["", e.label, PARAM_VALUES[e.key] ?? ""]),
      ],
    });
  }
  if (newTabs.includes("Cek BMI")) {
    valueWrites.push({
      range: `'Cek BMI'!A1:${a1Column(grid.header4.length - 1)}${5 + BMI_ROWS}`,
      values: [
        ["CEK BMI, TINGGI BADAN & BERAT BADAN – PER 2 MINGGU"],
        ["Satu baris per staf di Tracker Staf. Isi L/P, NIPP, Tgl Cek, Tinggi, Berat, dan catatan. Kolom lain otomatis."],
        [],
        grid.header4,
        grid.header5,
        ...grid.rows,
      ],
    });
    const sheetId = tabs.get("Cek BMI")!;
    const dateCols = Array.from({ length: BMI_PERIODS }, (_, p) => 7 + p * 5);
    requests.push(
      ...dateCols.map((c) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: 5, endRowIndex: 5 + BMI_ROWS, startColumnIndex: c, endColumnIndex: c + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
          fields: "userEnteredFormat.numberFormat",
        },
      })),
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 3, endRowIndex: 5 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.96, blue: 0.94 } } },
          fields: "userEnteredFormat(textFormat,backgroundColor)",
        },
      },
      {
        setDataValidation: {
          range: { sheetId, startRowIndex: 5, endRowIndex: 5 + BMI_ROWS, startColumnIndex: 5, endColumnIndex: 6 },
          rule: { condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "L" }, { userEnteredValue: "P" }] }, strict: false, showCustomUi: true },
        },
      },
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenColumnCount: 3 } }, fields: "gridProperties.frozenColumnCount" } },
    );
  }
  if (newTabs.includes("Parameter BMI")) {
    const sheetId = tabs.get("Parameter BMI")!;
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 2, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }

  for (let i = 0; i < valueWrites.length; i += 20) {
    await call("POST", "/values:batchUpdate", { valueInputOption: "USER_ENTERED", data: valueWrites.slice(i, i + 20) });
  }
  if (requests.length) await call("POST", ":batchUpdate", { requests });
  if (localeChange) {
    await call("POST", ":batchUpdate", {
      requests: [{ updateSpreadsheetProperties: { properties: { locale: "in_ID", timeZone: "Asia/Jakarta" }, fields: "locale,timeZone" } }],
    });
  }
  console.log("\nApplied.");
}

void quoteTab;
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
