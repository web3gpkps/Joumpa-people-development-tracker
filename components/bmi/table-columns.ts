/*
 * Column widths of the Cek BMI table, in px. The table is fixed-layout, so these are the real
 * widths; the sticky offsets in app/globals.css (48 + 120 = 168) and the period window's
 * arithmetic (period-window.ts) rely on them. Pure, so a test can check the sums.
 */
import { NOTE_LABEL, PERIOD_FIELD_LABELS } from "./labels";
import type { TableGeometry } from "./period-window";

export const W = {
  no: 48,
  id: 120,
  name: 204,
  unit: 84,
  sex: 70,
  date: 128,
  measure: 100,
  bmi: 78,
  cat: 118,
  summary: 130,
  summaryWide: 186,
  comment: 260,
} as const;

/** Room for the one-line text of a text cell: its width less the padding and the toggle. */
export const textWidth = (col: number) => col - 47;

export type Column = { label: string; width: number; className?: string };

export const IDENTITY: Column[] = [
  { label: "No", width: W.no, className: "sticky sticky1" },
  { label: "ID SDM", width: W.id, className: "sticky sticky2" },
  { label: "Nama Petugas", width: W.name, className: "sticky sticky3" },
  { label: "Stasiun", width: W.unit },
  { label: "L/P", width: W.sex },
];

const PERIOD_WIDTHS = [W.date, W.measure, W.measure, W.bmi, W.cat] as const;
export const PERIOD_FIELDS: Column[] = PERIOD_FIELD_LABELS.map((label, i) => ({ label, width: PERIOD_WIDTHS[i] }));

/** The sheet's summary columns, then the schedule the screen derives from them (components/bmi/schedule.ts). */
export const SUMMARY: Column[] = [
  { label: "Tinggi Terakhir (cm)", width: W.summary, className: "summary-tint" },
  { label: "Berat Terakhir (kg)", width: W.summary },
  { label: "Δ Berat vs Cek Pertama (kg)", width: W.summary },
  { label: "BMI Terakhir", width: W.bmi },
  { label: "Kategori Terakhir", width: W.cat },
  { label: "Syarat Tinggi Badan", width: W.summaryWide },
  { label: "Cek Berikutnya", width: W.date },
  { label: "Status Jadwal", width: W.summaryWide },
  { label: NOTE_LABEL, width: W.comment },
];

const sum = (columns: readonly Column[]) => columns.reduce((total, column) => total + column.width, 0);

/** What period-window.ts needs: the leading columns, one period group, the frozen columns. */
export const GEOMETRY: TableGeometry = {
  leading: sum(IDENTITY),
  perPeriod: sum(PERIOD_FIELDS),
  frozen: IDENTITY.filter((column) => column.className?.includes("sticky")).reduce((total, column) => total + column.width, 0),
};
