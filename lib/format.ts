/**
 * Number display in Indonesian notation (decimal comma, as the printed workbook shows it).
 * Pure, so server and client components share one implementation. An empty value
 * formats as "" (a blank cell, never 0).
 */

type Num = number | null | undefined;

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(min: number, max: number, signed = false): Intl.NumberFormat {
  const key = `${min}:${max}:${signed}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      useGrouping: false,
      signDisplay: signed ? 'exceptZero' : 'auto',
    });
    formatters.set(key, f);
  }
  return f;
}

/** `165.5` → "165,5". `digits` fixes the decimals; `maxDigits` allows up to that many. */
export function formatDecimal(value: Num, digits: number, maxDigits = digits): string {
  return value == null ? '' : formatter(digits, Math.max(digits, maxDigits)).format(value);
}

/** Practice score average, two decimals: "3,83". */
export function formatScore(value: Num): string {
  return formatDecimal(value, 2);
}

/** Score change with its sign: "+0,50", "-0,33", "0,00". */
export function formatSignedScore(value: Num): string {
  return value == null ? '' : formatter(2, 2, true).format(value);
}

/** Weight change in kg with its sign: "+1,2", "-0,5", "0,0". */
export function formatSignedKg(value: Num): string {
  return value == null ? '' : formatter(1, 1, true).format(value);
}

/** Fraction 0..1 as a whole percentage: "40%". */
export function formatRatio(value: Num): string {
  return value == null ? '' : `${formatDecimal(value * 100, 0)}%`;
}

/** action_items.progress (0..100): "12,5%". */
export function formatProgress(value: Num): string {
  return value == null ? '' : `${formatDecimal(value, 0, 1)}%`;
}

/** A stored number as the text an input shows ("165,5"), or "" when empty. */
export function toInputText(value: Num): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(value).replace('.', ',');
}

/** Days until a due date: "lewat 3 hari", "hari ini", "besok", "5 hari lagi". */
export function relativeDays(daysLeft: number): string {
  if (daysLeft < 0) return `lewat ${-daysLeft} hari`;
  if (daysLeft === 0) return 'hari ini';
  if (daysLeft === 1) return 'besok';
  return `${daysLeft} hari lagi`;
}
