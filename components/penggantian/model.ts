/*
 * Penggantian SDM, pure helpers shared by the server screen, the client grid and dialogs, and the
 * Server Actions: URL filters, the summary counts, the add/edit form, and the pd_share_save_replacement
 * patch (built on the client, checked again on the server). No I/O, no clock: `today` is passed in.
 * The workbook formulas (Lulus training?, Flag, Pengganti belum terdaftar) stay in lib/pd-rules.
 */
import { isValidIsoDate } from "@/lib/dates";
import { parseCell, type CellValue } from "@/lib/grid/values";
import {
  REPLACEMENT_CATEGORIES,
  REPLACEMENT_POSTTEST_MIN,
  REPLACEMENT_PRACTICE_MIN,
  STATUSES,
  YA_BELUM_TIDAK,
  replacementFlag,
  replacementNotRegistered,
  replacementPassed,
  type Flag,
  type ReplacementRow,
} from "@/lib/pd-rules";

// ------------------------------------------------------------------ programme defaults

/** "Ditarik paling lambat 31 Okt 2026". */
export const DEFAULT_WITHDRAW_DUE = "2026-10-31";
/** "Pengganti lulus training Uplifting, target 15 Nov 2026". */
export const DEFAULT_TRAINING_DUE = "2026-11-15";
export const DEFAULT_APPROVAL = "Belum";
export const DEFAULT_STATUS = "Belum Mulai";

export const TEXT_MAX = 200;
export const LONG_TEXT_MAX = 4000;
export const POST_TEST_RULES = { editor: "number", min: 0, max: 100, decimals: 2 } as const;
export const PRACTICE_RULES = { editor: "number", min: 1, max: 5, decimals: 2 } as const;

// ------------------------------------------------------------------ rows

/** One replacement as the client components get it (serialisable, numbers already numbers). */
export type ReplacementView = {
  id: number;
  /** Workbook "No": position in the full list (sort order), stable under filters. */
  no: number;
  staffCode: string | null;
  name: string;
  reportGroup: string | null;
  category: string | null;
  basis: string | null;
  withdrawDue: string | null;
  directorApproval: string | null;
  withdrawnOn: string | null;
  withdrawStatus: string | null;
  replacementName: string | null;
  selectedOn: string | null;
  postTest: number | null;
  practice: number | null;
  trainingDue: string | null;
  startedOn: string | null;
  notes: string | null;
  /** "Diubah lewat tautan ini, 8 Okt 14.05". */
  changed: string;
};

/** The pd_replacements fields the view needs, camelCased (WorkspaceReplacement fits). */
export type ReplacementSource = Omit<ReplacementView, "no" | "changed" | "postTest" | "practice"> & {
  postTest: number | string | null;
  practice: number | string | null;
  sortOrder: number | null;
};

const toNumber = (value: number | string | null): number | null => {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Rows in workbook order (sort order, then id), numbered 1..n. */
export function toViews<S extends ReplacementSource>(rows: readonly S[], changed: (row: S) => string): ReplacementView[] {
  return [...rows]
    .sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || a.id - b.id)
    .map((row, i) => ({
      id: row.id,
      no: i + 1,
      staffCode: row.staffCode,
      name: row.name,
      reportGroup: row.reportGroup,
      category: row.category,
      basis: row.basis,
      withdrawDue: row.withdrawDue,
      directorApproval: row.directorApproval,
      withdrawnOn: row.withdrawnOn,
      withdrawStatus: row.withdrawStatus,
      replacementName: row.replacementName,
      selectedOn: row.selectedOn,
      postTest: toNumber(row.postTest),
      practice: toNumber(row.practice),
      trainingDue: row.trainingDue,
      startedOn: row.startedOn,
      notes: row.notes,
      changed: changed(row),
    }));
}

// ------------------------------------------------------------------ status tones

// ------------------------------------------------------------------ filters (URL)

export const FLAG_FILTERS = [
  { value: "terlambat", label: "Terlambat" },
  { value: "jatuh-tempo", label: "Jatuh tempo ≤ 7 hari" },
  { value: "on-track", label: "On track" },
  { value: "selesai", label: "Selesai" },
  { value: "belum-terdaftar", label: "Pengganti belum terdaftar" },
] as const;

export const CATEGORY_FILTERS = [
  { value: "penggantian", label: "Penggantian" },
  { value: "strong-reminder", label: "Strong reminder" },
] as const satisfies ReadonlyArray<{ value: string; label: (typeof REPLACEMENT_CATEGORIES)[number] }>;

export type FlagFilter = (typeof FLAG_FILTERS)[number]["value"];
export type CategoryFilter = (typeof CATEGORY_FILTERS)[number]["value"];

export type Filters = {
  /** A report group of this workspace ("CGK & HLP"), or null for all. */
  cabang: string | null;
  kategori: CategoryFilter | null;
  flag: FlagFilter | null;
  /** Trimmed search text, or "" for none. */
  cari: string;
};

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Reads ?cabang=&kategori=&flag=&cari=; unknown values fall back to "all". */
export function parseFilters(params: Params, groups: readonly string[]): Filters {
  const cabang = first(params.cabang)?.trim();
  const kategori = first(params.kategori);
  const flag = first(params.flag);
  return {
    cabang: cabang && groups.includes(cabang) ? cabang : null,
    kategori: CATEGORY_FILTERS.some((c) => c.value === kategori) ? (kategori as CategoryFilter) : null,
    flag: FLAG_FILTERS.some((f) => f.value === flag) ? (flag as FlagFilter) : null,
    cari: (first(params.cari) ?? "").trim().slice(0, 100),
  };
}

/** The query for a filter set (empty values left out), for hrefs(access).to("penggantian", …). */
export function filterQuery(filters: Filters): Record<string, string | null> {
  return { cabang: filters.cabang, kategori: filters.kategori, flag: filters.flag, cari: filters.cari || null };
}

const FLAG_OF: Record<Exclude<FlagFilter, "belum-terdaftar">, Flag> = {
  terlambat: "Terlambat",
  "jatuh-tempo": "Jatuh tempo ≤ 7 hari",
  "on-track": "On track",
  selesai: "Selesai",
};

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** True when every word of `query` appears in one of the texts (accents and case ignored). */
export function matchesQuery(query: string, ...texts: Array<string | null | undefined>): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(texts.filter(Boolean).join(" "));
  return words.every((w) => haystack.includes(w));
}

type Staffish = ReadonlyArray<{ name?: string | null }>;

/** Cabang and Kategori only: the rows the summary counts. */
export function scopeRows<R extends Pick<ReplacementView, "reportGroup" | "category">>(rows: readonly R[], filters: Filters): R[] {
  const category = CATEGORY_FILTERS.find((c) => c.value === filters.kategori)?.label;
  return rows.filter((r) => (!filters.cabang || r.reportGroup === filters.cabang) && (!category || r.category === category));
}

/** Every filter: the rows the grid and the cards show. */
export function filterRows<R extends ReplacementView>(rows: readonly R[], filters: Filters, today: string, staff: Staffish): R[] {
  return scopeRows(rows, filters).filter((r) => {
    if (filters.flag === "belum-terdaftar") {
      if (!replacementNotRegistered(r, staff)) return false;
    } else if (filters.flag && replacementFlag(r, today) !== FLAG_OF[filters.flag]) {
      return false;
    }
    return matchesQuery(filters.cari, r.name, r.staffCode, r.replacementName, r.reportGroup);
  });
}

// ------------------------------------------------------------------ summary

export type Summary = {
  total: number;
  withdrawn: number;
  /** Rows with a replacement name. */
  withReplacement: number;
  passed: number;
  late: number;
  dueSoon: number;
  approvalPending: number;
  notRegistered: number;
};

/** The four cards: penarikan selesai x/y, lulus training, flags, persetujuan Direksi pending. */
export function summarize(rows: readonly (ReplacementRow & Pick<ReplacementView, "directorApproval" | "replacementName">)[], today: string, staff: Staffish): Summary {
  const flags = rows.map((r) => replacementFlag(r, today));
  return {
    total: rows.length,
    withdrawn: rows.filter((r) => r.withdrawStatus === "Selesai").length,
    withReplacement: rows.filter((r) => r.replacementName?.trim()).length,
    passed: rows.filter((r) => replacementPassed(r) === "Lulus").length,
    late: flags.filter((f) => f === "Terlambat").length,
    dueSoon: flags.filter((f) => f === "Jatuh tempo ≤ 7 hari").length,
    // Pending: not yet decided (Belum or blank). A cancelled row needs no approval.
    approvalPending: rows.filter(
      (r) => r.withdrawStatus !== "Batal / N.A." && r.directorApproval !== "Ya" && r.directorApproval !== "Tidak",
    ).length,
    notRegistered: rows.filter((r) => replacementNotRegistered(r, staff)).length,
  };
}

// ------------------------------------------------------------------ staff search

export type StaffOption = { code: string; name: string; station: string; reportGroup: string | null };

/** Staff whose name, ID, station or Cabang contain every typed word; at most `limit`. */
export function searchStaff(staff: readonly StaffOption[], query: string, limit = 40): StaffOption[] {
  const out: StaffOption[] = [];
  for (const s of staff) {
    if (matchesQuery(query, s.name, s.code, s.station, s.reportGroup)) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

// ------------------------------------------------------------------ patch (pd_share_save_replacement)

export const PATCH_KEYS = [
  "staff_code",
  "name",
  "report_group",
  "category",
  "basis",
  "withdraw_due",
  "director_approval",
  "withdrawn_on",
  "withdraw_status",
  "replacement_name",
  "selected_on",
  "post_test",
  "practice",
  "training_due",
  "started_on",
  "notes",
] as const;

export type PatchKey = (typeof PATCH_KEYS)[number];
export type ReplacementPatch = Partial<Record<PatchKey, string | number | null>>;

const DATE_KEYS = new Set<PatchKey>(["withdraw_due", "withdrawn_on", "selected_on", "training_due", "started_on"]);
const ENUMS: Partial<Record<PatchKey, readonly string[]>> = {
  category: REPLACEMENT_CATEGORIES,
  director_approval: YA_BELUM_TIDAK,
  withdraw_status: STATUSES,
};
const SHORT_TEXT: Partial<Record<PatchKey, number>> = { staff_code: 20, name: TEXT_MAX, report_group: 20, replacement_name: TEXT_MAX };
const LONG_TEXT = new Set<PatchKey>(["basis", "notes"]);

/** Plain-language message per field, for the client checks and the database's invalid_input. */
export const FIELD_MESSAGES: Record<PatchKey, string> = {
  staff_code: "Pilih SDM dari Tracker Staf.",
  name: "Pilih SDM dari Tracker Staf.",
  report_group: "Pilih Cabang yang ada.",
  category: "Pilih Penggantian atau Strong reminder.",
  basis: `Dasar usulan paling panjang ${LONG_TEXT_MAX} karakter.`,
  withdraw_due: "Tanggal tidak valid. Tulis seperti 31/10/2026.",
  director_approval: "Pilih Ya, Belum, atau Tidak.",
  withdrawn_on: "Tanggal tidak valid. Tulis seperti 31/10/2026.",
  withdraw_status: "Pilih Belum Mulai, Proses, Selesai, atau Batal / N.A.",
  replacement_name: `Nama pengganti paling panjang ${TEXT_MAX} karakter.`,
  selected_on: "Tanggal tidak valid. Tulis seperti 31/10/2026.",
  post_test: "Post-test harus 0 sampai 100.",
  practice: "Praktik harus 1,00 sampai 5,00.",
  training_due: "Tanggal tidak valid. Tulis seperti 15/11/2026.",
  started_on: "Tanggal tidak valid. Tulis seperti 15/11/2026.",
  notes: `Catatan paling panjang ${LONG_TEXT_MAX} karakter.`,
};

export type PatchCheck = { ok: true; patch: ReplacementPatch } | { ok: false; field: string; message: string };

/**
 * Normalises and checks a patch before it reaches the database (the Server Action runs it on
 * whatever the client sent). Unknown keys are refused; text is trimmed and "" becomes null
 * (clears); dates must be real 'YYYY-MM-DD'; numbers are in range with at most two decimals.
 */
export function checkPatch(raw: unknown): PatchCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, field: "patch", message: "Data tidak terbaca." };
  const patch: ReplacementPatch = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(PATCH_KEYS as readonly string[]).includes(key)) return { ok: false, field: key, message: "Isian ini tidak dikenal." };
    const field = key as PatchKey;
    const fail = (): PatchCheck => ({ ok: false, field, message: FIELD_MESSAGES[field] });
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
      patch[field] = null;
      continue;
    }
    if (field === "post_test" || field === "practice") {
      const rules = field === "post_test" ? POST_TEST_RULES : PRACTICE_RULES;
      const n = typeof value === "number" ? value : typeof value === "string" ? parseNumberText(value) : null;
      if (n === null || !Number.isFinite(n) || n < rules.min || n > rules.max || Math.round(n * 100) / 100 !== n) return fail();
      patch[field] = n;
      continue;
    }
    if (typeof value !== "string") return fail();
    const text = LONG_TEXT.has(field) ? value.trim() : value.trim().replace(/\s+/g, " ");
    if (DATE_KEYS.has(field)) {
      if (!isValidIsoDate(text)) return fail();
    } else if (ENUMS[field]) {
      if (!ENUMS[field]!.includes(text)) return fail();
    } else if (text.length > (SHORT_TEXT[field] ?? LONG_TEXT_MAX)) {
      return fail();
    }
    patch[field] = text;
  }
  if (Object.keys(patch).length === 0) return { ok: false, field: "patch", message: "Tidak ada yang berubah." };
  return { ok: true, patch };
}

/** "85,5" or "85.5" → 85.5; null when it is not a plain number. */
export function parseNumberText(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "");
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return null;
  return Number(t.replace(",", "."));
}

/** The grid's changed cells (column key = patch key) as a patch; computed columns are dropped. */
export function patchFromCells(changes: Record<string, CellValue>): ReplacementPatch {
  const patch: ReplacementPatch = {};
  for (const [key, value] of Object.entries(changes)) {
    if ((PATCH_KEYS as readonly string[]).includes(key)) patch[key as PatchKey] = value === "" ? null : value;
  }
  return patch;
}

// ------------------------------------------------------------------ the add / edit form

export type FormValues = {
  staffCode: string;
  category: string;
  basis: string;
  withdrawDue: string;
  directorApproval: string;
  withdrawnOn: string;
  withdrawStatus: string;
  replacementName: string;
  selectedOn: string;
  postTest: string;
  practice: string;
  trainingDue: string;
  startedOn: string;
  notes: string;
};

export type FormKey = keyof FormValues;
export type FormErrors = Partial<Record<FormKey, string>>;

const FORM_TO_PATCH: Record<FormKey, PatchKey> = {
  staffCode: "staff_code",
  category: "category",
  basis: "basis",
  withdrawDue: "withdraw_due",
  directorApproval: "director_approval",
  withdrawnOn: "withdrawn_on",
  withdrawStatus: "withdraw_status",
  replacementName: "replacement_name",
  selectedOn: "selected_on",
  postTest: "post_test",
  practice: "practice",
  trainingDue: "training_due",
  startedOn: "started_on",
  notes: "notes",
};

/** Patch key (from the database's invalid_input) → form field; name and report_group belong to the SDM picker. */
export function formKeyOf(field: string | undefined): FormKey | null {
  if (!field) return null;
  if (field === "name" || field === "report_group") return "staffCode";
  const entry = (Object.entries(FORM_TO_PATCH) as Array<[FormKey, PatchKey]>).find(([, p]) => p === field);
  return entry ? entry[0] : null;
}

/** A new row: Batas tarik 31 Okt 2026, Batas lulus training 15 Nov 2026, Persetujuan "Belum", Status "Belum Mulai". */
export function newFormValues(staffCode = ""): FormValues {
  return {
    staffCode,
    category: "Penggantian",
    basis: "",
    withdrawDue: DEFAULT_WITHDRAW_DUE,
    directorApproval: DEFAULT_APPROVAL,
    withdrawnOn: "",
    withdrawStatus: DEFAULT_STATUS,
    replacementName: "",
    selectedOn: "",
    postTest: "",
    practice: "",
    trainingDue: DEFAULT_TRAINING_DUE,
    startedOn: "",
    notes: "",
  };
}

/** A number as an input shows it: 4.25 → "4,25". */
const numberText = (value: number | null) => (value === null ? "" : String(value).replace(".", ","));

export function formFromRow(row: ReplacementView): FormValues {
  return {
    staffCode: row.staffCode ?? "",
    category: row.category ?? "",
    basis: row.basis ?? "",
    withdrawDue: row.withdrawDue ?? "",
    directorApproval: row.directorApproval ?? "",
    withdrawnOn: row.withdrawnOn ?? "",
    withdrawStatus: row.withdrawStatus ?? "",
    replacementName: row.replacementName ?? "",
    selectedOn: row.selectedOn ?? "",
    postTest: numberText(row.postTest),
    practice: numberText(row.practice),
    trainingDue: row.trainingDue ?? "",
    startedOn: row.startedOn ?? "",
    notes: row.notes ?? "",
  };
}

/** The typed numbers as numbers (null when blank or unreadable), for the live "Lulus training?" preview. */
export function formScores(values: Pick<FormValues, "postTest" | "practice">): { postTest: number | null; practice: number | null } {
  const read = (text: string) => {
    const result = parseCell({ editor: "number" }, text);
    return result.ok && typeof result.value === "number" ? result.value : null;
  };
  return { postTest: read(values.postTest), practice: read(values.practice) };
}

export type FormCheck = { ok: true; patch: ReplacementPatch } | { ok: false; errors: FormErrors };

/**
 * Checks the form and builds the patch. A new row sends every filled field (the SDM and Kategori
 * are required); an existing row sends only the fields that differ from `original`.
 */
export function checkForm(values: FormValues, original: ReplacementView | null): FormCheck {
  const errors: FormErrors = {};
  const out: Record<FormKey, string | number | null> = {} as Record<FormKey, string | number | null>;

  for (const key of Object.keys(FORM_TO_PATCH) as FormKey[]) {
    const text = values[key].trim();
    if (key === "postTest" || key === "practice") {
      const result = parseCell(key === "postTest" ? POST_TEST_RULES : PRACTICE_RULES, text);
      if (!result.ok) errors[key] = result.message;
      else out[key] = result.value;
      continue;
    }
    if (DATE_KEYS.has(FORM_TO_PATCH[key]) && text !== "" && !isValidIsoDate(text)) {
      errors[key] = "Tanggal belum lengkap atau tidak valid.";
      continue;
    }
    out[key] = text === "" ? null : key === "replacementName" ? text.replace(/\s+/g, " ") : text;
  }
  if (!values.staffCode.trim() && (!original || original.staffCode)) errors.staffCode = "Pilih SDM dari Tracker Staf.";
  if (!values.category.trim() && !original) errors.category = "Pilih kategori.";
  if (((out.basis as string | null)?.length ?? 0) > LONG_TEXT_MAX) errors.basis = FIELD_MESSAGES.basis;
  if (((out.notes as string | null)?.length ?? 0) > LONG_TEXT_MAX) errors.notes = FIELD_MESSAGES.notes;
  if (((out.replacementName as string | null)?.length ?? 0) > TEXT_MAX) errors.replacementName = FIELD_MESSAGES.replacement_name;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const before = original ? formFromRow(original) : null;
  const beforeScores = before ? formScores(before) : null;
  const patch: ReplacementPatch = {};
  for (const key of Object.keys(FORM_TO_PATCH) as FormKey[]) {
    const value = out[key];
    if (!before) {
      if (value !== null) patch[FORM_TO_PATCH[key]] = value;
      continue;
    }
    const was =
      key === "postTest" || key === "practice"
        ? beforeScores![key]
        : before[key].trim() === ""
          ? null
          : before[key].trim();
    if (value !== was) patch[FORM_TO_PATCH[key]] = value;
  }
  return { ok: true, patch };
}

/** Pass marks as the workbook writes them: "post-test ≥ 80 & praktik ≥ 4,00". */
export const PASS_RULE = `post-test ≥ ${REPLACEMENT_POSTTEST_MIN} & praktik ≥ ${REPLACEMENT_PRACTICE_MIN.toFixed(2).replace(".", ",")}`;
