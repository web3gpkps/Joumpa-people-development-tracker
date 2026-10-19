/*
 * "Ekspor Excel" of the Cek BMI screen, JOUMPA columns: what the screen shows at that moment (the rows
 * after search and filters, the counts, the period groups of the current view) as a BmiWorkbookInput.
 * The model is pure (xlsx-export.test.ts); downloadBmiXlsx loads ExcelJS only when the button is used.
 */
import { bmiCheckName } from "@/lib/bmi-periods";
import type { Settings } from "@/lib/rules";
import { BMI_SHEET_TAB, NOTE_LABEL } from "./labels";
import {
  CATEGORY_FILTERS,
  STATUS_FILTERS,
  idOf,
  type BmiRowView,
  type CategoryFilter,
  type StatusFilter,
  type TrackerMetrics,
} from "./tracker-model";
import type { BmiWorkbookInput, XlsxColumn, XlsxGroup, XlsxLogo } from "@/lib/xlsx/bmi";
import { downloadXlsx } from "@/lib/xlsx/download";

export const XLSX_THEME = { navy: "#0F2F26", brand: "#0F6B4A", heroEnd: "#15684A" } as const;

/** The banner's logos, left to right, at the height they are drawn in the sheet (px). */
export const XLSX_LOGOS: ReadonlyArray<{ src: string; height: number }> = [
  { src: "/brand/joumpa-airport-vip-service.png", height: 28 },
  { src: "/brand/gapura-airport-services.png", height: 46 },
];

const HEIGHT: [number, number] = [120, 210];
const WEIGHT: [number, number] = [30, 200];

const IDENTITY = (idLabel: string): XlsxColumn[] => [
  { header: "No", kind: "index", width: 6 },
  { header: idLabel, kind: "id", width: 14 },
  { header: "Nama Petugas", kind: "name", width: 30 },
  { header: "Stasiun", kind: "text", width: 10 },
  { header: "L/P", kind: "text", width: 7 },
];

const PERIOD: XlsxColumn[] = [
  { header: "Tgl Cek", kind: "date", width: 14, input: true },
  { header: "Tinggi (cm)", kind: "cm", width: 11, input: true, range: HEIGHT },
  { header: "Berat (kg)", kind: "kg", width: 11, input: true, range: WEIGHT },
  { header: "BMI", kind: "bmi", width: 8, live: "bmi" },
  { header: "Kategori", kind: "category", width: 13, live: "category" },
];

const SUMMARY: XlsxColumn[] = [
  { header: "Tinggi Terakhir (cm)", kind: "cm", width: 12 },
  { header: "Berat Terakhir (kg)", kind: "kg", width: 12 },
  { header: "Δ Berat vs Cek Pertama (kg)", kind: "delta", width: 14 },
  { header: "BMI Terakhir", kind: "bmi", width: 10 },
  { header: "Kategori Terakhir", kind: "category", width: 14 },
  { header: "Syarat Tinggi Badan", kind: "height", width: 20 },
  { header: "Cek Berikutnya", kind: "date", width: 14 },
  { header: "Status Jadwal", kind: "schedule", width: 16 },
  { header: NOTE_LABEL, kind: "wrap", width: 40 },
];

export type BmiExportState = {
  views: readonly BmiRowView[];
  /** The rows after search and filters, in screen order. */
  filtered: readonly BmiRowView[];
  metrics: TrackerMetrics;
  settings: Pick<Settings, "bmiPeriods" | "bmiUnderweightBelow" | "bmiNormalMax" | "bmiOverweightMax">;
  labels: readonly string[];
  period: number;
  currentPeriod: number | null;
  /** "Semua periode" (true) or "Fokus periode" (false). */
  viewAll: boolean;
  query: string;
  status: StatusFilter;
  category: CategoryFilter;
  /** The station filter's label ("Semua stasiun", "SUB"), or null when the screen has none. */
  station: string | null;
  idLabel: string;
  scope: { chip: string; foot: string };
  now: Date;
};

/** "15 Okt 2026 22.31 WIB" in Asia/Jakarta. */
export function exportedLabel(now: Date): string {
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month").replace(".", "")} ${get("year")} ${get("hour")}.${get("minute")} WIB`;
}

/** "JOUMPA_BMI_SUB_2026-10-14.xlsx". The scope is a station code or "KPS"; anything else is made file-safe. */
export function xlsxFilename(scope: string, today: string): string {
  const safe = scope.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "semua";
  return `JOUMPA_BMI_${safe}_${today}.xlsx`;
}

/** The periods the table shows: all of them, or only the chosen one in "Fokus periode". */
export function shownPeriods(state: Pick<BmiExportState, "viewAll" | "period" | "settings">): number[] {
  if (!state.viewAll) return [state.period];
  return Array.from({ length: state.settings.bmiPeriods }, (_, i) => i + 1);
}

function groups(state: BmiExportState): XlsxGroup[] {
  return [
    { title: "Identitas · Master SDM", band: "identity", columns: IDENTITY(state.idLabel) },
    ...shownPeriods(state).map<XlsxGroup>((p) => ({
      title: state.labels[p - 1] ?? bmiCheckName(p),
      band: "period",
      selected: p === state.period,
      columns: PERIOD,
    })),
    { title: "Ringkasan", band: "summary", columns: SUMMARY },
  ];
}

function rows(state: BmiExportState): BmiWorkbookInput["rows"] {
  const periods = shownPeriods(state);
  return state.filtered.map(({ row, summary }, index) => {
    const record: BmiWorkbookInput["rows"][number] = [index + 1, idOf(row), row.name, row.station, row.gender];
    for (const p of periods) {
      const check = row.checks[p - 1] ?? null;
      const value = summary.periods[p - 1] ?? null;
      record.push(check?.date, check?.heightCm, check?.weightKg, value?.bmi, value?.category);
    }
    record.push(
      summary.latestHeight,
      summary.latestWeight,
      summary.weightDelta,
      summary.latestBmi,
      summary.latestCategory,
      summary.heightRequirement,
      summary.nextCheck,
      summary.scheduleStatus,
      row.fitnessNote,
    );
    return record;
  });
}

/** Everything the workbook needs except the logo images. */
export function bmiExportInput(state: BmiExportState): Omit<BmiWorkbookInput, "logos"> {
  const label = (list: ReadonlyArray<{ value: string; label: string }>, value: string) =>
    list.find((f) => f.value === value)?.label ?? value;
  const periodLabel = state.labels[state.period - 1] ?? bmiCheckName(state.period);
  const filters = [
    { label: "Cari", value: state.query.trim() ? `“${state.query.trim()}”` : "–" },
    { label: "Periode", value: state.period === state.currentPeriod ? `${periodLabel} · sekarang` : periodLabel },
    ...(state.station ? [{ label: "Stasiun", value: state.station }] : []),
    { label: "Status jadwal", value: label(STATUS_FILTERS, state.status) },
    { label: "Kategori BMI terakhir", value: label(CATEGORY_FILTERS, state.category) },
    { label: "Tampilan", value: state.viewAll ? "Semua periode" : "Fokus periode" },
  ];
  const m = state.metrics;
  return {
    appName: "JOUMPA People Development Tracker",
    eyebrow: "JOUMPA People Development",
    title: "BMI Monitoring Tracker",
    description: "Kelola pemeriksaan berkala, pantau kategori BMI, dan tindak lanjut kesehatan petugas.",
    sheetName: "Cek BMI",
    sourceTab: BMI_SHEET_TAB,
    scope: state.scope.chip,
    exportedAt: state.now,
    exportedLabel: exportedLabel(state.now),
    metrics: [
      { label: "Total SDM", value: m.total, foot: state.scope.foot },
      { label: "Sudah diperiksa", value: m.checked, foot: `${bmiCheckName(state.period)} · ${m.checkedPct}% selesai`, tone: "good", progress: m.checkedPct },
      { label: "Terlambat cek", value: m.late, foot: "Memerlukan tindak lanjut", tone: "late" },
      { label: "BMI di atas normal", value: m.aboveNormal, foot: "Overweight + Obesitas, nilai terakhir", tone: "above" },
    ],
    filters,
    countLine: `${state.filtered.length} dari ${state.views.length} petugas`,
    groups: groups(state),
    rows: rows(state),
    thresholds: {
      underweightBelow: state.settings.bmiUnderweightBelow,
      normalMax: state.settings.bmiNormalMax,
      overweightMax: state.settings.bmiOverweightMax,
    },
    theme: XLSX_THEME,
  };
}

/** A logo from /public as base64 and its drawn size; null when it cannot be loaded (the sheet goes without). */
async function loadLogo(src: string, height: number): Promise<XlsxLogo | null> {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const width = Math.round((height * bitmap.width) / bitmap.height);
    bitmap.close();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { base64: btoa(binary), width, height };
  } catch {
    return null;
  }
}

/** Builds the .xlsx in the browser and starts the download. */
export async function downloadBmiXlsx(input: Omit<BmiWorkbookInput, "logos">, filename: string): Promise<void> {
  const [{ default: ExcelJS }, { buildBmiWorkbook }, ...logos] = await Promise.all([
    import("exceljs"),
    import("@/lib/xlsx/bmi"),
    ...XLSX_LOGOS.map((l) => loadLogo(l.src, l.height)),
  ]);
  const bytes = await buildBmiWorkbook(ExcelJS, { ...input, logos: logos.filter((l): l is XlsxLogo => l !== null) });
  downloadXlsx(bytes, filename);
}
