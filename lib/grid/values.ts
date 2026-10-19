/*
 * Cell values for the spreadsheet grid (docs/UX.md §2): how each editor kind parses what
 * people type or paste, validates it, and shows it. Pure, client-safe, unit-tested.
 *
 * A cell value is string | number | null. Blank always means null ("kosong").
 *   text, longtext : trimmed string (maxLength)
 *   number         : decimal comma or dot, optional min / max / decimals
 *   score          : whole number 1 to 5 (aspects A to F)
 *   date           : 'YYYY-MM-DD'; accepts 12/10/2026, 12-10-2026, 12.10.2026, 2026-10-12
 *   select         : one of `options` (value or label, case-insensitive)
 *   readonly       : never parsed (computed columns)
 */
import { BULAN_SINGKAT } from "@/lib/dates";

export type CellValue = string | number | null;

export type EditorKind = "text" | "longtext" | "number" | "score" | "date" | "select" | "readonly";

export type SelectOption = { value: string; label?: string };

/** The part of a column definition the value rules need. */
export type ValueRules = {
  editor: EditorKind;
  /** select */
  options?: readonly SelectOption[];
  /** number: inclusive range and decimal places (default 2). */
  min?: number;
  max?: number;
  decimals?: number;
  /** text / longtext */
  maxLength?: number;
  /** Blank not allowed (shows "wajib diisi"). */
  required?: boolean;
};

export type ParseResult = { ok: true; value: CellValue } | { ok: false; message: string };

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

function isoFromParts(y: number, m: number, d: number): string | null {
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 'YYYY-MM-DD' from what people type, or null if it is not a real date. */
export function parseDateInput(text: string): string | null {
  const t = text.trim();
  let m = ISO.exec(t);
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  m = DMY.exec(t);
  if (m) return isoFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** "165,5" → 165.5. Thousands separators are not accepted (an ID number is not a quantity). */
export function parseNumberInput(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "");
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return null;
  return Number(t.replace(",", "."));
}

function formatDecimalComma(value: number, decimals: number): string {
  const fixed = Number.isInteger(value) ? String(value) : value.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
  return fixed.replace(".", ",");
}

/** Parses and validates one typed or pasted text for a column. */
export function parseCell(rules: ValueRules, raw: string): ParseResult {
  const text = raw.replace(/\r/g, "");
  const trimmed = text.trim();
  if (rules.editor === "readonly") return { ok: false, message: "Kolom ini dihitung otomatis." };
  if (trimmed === "") {
    return rules.required ? { ok: false, message: "Wajib diisi." } : { ok: true, value: null };
  }

  switch (rules.editor) {
    case "score": {
      const n = parseNumberInput(trimmed);
      if (n === null || !Number.isInteger(n) || n < 1 || n > 5) {
        return { ok: false, message: "Isi angka bulat 1 sampai 5." };
      }
      return { ok: true, value: n };
    }
    case "number": {
      const n = parseNumberInput(trimmed);
      if (n === null) return { ok: false, message: "Isi angka, desimal pakai koma (contoh 165,5)." };
      const decimals = rules.decimals ?? 2;
      const factor = 10 ** decimals;
      if (Math.round(n * factor) / factor !== n) {
        return {
          ok: false,
          message: decimals === 0 ? "Isi bilangan bulat." : `Paling banyak ${decimals} angka di belakang koma.`,
        };
      }
      if ((rules.min !== undefined && n < rules.min) || (rules.max !== undefined && n > rules.max)) {
        return { ok: false, message: rangeMessage(rules) };
      }
      return { ok: true, value: n };
    }
    case "date": {
      const iso = parseDateInput(trimmed);
      return iso ? { ok: true, value: iso } : { ok: false, message: "Tanggal tidak valid. Tulis seperti 12/10/2026." };
    }
    case "select": {
      const key = trimmed.toLowerCase();
      const match = (rules.options ?? []).find(
        (o) => o.value.toLowerCase() === key || (o.label ?? "").toLowerCase() === key,
      );
      if (!match) {
        const list = (rules.options ?? []).map((o) => o.label ?? o.value).join(", ");
        return { ok: false, message: `Pilih salah satu: ${list}.` };
      }
      return { ok: true, value: match.value };
    }
    case "text":
    case "longtext": {
      const value = rules.editor === "text" ? trimmed.replace(/\s+/g, " ") : trimmed;
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        return { ok: false, message: `Paling panjang ${rules.maxLength} karakter (sekarang ${value.length}).` };
      }
      return { ok: true, value };
    }
  }
}

function rangeMessage(rules: ValueRules): string {
  const d = rules.decimals ?? 2;
  if (rules.min !== undefined && rules.max !== undefined) {
    return `Isi ${formatDecimalComma(rules.min, d)} sampai ${formatDecimalComma(rules.max, d)}.`;
  }
  if (rules.min !== undefined) return `Paling kecil ${formatDecimalComma(rules.min, d)}.`;
  return `Paling besar ${formatDecimalComma(rules.max ?? 0, d)}.`;
}

/** Checks a value that came from the database or another editor against the column rules. */
export function validateValue(rules: ValueRules, value: CellValue): string | null {
  if (rules.editor === "readonly") return null;
  const result = parseCell(rules, valueToText(rules, value));
  return result.ok ? null : result.message;
}

/**
 * The text a value is edited and copied as: decimal comma for numbers, 12/10/2026 for
 * dates, the option value for selects. Round-trips through parseCell.
 */
export function valueToText(rules: Pick<ValueRules, "editor" | "decimals">, value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (rules.editor === "number" || rules.editor === "score") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? formatDecimalComma(n, rules.decimals ?? 2) : String(value);
  }
  if (rules.editor === "date" && typeof value === "string" && ISO.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
  }
  return String(value);
}

/** How a value reads in a cell: "12 Okt 2026" for dates, the option label for selects. */
export function displayValue(rules: ValueRules, value: CellValue): string {
  if (value === null || value === undefined || value === "") return "";
  if (rules.editor === "date" && typeof value === "string") {
    const m = ISO.exec(value);
    if (m) return `${Number(m[3])} ${BULAN_SINGKAT[Number(m[2]) - 1]} ${m[1]}`;
  }
  if (rules.editor === "select") {
    const match = (rules.options ?? []).find((o) => o.value === value);
    return match?.label ?? String(value);
  }
  return valueToText(rules, value);
}

/**
 * Type-ahead in a dropdown: the first option whose value starts with the typed text (an ID
 * such as "DPS-01"), else whose label starts with it (a name), else whose label contains it.
 */
export function matchOption(options: readonly SelectOption[], typed: string): SelectOption | null {
  const q = typed.trim().toLowerCase();
  if (q === "") return null;
  const label = (o: SelectOption) => (o.label ?? o.value).toLowerCase();
  return (
    options.find((o) => o.value.toLowerCase().startsWith(q)) ??
    options.find((o) => label(o).startsWith(q)) ??
    options.find((o) => label(o).includes(q)) ??
    null
  );
}

/** Equal as stored values (numbers compared numerically, blanks equal). */
export function sameValue(a: CellValue | undefined, b: CellValue | undefined): boolean {
  const na = a === undefined || a === "" ? null : a;
  const nb = b === undefined || b === "" ? null : b;
  if (na === null || nb === null) return na === nb;
  if (typeof na === "number" || typeof nb === "number") return Number(na) === Number(nb);
  return na === nb;
}
