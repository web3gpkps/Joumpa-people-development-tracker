/*
 * Building and checking the p_patch of pd_share_save_staff for Tracker Staf. Pure and
 * client-safe: the grid and the dialog build patches with it, the Server Action checks every
 * patch with it again before the database call (which checks once more).
 */
import { FINAL_DECISIONS, COACHING_STATUSES, PROPOSALS, STATUSES } from "@/lib/pd-rules";
import { parseCell, parseDateInput, parseNumberInput, sameValue, type CellValue } from "@/lib/grid/values";
import { FIELD_RULES, GENDERS, PATCH_KEYS, type PatchKey, type TrackerRow } from "./fields";

export type Patch = Partial<Record<PatchKey, string | number | null>>;

export type PatchCheck = { ok: true; patch: Patch } | { ok: false; field: PatchKey | "patch"; message: string };

const TEXT_MAX: Partial<Record<PatchKey, number>> = {
  station: 5,
  name: 200,
  nipp: 50,
  bmi_note: 2000,
  initial_coaching: 100,
  coaching_items: 500,
  pic: 500,
  main_action: 4000,
  extra_action: 4000,
  progress_notes: 4000,
};

const ENUMS: Partial<Record<PatchKey, readonly string[]>> = {
  gender: GENDERS,
  proposal: PROPOSALS,
  main_status: STATUSES,
  extra_status: STATUSES,
  recoaching: COACHING_STATUSES,
  final_decision: FINAL_DECISIONS,
};

const NUMBERS: ReadonlySet<PatchKey> = new Set(["initial_practice", "reassess_practice"]);
const DATES: ReadonlySet<PatchKey> = new Set(["main_due", "extra_due", "reassessed_on"]);

/** Row property of each patch key (snake_case → camelCase). */
export const PROP_OF: Record<PatchKey, keyof TrackerRow | null> = {
  station: "station",
  name: "name",
  nipp: "nipp",
  gender: "gender",
  bmi_note: null,
  proposal: "proposal",
  initial_coaching: "initialCoaching",
  coaching_items: "coachingItems",
  initial_practice: "initialPractice",
  main_action: "mainAction",
  main_due: "mainDue",
  pic: "pic",
  main_status: "mainStatus",
  extra_action: "extraAction",
  extra_due: "extraDue",
  extra_status: "extraStatus",
  reassessed_on: "reassessedOn",
  reassess_practice: "reassessPractice",
  recoaching: "recoaching",
  final_decision: "finalDecision",
  progress_notes: "progressNotes",
};

/**
 * A practice score as people type it: "4,17", "4.17", 4.17 → 4.17; blank → null; anything
 * else (or outside 1 to 5, or more than 2 decimals) → NaN.
 */
export function parsePractice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : raw.trim() === "" ? null : parseNumberInput(raw);
  if (n === null && typeof raw === "string") return raw.trim() === "" ? null : Number.NaN;
  if (n === null || !Number.isFinite(n) || n < 1 || n > 5 || Math.round(n * 100) / 100 !== n) return Number.NaN;
  return n;
}

function isPatchKey(key: string): key is PatchKey {
  return (PATCH_KEYS as readonly string[]).includes(key);
}

const fail = (field: PatchKey | "patch", message: string): PatchCheck => ({ ok: false, field, message });

/**
 * Checks and normalises a patch from the client: known keys only, trimmed text ("" → null),
 * practice scores 1 to 5 with at most two decimals (decimal comma accepted), dates
 * 'YYYY-MM-DD' (12/10/2026 accepted), option values from lib/pd-rules. A new staff member
 * (`isNew`) needs a station and a name.
 */
export function checkPatch(input: unknown, { isNew = false }: { isNew?: boolean } = {}): PatchCheck {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("patch", "Data tidak terbaca. Muat ulang halaman.");
  const patch: Patch = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!isPatchKey(key)) return fail("patch", "Ada isian yang tidak dikenal. Muat ulang halaman.");
    if (raw !== null && typeof raw !== "string" && typeof raw !== "number") return fail(key, "Isian tidak terbaca.");

    if (NUMBERS.has(key)) {
      const n = parsePractice(raw);
      if (Number.isNaN(n)) return fail(key, "Isi angka 1 sampai 5, paling banyak 2 angka di belakang koma (contoh 4,17).");
      patch[key] = n;
      continue;
    }

    const text = raw === null ? "" : String(raw).trim();
    if (text === "") {
      patch[key] = null;
      continue;
    }
    if (DATES.has(key)) {
      const iso = parseDateInput(text);
      if (!iso) return fail(key, "Tanggal tidak valid. Tulis seperti 13/11/2026.");
      patch[key] = iso;
      continue;
    }
    const allowed = ENUMS[key];
    if (allowed) {
      const match = allowed.find((v) => v.toLowerCase() === text.toLowerCase());
      if (!match) return fail(key, `Pilih salah satu: ${allowed.join(", ")}.`);
      patch[key] = match;
      continue;
    }
    const value = key === "station" ? text.toUpperCase() : key === "main_action" || key === "extra_action" || key === "progress_notes" ? text : text.replace(/\s+/g, " ");
    const max = TEXT_MAX[key] ?? 4000;
    if (value.length > max) return fail(key, `Paling panjang ${max} karakter.`);
    patch[key] = value;
  }

  if (isNew) {
    if (!patch.station) return fail("station", "Pilih stasiun untuk staf baru.");
    if (!patch.name) return fail("name", "Nama wajib diisi.");
  } else if ("name" in patch && !patch.name) {
    return fail("name", "Nama wajib diisi.");
  } else if ("station" in patch && !patch.station) {
    return fail("station", "Stasiun wajib diisi.");
  }
  if (Object.keys(patch).length === 0) return fail("patch", "Tidak ada perubahan untuk disimpan.");
  return { ok: true, patch };
}

/** The grid's changed cells (keyed by patch key) as a patch; computed or unknown keys are dropped. */
export function changesToPatch(changes: Record<string, CellValue>): Patch {
  const patch: Patch = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!isPatchKey(key)) continue;
    patch[key] = typeof value === "string" && value.trim() === "" ? null : value;
  }
  return patch;
}

/** The editable fields of the detail dialog, as text (what the inputs hold). */
export type Draft = Partial<Record<PatchKey, string>>;

const DIALOG_KEYS = PATCH_KEYS.filter((k) => k !== "bmi_note");

/** Input text of a stored value: "4,17" for scores, 'YYYY-MM-DD' for date inputs, "" for blank. */
export function draftText(key: PatchKey, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (NUMBERS.has(key)) return String(value).replace(".", ",");
  return String(value);
}

/** The dialog's starting draft for a row. */
export function draftOf(row: TrackerRow): Draft {
  const draft: Draft = {};
  for (const key of DIALOG_KEYS) {
    const prop = PROP_OF[key];
    draft[key] = prop ? draftText(key, row[prop] as string | number | null) : "";
  }
  return draft;
}

export type DraftDiff = { patch: Patch; errors: Partial<Record<PatchKey, string>> };

/**
 * What the dialog sends: each field parsed with the grid's own rules (decimal comma, dates,
 * options), then only the fields whose value differs from the row. Invalid fields are reported
 * and left out of the patch.
 */
export function diffDraft(row: TrackerRow, draft: Draft, stations: readonly string[]): DraftDiff {
  const patch: Patch = {};
  const errors: DraftDiff["errors"] = {};
  for (const key of DIALOG_KEYS) {
    if (!(key in draft)) continue;
    const text = draft[key] ?? "";
    const rules =
      key === "station"
        ? { editor: "select" as const, required: true, options: stations.map((value) => ({ value })) }
        : FIELD_RULES[key as keyof typeof FIELD_RULES];
    const parsed = parseCell(rules, text);
    if (!parsed.ok) {
      errors[key] = parsed.message;
      continue;
    }
    const prop = PROP_OF[key];
    const current = prop ? (row[prop] as CellValue) : null;
    if (!sameValue(parsed.value, current)) patch[key] = parsed.value;
  }
  return { patch, errors };
}
