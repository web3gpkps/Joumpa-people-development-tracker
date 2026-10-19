/*
 * "Ekspor Excel" of the Cek BMI screen: one .xlsx that looks like the screen at the moment of export.
 * Pure apart from ExcelJS, which the caller passes in (the browser loads it on click; tests use the
 * Node build). Covered by components/bmi/xlsx-export.test.ts.
 *
 * Sheet "Cek BMI":
 *   rows 1-3   logos, eyebrow, title, description           (the page banner)
 *   row 4      a thin accent strip in the banner's colours
 *   row 5      scope, export time, source tab
 *   rows 7-9   the four count cards, tone colours as on screen
 *   row 11     the filters in force and "x dari y petugas"
 *   rows 13-14 group header (Identitas / one per check / Ringkasan) and the field header
 *   rows 15..  one row per person in view, frozen like the sticky columns on screen
 * Sheet "Keterangan": category thresholds (named ranges the formulas use), colour legend, export facts.
 *
 * The BMI and Kategori of every check are live formulas (cached results equal the screen), so a
 * corrected height or weight recalculates in Excel; conditional formatting recolours the badges.
 * Everything else holds the values the screen showed.
 */
import type ExcelJSNamespace from "exceljs";

type ExcelJS = typeof ExcelJSNamespace;
type Worksheet = ExcelJSNamespace.Worksheet;
type Cell = ExcelJSNamespace.Cell;
type Fill = ExcelJSNamespace.Fill;
type Borders = Partial<ExcelJSNamespace.Borders>;

export type XlsxKind =
  | "index"
  | "id"
  | "name"
  | "text"
  | "wrap"
  | "date"
  | "cm"
  | "kg"
  | "bmi"
  | "category"
  | "schedule"
  | "height"
  | "delta"
  | "int"
  | "yesno";

export type XlsxColumn = {
  header: string;
  kind: XlsxKind;
  /** Width in Excel characters. */
  width: number;
  /** A yellow input cell on screen (Tgl Cek, Tinggi, Berat): same tint, and validated in Excel. */
  input?: boolean;
  /** Recalculated in Excel from the height and weight of the same group. */
  live?: "bmi" | "category";
  /** Accepted range of an input number (Tinggi 120-210 cm, Berat 30-200 kg). */
  range?: [number, number];
};

export type XlsxGroup = {
  title: string;
  band: "identity" | "period" | "summary";
  /** The check chosen in the period select: the darker band, as on screen. */
  selected?: boolean;
  columns: XlsxColumn[];
};

export type XlsxMetric = {
  label: string;
  value: number;
  foot: string;
  tone?: "good" | "late" | "above";
  /** 0..100: drawn as a bar of blocks under the value, like the thin bar on screen. */
  progress?: number;
};

export type XlsxLogo = { base64: string; width: number; height: number };

export type XlsxTheme = {
  /** Banner base and headings. */
  navy: string;
  /** Primary green. */
  brand: string;
  /** Second banner colour (the gradient's end). */
  heroEnd: string;
};

export type BmiWorkbookInput = {
  appName: string;
  eyebrow: string;
  title: string;
  description: string;
  sheetName: string;
  sourceTab: string;
  scope: string;
  /** "15 Okt 2026 22.31 WIB". */
  exportedLabel: string;
  exportedAt: Date;
  metrics: XlsxMetric[];
  filters: Array<{ label: string; value: string }>;
  countLine: string;
  groups: XlsxGroup[];
  /** One array per person, in the order of the groups' columns. Dates as ISO "YYYY-MM-DD". */
  rows: Array<Array<string | number | null | undefined>>;
  thresholds: { underweightBelow: number; normalMax: number; overweightMax: number };
  logos: XlsxLogo[];
  theme: XlsxTheme;
};

// ---------------------------------------------------------------------------------------- palette
// The tracker palette of app/globals.css (.bmi-tracker), as ARGB.

const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;

const C = {
  white: "#FFFFFF",
  text: "#32485A",
  muted: "#62707F",
  line: "#E4EBEE",
  lineCell: "#DDE6EA",
  zebra: "#FBFCFD",
  headGroup: "#E6EEF1",
  headGroupText: "#3B5867",
  headField: "#F1F5F7",
  headFieldText: "#526776",
  periodGroup: "#E6F4EF",
  periodGroupSelected: "#D5EDE3",
  periodField: "#EFF7F3",
  periodFieldSelected: "#DDF0E6",
  periodText: "#146E5B",
  periodSelectedText: "#075F4D",
  summaryGroup: "#E7EDF7",
  summaryText: "#405B7A",
  input: "#FFF9E9",
  computed: "#F2F8F6",
  id: "#0D7280",
  name: "#23465B",
  noteBg: "#F5F8F9",
  good: "#0B8268",
  late: "#BB5252",
  above: "#9E691E",
  lime: "#A9DA8B",
} as const;

/** Badge colours: text on its tint, exactly the screen's. */
const BADGE: Record<string, { fg: string; bg: string }> = {
  Normal: { fg: "#087D5F", bg: "#E3F7EE" },
  Overweight: { fg: "#995D0C", bg: "#FFF0CD" },
  Obesitas: { fg: "#AC443D", bg: "#FEE6E3" },
  Kurus: { fg: "#576A9B", bg: "#E9EFFF" },
  "Terlambat cek": { fg: "#B44444", bg: "#FFEBE9" },
  "Cek ≤ 7 hari": { fg: "#95620F", bg: "#FFF0CF" },
  Terjadwal: { fg: "#177A62", bg: "#E5F5EC" },
  Memenuhi: { fg: "#087D5F", bg: "#E3F7EE" },
  "Tidak Memenuhi": { fg: "#AC443D", bg: "#FEE6E3" },
  "Isi standar di Parameter": { fg: "#5D6E78", bg: "#EEF2F5" },
  Ya: { fg: "#087D5F", bg: "#E3F7EE" },
  Tidak: { fg: "#5D6E78", bg: "#EEF2F5" },
};

const BADGE_KINDS: Partial<Record<XlsxKind, string[]>> = {
  category: ["Normal", "Kurus", "Overweight", "Obesitas"],
  schedule: ["Terlambat cek", "Cek ≤ 7 hari", "Terjadwal"],
  height: ["Memenuhi", "Tidak Memenuhi", "Isi standar di Parameter"],
  yesno: ["Ya", "Tidak"],
};

const TONE: Record<NonNullable<XlsxMetric["tone"]>, string> = { good: C.good, late: C.late, above: C.above };

const FONT = "Calibri";

// Indonesian month names whatever the reader's Excel language is.
const DATE_FMT = "[$-421]d mmm yyyy";
const NUM_FMT: Partial<Record<XlsxKind, string>> = {
  index: "0",
  int: "0",
  cm: "0.0",
  kg: "0.0",
  bmi: "0.0",
  delta: '+0.0;-0.0;0.0',
  date: DATE_FMT,
};

// ---------------------------------------------------------------------------------------- layout

const ROW = {
  eyebrow: 1,
  title: 2,
  description: 3,
  strip: 4,
  meta: 5,
  cardLabel: 7,
  cardValue: 8,
  cardFoot: 9,
  filters: 11,
  group: 13,
  field: 14,
  firstData: 15,
} as const;

/** Columns left of the title: the logos sit there. */
const LOGO_COLUMNS = 3;
/** Frozen like the sticky No, ID and Nama columns on screen. */
const FROZEN_COLUMNS = 3;

export const THRESHOLD_NAMES = {
  underweightBelow: "BMI_KURUS_DI_BAWAH",
  normalMax: "BMI_NORMAL_MAKS",
  overweightMax: "BMI_OVERWEIGHT_MAKS",
} as const;

const solid = (hex: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } });
const thin = (hex: string) => ({ style: "thin" as const, color: { argb: argb(hex) } });
const box = (hex: string): Borders => ({ top: thin(hex), left: thin(hex), bottom: thin(hex), right: thin(hex) });

/** Excel column letters: 1 is A, 27 is AA. */
export function colLetter(n: number): string {
  let out = "";
  for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) out = String.fromCharCode(65 + ((rest - 1) % 26)) + out;
  return out;
}

/** "2026-10-12" as a date Excel shows as that same day (stored at UTC midnight). */
export function excelDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

/** "▰▰▰▱▱▱▱▱▱▱": a ten-block bar for a 0..100 value. */
export function blockBar(percent: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

/** A worksheet name Excel accepts: no []:*?/\, at most 31 characters. */
export function safeSheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || "Data";
}

function setText(cell: Cell, value: string, font: Partial<ExcelJSNamespace.Font>, alignment?: Partial<ExcelJSNamespace.Alignment>) {
  cell.value = value;
  cell.font = { name: FONT, ...font };
  if (alignment) cell.alignment = alignment;
}

// ---------------------------------------------------------------------------------------- builder

/** Builds the file and returns the .xlsx bytes. */
export async function buildBmiWorkbook(excel: ExcelJS, input: BmiWorkbookInput): Promise<ArrayBuffer> {
  const wb = new excel.Workbook();
  wb.creator = input.appName;
  wb.lastModifiedBy = input.appName;
  wb.title = `${input.title} · ${input.scope}`;
  wb.subject = input.sourceTab;
  wb.company = input.appName;
  wb.created = input.exportedAt;
  wb.modified = input.exportedAt;
  // Excel recalculates the live BMI/Kategori formulas when the file opens.
  wb.calcProperties.fullCalcOnLoad = true;

  const columns = input.groups.flatMap((g) => g.columns.map((c) => ({ ...c, group: g })));
  const lastCol = Math.max(columns.length, LOGO_COLUMNS + 4);
  const lastDataRow = ROW.firstData + Math.max(input.rows.length, 1) - 1;

  const ws = wb.addWorksheet(safeSheetName(input.sheetName), {
    properties: { tabColor: { argb: argb(input.theme.brand) }, defaultRowHeight: 18 },
    views: [{ state: "frozen", xSplit: FROZEN_COLUMNS, ySplit: ROW.field, showGridLines: false, zoomScale: 100 }],
    pageSetup: {
      paperSize: 9, // A4, fitted to the page width
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 },
      printTitlesRow: `${ROW.group}:${ROW.field}`,
    },
    headerFooter: {
      oddFooter: `&L&8&K${C.muted.slice(1)}${input.appName} · ${input.scope}&C&8&K${C.muted.slice(1)}Diekspor ${input.exportedLabel}&R&8&K${C.muted.slice(1)}Halaman &P dari &N`,
    },
  });

  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });
  for (let c = columns.length + 1; c <= lastCol; c++) ws.getColumn(c).width = 12;

  drawBanner(wb, ws, input, lastCol);
  drawCards(ws, input, columns.map((c) => c.width), lastCol);
  drawFilters(ws, input, lastCol);
  drawHeader(ws, input.groups);
  drawRows(ws, input, columns);
  drawConditionalFormats(ws, columns, lastDataRow);

  ws.autoFilter = { from: { row: ROW.field, column: 1 }, to: { row: ROW.field, column: columns.length } };

  // Closing line under the table.
  const end = ws.getRow(lastDataRow + 2);
  setText(
    end.getCell(1),
    `${input.rows.length} petugas · kolom BMI dan Kategori tiap cek dihitung ulang otomatis bila Tinggi atau Berat diubah; ringkasan berisi nilai saat ekspor.`,
    { size: 9, italic: true, color: { argb: argb(C.muted) } },
  );

  addLegendSheet(wb, input);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function drawBanner(wb: ExcelJSNamespace.Workbook, ws: Worksheet, input: BmiWorkbookInput, lastCol: number) {
  ws.getRow(ROW.eyebrow).height = 20;
  ws.getRow(ROW.title).height = 32;
  ws.getRow(ROW.description).height = 20;
  ws.getRow(ROW.strip).height = 6;
  ws.getRow(ROW.meta).height = 22;
  ws.getRow(6).height = 8;

  const first = LOGO_COLUMNS + 1;
  ws.mergeCells(ROW.eyebrow, first, ROW.eyebrow, lastCol);
  ws.mergeCells(ROW.title, first, ROW.title, lastCol);
  ws.mergeCells(ROW.description, first, ROW.description, lastCol);
  setText(ws.getCell(ROW.eyebrow, first), input.eyebrow.toUpperCase(), { size: 9, bold: true, color: { argb: argb(input.theme.brand) } }, { vertical: "bottom" });
  setText(ws.getCell(ROW.title, first), input.title, { size: 22, bold: true, color: { argb: argb(input.theme.navy) } }, { vertical: "middle" });
  setText(ws.getCell(ROW.description, first), input.description, { size: 10, color: { argb: argb(C.muted) } }, { vertical: "top" });

  // The banner's gradient, as a thin strip across the sheet.
  for (let c = 1; c <= lastCol; c++) {
    ws.getCell(ROW.strip, c).fill = {
      type: "gradient",
      gradient: "angle",
      degree: 0,
      stops: [
        { position: 0, color: { argb: argb(input.theme.navy) } },
        { position: 1, color: { argb: argb(input.theme.heroEnd) } },
      ],
    };
  }

  // Scope chip + export facts.
  ws.mergeCells(ROW.meta, 1, ROW.meta, LOGO_COLUMNS);
  const chip = ws.getCell(ROW.meta, 1);
  setText(chip, `●  ${input.scope}`, { size: 10, bold: true, color: { argb: argb(C.white) } }, { vertical: "middle", horizontal: "center" });
  chip.fill = solid(input.theme.navy);
  ws.mergeCells(ROW.meta, first, ROW.meta, lastCol);
  setText(
    ws.getCell(ROW.meta, first),
    `Diekspor ${input.exportedLabel}   ·   Struktur mengikuti tab ${input.sourceTab}   ·   ${input.appName}`,
    { size: 9, color: { argb: argb(C.muted) } },
    { vertical: "middle", indent: 1 },
  );

  // Logos: side by side in the top-left block, never stretched (each keeps its own ratio), centred on rows 1-3.
  const colPx = (c: number) => Math.round((ws.getColumn(c).width ?? 9) * 7 + 5);
  const rowPx = (r: number) => Math.round(((ws.getRow(r).height ?? 15) * 4) / 3);
  const bannerPx = rowPx(ROW.eyebrow) + rowPx(ROW.title) + rowPx(ROW.description);
  let left = 8;
  for (const logo of input.logos) {
    const id = wb.addImage({ base64: logo.base64, extension: "png" });
    ws.addImage(id, {
      tl: anchorAt(left, Math.max(0, (bannerPx - logo.height) / 2), colPx, rowPx),
      ext: { width: logo.width, height: logo.height },
      editAs: "oneCell",
    });
    left += logo.width + 16;
  }
}

/** A pixel position as an ExcelJS anchor: the column/row it falls in plus the offset inside it. */
function anchorAt(x: number, y: number, colPx: (c: number) => number, rowPx: (r: number) => number) {
  let col = 0;
  let restX = x;
  while (restX >= colPx(col + 1)) restX -= colPx(++col);
  let row = 0;
  let restY = y;
  while (restY >= rowPx(row + 1)) restY -= rowPx(++row);
  // Native offsets in EMU (9525 per pixel): ExcelJS turns a fractional col/row into an offset using a default
  // column width, which would push the second logo onto the first.
  return { nativeCol: col, nativeColOff: Math.round(restX * 9525), nativeRow: row, nativeRowOff: Math.round(restY * 9525) } as unknown as ExcelJSNamespace.Anchor;
}

/** Splits the first columns into four roughly equal cards (by width), leaving a one-column gap between them. */
function cardSpans(widths: number[], lastCol: number, count: number): Array<[number, number]> {
  const all = [...widths];
  while (all.length < lastCol) all.push(12);
  const total = all.reduce((a, b) => a + b, 0);
  const target = Math.min(48, Math.max(26, total / count - 2));
  const spans: Array<[number, number]> = [];
  let col = 1;
  for (let i = 0; i < count && col <= all.length; i++) {
    let width = 0;
    const start = col;
    while (col <= all.length && (width < target || col === start)) width += all[col++ - 1];
    spans.push([start, col - 1]);
    col += 1; // gap
  }
  return spans;
}

function drawCards(ws: Worksheet, input: BmiWorkbookInput, widths: number[], lastCol: number) {
  ws.getRow(ROW.cardLabel).height = 20;
  ws.getRow(ROW.cardValue).height = 34;
  ws.getRow(ROW.cardFoot).height = 20;
  ws.getRow(10).height = 10;

  const spans = cardSpans(widths, lastCol, input.metrics.length);
  input.metrics.forEach((m, i) => {
    const span = spans[i];
    if (!span) return;
    const [a, b] = span;
    const tone = m.tone ? TONE[m.tone] : input.theme.navy;
    for (const r of [ROW.cardLabel, ROW.cardValue, ROW.cardFoot]) {
      ws.mergeCells(r, a, r, b);
      const cell = ws.getCell(r, a);
      cell.fill = solid(C.white);
      cell.border = {
        left: { style: "thick", color: { argb: argb(tone) } },
        right: thin(C.line),
        top: r === ROW.cardLabel ? thin(C.line) : undefined,
        bottom: r === ROW.cardFoot ? thin(C.line) : undefined,
      };
    }
    setText(ws.getCell(ROW.cardLabel, a), m.label, { size: 9, bold: true, color: { argb: argb(C.muted) } }, { vertical: "bottom", indent: 1 });
    const value = ws.getCell(ROW.cardValue, a);
    value.value = m.value;
    value.numFmt = "#,##0";
    value.font = { name: FONT, size: 22, bold: true, color: { argb: argb(tone) } };
    value.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    const foot = m.progress === undefined ? m.foot : `${blockBar(m.progress)}  ${m.foot}`;
    setText(ws.getCell(ROW.cardFoot, a), foot, { size: 9, color: { argb: argb(C.muted) } }, { vertical: "top", indent: 1 });
  });
}

function drawFilters(ws: Worksheet, input: BmiWorkbookInput, lastCol: number) {
  ws.getRow(ROW.filters).height = 24;
  ws.getRow(12).height = 10;
  const countCols = Math.min(3, lastCol - 1);
  const split = lastCol - countCols;
  ws.mergeCells(ROW.filters, 1, ROW.filters, split);
  ws.mergeCells(ROW.filters, split + 1, ROW.filters, lastCol);

  const filters = ws.getCell(ROW.filters, 1);
  filters.value = {
    richText: [
      { text: "Filter  ", font: { name: FONT, size: 9, bold: true, color: { argb: argb(C.muted) } } },
      ...input.filters.flatMap((f, i) => [
        { text: `${i ? "   ·   " : ""}${f.label}: `, font: { name: FONT, size: 9, color: { argb: argb(C.muted) } } },
        { text: f.value, font: { name: FONT, size: 9, bold: true, color: { argb: argb(C.text) } } },
      ]),
    ],
  };
  filters.alignment = { vertical: "middle", indent: 1 };
  filters.fill = solid(C.noteBg);
  filters.border = box(C.line);

  const count = ws.getCell(ROW.filters, split + 1);
  setText(count, input.countLine, { size: 10, bold: true, color: { argb: argb(input.theme.navy) } }, { vertical: "middle", horizontal: "right", indent: 1 });
  count.fill = solid(C.noteBg);
  count.border = box(C.line);
}

function bandColours(group: XlsxGroup, level: "group" | "field") {
  if (group.band === "period") {
    if (level === "group") return { bg: group.selected ? C.periodGroupSelected : C.periodGroup, fg: group.selected ? C.periodSelectedText : C.periodText };
    return { bg: group.selected ? C.periodFieldSelected : C.periodField, fg: group.selected ? C.periodSelectedText : C.periodText };
  }
  if (group.band === "summary") return { bg: level === "group" ? C.summaryGroup : C.headField, fg: C.summaryText };
  return { bg: level === "group" ? C.headGroup : C.headField, fg: level === "group" ? C.headGroupText : C.headFieldText };
}

function drawHeader(ws: Worksheet, groups: XlsxGroup[]) {
  ws.getRow(ROW.group).height = 30;
  ws.getRow(ROW.field).height = 32;
  let col = 1;
  for (const g of groups) {
    const start = col;
    const end = col + g.columns.length - 1;
    if (end > start) ws.mergeCells(ROW.group, start, ROW.group, end);
    const head = bandColours(g, "group");
    const cell = ws.getCell(ROW.group, start);
    setText(cell, g.selected ? `◆  ${g.title}` : g.title, { size: 10, bold: true, color: { argb: argb(head.fg) } }, {
      vertical: "middle",
      horizontal: g.band === "identity" ? "left" : "center",
      indent: g.band === "identity" ? 1 : 0,
      wrapText: true,
    });
    for (let c = start; c <= end; c++) {
      const groupCell = ws.getCell(ROW.group, c);
      groupCell.fill = solid(head.bg);
      groupCell.border = { ...box(C.lineCell), bottom: { style: "thin", color: { argb: argb(C.white) } } };
    }
    const field = bandColours(g, "field");
    g.columns.forEach((column, i) => {
      const fc = ws.getCell(ROW.field, start + i);
      setText(fc, column.header, { size: 9, bold: true, color: { argb: argb(field.fg) } }, {
        vertical: "middle",
        horizontal: column.kind === "name" || column.kind === "wrap" || column.kind === "text" || column.kind === "id" ? "left" : "center",
        wrapText: true,
        indent: column.kind === "name" || column.kind === "wrap" || column.kind === "text" || column.kind === "id" ? 1 : 0,
      });
      fc.fill = solid(field.bg);
      fc.border = { ...box(C.lineCell), bottom: { style: "medium", color: { argb: argb(g.band === "period" ? C.periodText : C.headGroupText) } } };
    });
    col = end + 1;
  }
}

type FlatColumn = XlsxColumn & { group: XlsxGroup };

/** The height and weight columns of a period group, as column numbers (1-based). */
function measureColumns(columns: FlatColumn[], index: number): { height: number; weight: number; bmi: number } | null {
  const group = columns[index].group;
  let height = -1;
  let weight = -1;
  let bmi = -1;
  columns.forEach((c, i) => {
    if (c.group !== group) return;
    if (c.kind === "cm") height = i + 1;
    if (c.kind === "kg") weight = i + 1;
    if (c.live === "bmi") bmi = i + 1;
  });
  return height > 0 && weight > 0 ? { height, weight, bmi } : null;
}

export function bmiFormula(heightRef: string, weightRef: string): string {
  return `IF(OR(${heightRef}="",${weightRef}=""),"",ROUND(${weightRef}/(${heightRef}/100)^2,1))`;
}

export function categoryFormula(bmiRef: string): string {
  const n = THRESHOLD_NAMES;
  return `IF(${bmiRef}="","",IF(${bmiRef}<${n.underweightBelow},"Kurus",IF(${bmiRef}<=${n.normalMax},"Normal",IF(${bmiRef}<=${n.overweightMax},"Overweight","Obesitas"))))`;
}

/**
 * Excel does not grow a row for wrapped text written by a library, so the height is estimated from the
 * longest wrapped value: about 1.15 characters per width unit at 10pt, 13pt per line.
 */
export function rowHeight(values: ReadonlyArray<unknown>, columns: ReadonlyArray<Pick<XlsxColumn, "kind" | "width">>): number {
  let lines = 1;
  columns.forEach((column, i) => {
    const value = values[i];
    if (column.kind !== "wrap" || typeof value !== "string" || !value) return;
    const perLine = Math.max(8, Math.floor((column.width - 2) * 1.15));
    const needed = value.split("\n").reduce((n, part) => n + Math.max(1, Math.ceil(part.length / perLine)), 0);
    lines = Math.max(lines, needed);
  });
  return Math.min(120, Math.max(20, lines * 13 + 7));
}

function drawRows(ws: Worksheet, input: BmiWorkbookInput, columns: FlatColumn[]) {
  input.rows.forEach((values, r) => {
    const rowNumber = ROW.firstData + r;
    const row = ws.getRow(rowNumber);
    row.height = rowHeight(values, columns);
    const zebra = r % 2 === 1;
    columns.forEach((column, i) => {
      const cell = row.getCell(i + 1);
      const raw = values[i];
      const empty = raw === null || raw === undefined || raw === "";
      const measure = column.live ? measureColumns(columns, i) : null;

      if (column.live === "bmi" && measure) {
        const f = bmiFormula(`${colLetter(measure.height)}${rowNumber}`, `${colLetter(measure.weight)}${rowNumber}`);
        cell.value = { formula: f, result: empty ? "" : Number(raw) } as ExcelJSNamespace.CellFormulaValue;
      } else if (column.live === "category" && measure && measure.bmi > 0) {
        cell.value = { formula: categoryFormula(`${colLetter(measure.bmi)}${rowNumber}`), result: empty ? "" : String(raw) } as ExcelJSNamespace.CellFormulaValue;
      } else if (empty) {
        cell.value = null;
      } else if (column.kind === "date") {
        cell.value = excelDate(String(raw)) ?? String(raw);
      } else if (typeof raw === "number") {
        cell.value = raw;
      } else {
        cell.value = String(raw);
      }

      const fmt = NUM_FMT[column.kind];
      if (fmt) cell.numFmt = fmt;

      const badge = typeof raw === "string" ? BADGE[raw] : undefined;
      const isBadge = Boolean(BADGE_KINDS[column.kind]);
      const base = column.input ? C.input : column.live || column.group.band === "summary" ? (zebra ? "#EDF5F2" : C.computed) : zebra ? C.zebra : C.white;
      cell.fill = solid(isBadge && badge ? badge.bg : base);
      cell.border = { bottom: thin(C.lineCell), right: thin(C.lineCell), left: i === 0 ? thin(C.lineCell) : undefined };

      const color =
        isBadge && badge
          ? badge.fg
          : column.kind === "id"
            ? C.id
            : column.kind === "name"
              ? C.name
              : column.kind === "delta" && typeof raw === "number" && raw !== 0
                ? raw > 0
                  ? C.late
                  : C.good
                : C.text;
      cell.font = { name: FONT, size: 10, bold: column.kind === "name" || (isBadge && Boolean(badge)), color: { argb: argb(color) } };
      const left = column.kind === "name" || column.kind === "text" || column.kind === "wrap" || column.kind === "id";
      cell.alignment = { vertical: "middle", horizontal: left ? "left" : "center", indent: left ? 1 : 0, wrapText: column.kind === "wrap" };

      if (column.input && column.range) {
        cell.dataValidation = {
          type: "decimal",
          operator: "between",
          allowBlank: true,
          showErrorMessage: true,
          errorStyle: "stop",
          errorTitle: column.header,
          error: `Isi angka ${column.range[0]}–${column.range[1]}.`,
          formulae: [column.range[0], column.range[1]],
        };
      } else if (column.input && column.kind === "date") {
        cell.dataValidation = {
          type: "date",
          operator: "greaterThan",
          allowBlank: true,
          showErrorMessage: true,
          errorTitle: column.header,
          error: "Isi tanggal yang valid.",
          formulae: [new Date(Date.UTC(2000, 0, 1))],
        };
      }
    });
  });
}

/** Badge colours follow the value, so a recalculated Kategori recolours itself. */
function drawConditionalFormats(ws: Worksheet, columns: FlatColumn[], lastDataRow: number) {
  let priority = 1;
  columns.forEach((column, i) => {
    const values = BADGE_KINDS[column.kind];
    if (!values) return;
    const ref = `${colLetter(i + 1)}${ROW.firstData}:${colLetter(i + 1)}${lastDataRow}`;
    ws.addConditionalFormatting({
      ref,
      rules: values.map((v) => ({
        type: "cellIs" as const,
        operator: "equal" as const,
        formulae: [`"${v}"`],
        priority: priority++,
        style: {
          font: { color: { argb: argb(BADGE[v].fg) }, bold: true },
          fill: { type: "pattern" as const, pattern: "solid" as const, bgColor: { argb: argb(BADGE[v].bg) } },
        },
      })),
    });
  });
}

function addLegendSheet(wb: ExcelJSNamespace.Workbook, input: BmiWorkbookInput) {
  const ws = wb.addWorksheet("Keterangan", {
    properties: { tabColor: { argb: argb(C.summaryText) } },
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 60;

  let r = 2;
  setText(ws.getCell(r, 2), "Keterangan", { size: 18, bold: true, color: { argb: argb(input.theme.navy) } });
  r += 1;
  setText(ws.getCell(r, 2), `${input.title} · ${input.scope} · diekspor ${input.exportedLabel}`, { size: 9, color: { argb: argb(C.muted) } });
  r += 2;

  const section = (title: string) => {
    ws.mergeCells(r, 2, r, 4);
    const cell = ws.getCell(r, 2);
    setText(cell, title, { size: 11, bold: true, color: { argb: argb(C.white) } }, { vertical: "middle", indent: 1 });
    cell.fill = solid(input.theme.navy);
    ws.getRow(r).height = 22;
    r += 1;
  };
  const line = (label: string, value: string | number, note = "", badge?: string, numFmt?: string) => {
    const a = ws.getCell(r, 2);
    const b = ws.getCell(r, 3);
    const c = ws.getCell(r, 4);
    setText(a, label, { size: 10, color: { argb: argb(C.text) } }, { vertical: "middle", indent: 1 });
    b.value = value;
    b.font = { name: FONT, size: 10, bold: true, color: { argb: argb(badge ? BADGE[badge].fg : C.text) } };
    b.alignment = { vertical: "middle", horizontal: "center" };
    if (numFmt) b.numFmt = numFmt;
    if (badge) b.fill = solid(BADGE[badge].bg);
    setText(c, note, { size: 9, color: { argb: argb(C.muted) } }, { vertical: "middle", wrapText: true, indent: 1 });
    for (const cell of [a, b, c]) cell.border = { bottom: thin(C.line) };
    ws.getRow(r).height = 20;
    r += 1;
    return b;
  };

  const t = input.thresholds;
  section("Batas kategori BMI (Parameter)");
  const kurus = line("Kurus jika BMI di bawah", t.underweightBelow, `Dipakai rumus Kategori di tab ${input.sheetName}`, "Kurus", "0.0");
  const normal = line("Normal sampai dengan", t.normalMax, "", "Normal", "0.0");
  const over = line("Overweight sampai dengan", t.overweightMax, "Di atasnya: Obesitas", "Overweight", "0.0");
  line("Obesitas", `> ${t.overweightMax}`, "", "Obesitas");
  wb.definedNames.add(`'Keterangan'!$C$${kurus.row}`, THRESHOLD_NAMES.underweightBelow);
  wb.definedNames.add(`'Keterangan'!$C$${normal.row}`, THRESHOLD_NAMES.normalMax);
  wb.definedNames.add(`'Keterangan'!$C$${over.row}`, THRESHOLD_NAMES.overweightMax);
  line("Rumus BMI", "Berat ÷ (Tinggi/100)²", "Dibulatkan 1 desimal, sama seperti di aplikasi");
  r += 1;

  section("Status jadwal");
  line("Terlambat cek", "Terlambat cek", "Cek berikutnya sudah lewat", "Terlambat cek");
  line("Cek dalam 7 hari", "Cek ≤ 7 hari", "Cek berikutnya dalam 7 hari", "Cek ≤ 7 hari");
  line("Terjadwal", "Terjadwal", "Cek berikutnya lebih dari 7 hari lagi", "Terjadwal");
  r += 1;

  section("Warna sel");
  const input1 = line("Isian (kuning)", "Tgl · Tinggi · Berat", "Diisi petugas; di Excel dibatasi ke angka yang wajar");
  input1.fill = solid(C.input);
  const computed = line("Hasil perhitungan (hijau muda)", "BMI · Kategori", "Dihitung otomatis dari isian");
  computed.fill = solid(C.computed);
  const ident = line("Identitas", "No · ID · Nama", "Dari Master SDM");
  ident.fill = solid(C.headGroup);
  r += 1;

  section("Isi ekspor ini");
  line("Lingkup", input.scope);
  for (const f of input.filters) line(f.label, f.value);
  line("Jumlah baris", input.countLine);
  line("Sumber", `Tab ${input.sourceTab}`, input.appName);
}
