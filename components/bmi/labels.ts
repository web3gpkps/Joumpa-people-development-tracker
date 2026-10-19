/*
 * Sheet structure numbers for the Cek BMI screen. The names of the checks come from
 * lib/bmi-periods.ts (bmiCheckLabel, bmiCheckName), the one source for the screens and the Excel export.
 */

/** The Google Sheet tab this screen mirrors (lib/sync/tables.ts). */
export const BMI_SHEET_TAB = "Cek BMI 2 Mingguan";

/** Identity columns before the first check (No, ID SDM, Nama Petugas, Stasiun, L/P). */
const IDENTITY_COLUMNS = 5;
/** The columns of every check, in order; the table and the Excel export use the same words. */
export const PERIOD_FIELD_LABELS = ["Tgl Cek", "Tinggi (cm)", "Berat (kg)", "BMI", "Kategori"] as const;
export const PERIOD_COLUMNS = PERIOD_FIELD_LABELS.length;

/** Tinggi Terakhir ... Catatan / Program Penyesuaian BB. */
const SUMMARY_COLUMNS = 7;

/** The label of the note column, as the sheet heads it. */
export const NOTE_LABEL = "Catatan / Program Penyesuaian BB";

/** Spreadsheet column letters: 1 is A, 26 is Z, 27 is AA, 37 is AK. */
export function columnLetters(n: number): string {
  let out = "";
  for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    out = String.fromCharCode(65 + ((rest - 1) % 26)) + out;
  }
  return out;
}

/** Columns of the sheet tab for this many checks: five identity columns, one group per check, seven summary columns. */
export function sheetColumnCount(periods: number): number {
  return IDENTITY_COLUMNS + PERIOD_COLUMNS * periods + SUMMARY_COLUMNS;
}

/** "A–AK": the column range of the sheet tab. */
export function sheetColumnRange(periods: number): string {
  return `A–${columnLetters(sheetColumnCount(periods))}`;
}
