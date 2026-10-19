/**
 * Canonical values so the two sides compare equal when they mean the same thing:
 * `"4"`, `4`, `4.0` -> 4; sheet date serial 46307, "12/10/2026", "12 Okt 2026" -> "2026-10-12";
 * "  text \r\n" -> "text"; "" -> null.
 */
import type { Canon, ColumnType } from "./types";

export type NormResult = { ok: true; value: Canon } | { ok: false; message: string };

const ok = (value: Canon): NormResult => ({ ok: true, value });
const bad = (message: string): NormResult => ({ ok: false, message });

const MS_PER_DAY = 86_400_000;
/** Google Sheets / Excel serial day 0. */
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

export function serialToIso(serial: number): string {
  const d = new Date(SERIAL_EPOCH + Math.floor(serial) * MS_PER_DAY);
  return d.toISOString().slice(0, 10);
}

export function isoToSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - SERIAL_EPOCH) / MS_PER_DAY);
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, ags: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, nopember: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};

function isoFrom(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Accepts ISO, D/M/YYYY (Indonesian order), D-M-YYYY, D.M.YYYY, "12 Okt 2026", "12 Oktober 2026". */
export function parseDateText(input: string): string | null {
  const s = input.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return isoFrom(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return isoFrom(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]+([A-Za-z]+)\.?[\s-]+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? isoFrom(+m[3], month, +m[1]) : null;
  }
  return null;
}

/** Round half away from zero to `scale` decimals, without binary float surprises (1.005 -> 1.01). */
export function roundTo(n: number, scale: number): number {
  const f = 10 ** scale;
  const r = Math.round(Math.abs(n) * f + 1e-9) / f;
  const out = n < 0 ? -r : r;
  return Object.is(out, -0) ? 0 : out;
}

function parseNumberText(s: string): number | null {
  const t = s.trim().replace(/\s+/g, "");
  if (/^[-+]?\d+([.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
  if (/^[-+]?\d*\.\d+$/.test(t)) return Number(t);
  return null;
}

function isEmpty(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
}

function isDash(raw: unknown): boolean {
  return typeof raw === "string" && /^[-–—]$/.test(raw.trim());
}

function cleanText(s: string): string {
  return s.replace(/\r\n?/g, "\n").trim();
}

function rangeText(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `${min}–${max}`;
  if (min !== undefined) return `≥ ${min}`;
  if (max !== undefined) return `≤ ${max}`;
  return "";
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") return parseNumberText(raw);
  if (typeof raw === "boolean") return null;
  return null;
}

/**
 * Normalize a value from either side (the database sends ISO dates and JSON numbers; the sheet
 * sends serials, numbers, or whatever was typed).
 */
export function normalize(raw: unknown, type: ColumnType): NormResult {
  if (isEmpty(raw)) return ok(null);
  // The workbook marks "no value" in number and date cells with a dash.
  if ((type.kind === "int" || type.kind === "numeric" || type.kind === "date") && isDash(raw)) return ok(null);

  switch (type.kind) {
    case "text": {
      const s = typeof raw === "string" ? cleanText(raw) : String(raw);
      return ok(s === "" ? null : s);
    }
    case "enum": {
      const s = cleanText(String(raw)).replace(/\s+/g, " ");
      const hit = type.values.find((v) => v.toLowerCase() === s.toLowerCase());
      return hit !== undefined ? ok(hit) : bad(`Pilihan tidak valid. Pilihan: ${type.values.join(", ")}.`);
    }
    case "station": {
      const s = cleanText(String(raw)).toUpperCase();
      if (s === "KPS") return type.kps ? ok(s) : bad("KPS bukan kode stasiun. Isi kode stasiun, misalnya CGK.");
      return /^[A-Z0-9]{2,5}$/.test(s) ? ok(s) : bad("Kode stasiun tidak valid. Isi kode stasiun, misalnya CGK.");
    }
    case "report-group": {
      const s = cleanText(String(raw)).replace(/\s+/g, " ").toUpperCase();
      return s === "" ? ok(null) : ok(s);
    }
    case "area": {
      const s = cleanText(String(raw)).replace(/\s+/g, " ");
      return s === "" ? ok(null) : ok(s);
    }
    case "int": {
      const n = toNumber(raw);
      const range = rangeText(type.min, type.max);
      if (n === null) return bad(`Harus berupa angka bulat${range ? ` ${range}` : ""}.`);
      if (Math.abs(n - Math.round(n)) > 1e-9) return bad(`Harus berupa angka bulat${range ? ` ${range}` : ""}.`);
      const v = Math.round(n);
      if ((type.min !== undefined && v < type.min) || (type.max !== undefined && v > type.max)) {
        return bad(`Di luar rentang ${range}.`);
      }
      return ok(v);
    }
    case "numeric": {
      const n = toNumber(raw);
      const range = rangeText(type.min, type.max);
      if (n === null) return bad(`Harus berupa angka${range ? ` ${range}` : ""}.`);
      const v = roundTo(n, type.scale);
      if ((type.min !== undefined && v < type.min) || (type.max !== undefined && v > type.max)) {
        return bad(`Di luar rentang ${range}.`);
      }
      return ok(v);
    }
    case "date": {
      if (typeof raw === "number") {
        if (!Number.isFinite(raw) || raw < 1 || raw > 120000) return bad("Tanggal tidak valid.");
        return ok(serialToIso(raw));
      }
      if (raw instanceof Date) return ok(raw.toISOString().slice(0, 10));
      const iso = parseDateText(String(raw));
      return iso ? ok(iso) : bad("Tanggal tidak dikenali. Gunakan format 12/10/2026 atau 2026-10-12.");
    }
  }
}

export function eqCanon(a: Canon | undefined, b: Canon | undefined): boolean {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  return x === y;
}
