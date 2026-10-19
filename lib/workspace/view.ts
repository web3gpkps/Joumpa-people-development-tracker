/*
 * Views over one caller's Workspace that every screen shares: the BMI rule settings, station
 * order, the KPS station filter, Tracker Staf order, report groups, and "last changed via".
 * Pure (no server-only import), so client components may use it too. No formula lives here:
 * those stay in lib/rules (BMI) and lib/pd-rules (the People Development workbook).
 */
import { formatJam, formatTanggalPendek, toIsoDate } from "@/lib/dates";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/rules";
import type { Workspace, WorkspaceStaff } from "./index";

const NUMERIC_KEYS = [
  "bmiIntervalDays",
  "bmiPeriods",
  "bmiUnderweightBelow",
  "bmiNormalMax",
  "bmiOverweightMax",
] as const satisfies ReadonlyArray<keyof Settings>;

const DATE_KEYS = ["bmiFirstCheck"] as const satisfies ReadonlyArray<keyof Settings>;

/** The pd_settings columns (tab "Parameter BMI"), camelCased. */
export const BMI_SETTING_KEYS = [...NUMERIC_KEYS, ...DATE_KEYS, "minHeightFemale", "minHeightMale"] as const;

/**
 * lib/rules Settings from pd_share_open's settings row (tab "Parameter BMI"). v2 keeps only
 * the BMI parameters; everything else in Settings stays at lib/rules' defaults (unused by the
 * BMI screens). The minimum heights stay null when blank, as the workbook leaves them.
 */
export function ruleSettings(raw: Workspace["settings"]): Settings {
  const source = raw as Record<string, unknown>;
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const key of NUMERIC_KEYS) {
    const value = source[key];
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) out[key] = Number(value);
  }
  for (const key of DATE_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  for (const key of ["minHeightFemale", "minHeightMale"] as const) {
    const value = source[key];
    out[key] = value === null || value === undefined ? null : Number(value);
  }
  return out;
}

/** False when pd_share_open left out a Parameter BMI column, so a screen can say defaults are in use. */
export function settingsComplete(raw: Workspace["settings"]): boolean {
  return BMI_SETTING_KEYS.every((key) => key in raw);
}

/** Station codes in this workspace, in the stations table's order. */
export function stationCodes(ws: Pick<Workspace, "stations">): string[] {
  return [...ws.stations]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.code.localeCompare(b.code))
    .map((s) => s.code);
}

/** First value of a search param. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * KPS station filter from `?stasiun=`: a station code of this workspace, or null for
 * "Semua stasiun". Station links always see their own station and get null.
 */
export function parseStation(ws: Workspace, raw: string | string[] | undefined): string | null {
  if (!ws.isKps) return null;
  const code = firstParam(raw)?.toUpperCase();
  return code && stationCodes(ws).includes(code) ? code : null;
}

/** Staff in workbook order: station order, then Master SDM row order. */
export function sortedStaff(ws: Workspace): WorkspaceStaff[] {
  const order = new Map(stationCodes(ws).map((code, i) => [code, i] as const));
  return [...ws.staff].sort(
    (a, b) =>
      (order.get(a.station) ?? 99) - (order.get(b.station) ?? 99) ||
      (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) ||
      a.code.localeCompare(b.code),
  );
}

/** Report groups ("Cabang") of this workspace, in station order: "CGK & HLP", "DPS", ... */
export function reportGroups(ws: Pick<Workspace, "stations">): string[] {
  const out: string[] = [];
  for (const s of [...ws.stations].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.code.localeCompare(b.code))) {
    if (!out.includes(s.reportGroup)) out.push(s.reportGroup);
  }
  return out;
}

/**
 * The Cabang that hold data (staff, Rencana Aksi, Penggantian or Laporan Bulanan), in station order,
 * plus the caller's own Cabang. The database lists 35 stations; the programme covers a handful, so
 * filters offer these instead of every station.
 */
export function activeReportGroups(
  ws: Pick<Workspace, "stations" | "staff" | "actionPlans" | "replacements" | "monthlyReports" | "scope" | "isKps">,
): string[] {
  const used = new Set<string>();
  for (const s of ws.staff) used.add(s.reportGroup ?? groupOfStation(ws.stations, s.station) ?? "");
  for (const row of [...ws.actionPlans, ...ws.replacements, ...ws.monthlyReports]) if (row.reportGroup) used.add(row.reportGroup);
  if (!ws.isKps) used.add(groupOfStation(ws.stations, ws.scope) ?? "");
  return reportGroups(ws).filter((g) => used.has(g));
}

/** Station codes that have staff, in station order, plus the caller's own station. */
export function activeStationCodes(ws: Pick<Workspace, "stations" | "staff" | "scope" | "isKps">): string[] {
  const used = new Set(ws.staff.map((s) => s.station));
  if (!ws.isKps) used.add(ws.scope);
  return stationCodes(ws).filter((c) => used.has(c));
}

/** `active` first, then the rest of `all`: dialogs that may start a new Cabang or station. */
export function activeFirst(active: string[], all: string[]): string[] {
  return [...active, ...all.filter((x) => !active.includes(x))];
}

/** The report group of a station code, or null when unknown. */
export function groupOfStation(stations: Pick<Workspace, "stations">["stations"], code: string): string | null {
  return stations.find((s) => s.code === code)?.reportGroup ?? null;
}

type LinkContext = Pick<Workspace, "linkId" | "linkLabels">;
type ChangedRow = { updatedByLink?: string | null; updatedAt?: string | null };

/** Who last changed a row: "tautan ini", another link's label, or "pengelola, akun cabang, atau Google Sheet" (owner, a signed-in account or the data sync). */
export function changedVia(row: ChangedRow, ws: LinkContext): string {
  if (!row.updatedByLink) return "pengelola, akun cabang, atau Google Sheet";
  if (row.updatedByLink === ws.linkId) return "tautan ini";
  return ws.linkLabels[row.updatedByLink] ?? "tautan lain";
}

/** "8 Okt 14.05" in Asia/Jakarta, or null for a missing or unreadable timestamp. */
export function shortDateTime(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return `${formatTanggalPendek(toIsoDate(date))} ${formatJam(date)}`;
}

/** "Diubah lewat tautan ini, 8 Okt 14.05". */
export function lastChangedLabel(row: ChangedRow, ws: LinkContext): string {
  const when = shortDateTime(row.updatedAt);
  return `Diubah lewat ${changedVia(row, ws)}${when ? `, ${when}` : ""}`;
}
