/*
 * Tracker Staf rows, filters and summary counts. Pure: the server screen builds everything
 * with it, the tests pin it. Derived values come from lib/pd-rules (reassessResult, staffFlag).
 */
import type { IsoDate } from "@/lib/dates";
import { FLAGS, PROPOSALS, reassessResult, staffFlag, type Flag } from "@/lib/pd-rules";
import type { SearchParams, Workspace, WorkspaceStaff } from "@/lib/workspace";
import { firstParam, lastChangedLabel } from "@/lib/workspace/view";
import type { TrackerRow } from "./fields";

/** numeric(4,2) arrives as a number, a numeric string, or null. */
export function toScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

type RowContext = Pick<Workspace, "linkId" | "linkLabels" | "bmiChecks" | "replacements">;

/** Tracker rows from sortedStaff(ws), numbered in that order (workbook "No"). */
export function toRows(staff: readonly WorkspaceStaff[], ws: RowContext): TrackerRow[] {
  const bmi = new Map<string, number>();
  for (const c of ws.bmiChecks) bmi.set(c.staffCode, (bmi.get(c.staffCode) ?? 0) + 1);
  const repl = new Map<string, number>();
  for (const r of ws.replacements) if (r.staffCode) repl.set(r.staffCode, (repl.get(r.staffCode) ?? 0) + 1);

  return staff.map((s, i) => ({
    no: i + 1,
    code: s.code,
    name: s.name,
    station: s.station,
    reportGroup: s.reportGroup,
    nipp: s.nipp,
    gender: s.gender,
    proposal: s.proposal,
    initialCoaching: s.initialCoaching,
    coachingItems: s.coachingItems,
    initialPractice: toScore(s.initialPractice),
    mainAction: s.mainAction,
    mainDue: s.mainDue,
    pic: s.pic,
    mainStatus: s.mainStatus,
    extraAction: s.extraAction,
    extraDue: s.extraDue,
    extraStatus: s.extraStatus,
    reassessedOn: s.reassessedOn,
    reassessPractice: toScore(s.reassessPractice),
    recoaching: s.recoaching,
    finalDecision: s.finalDecision,
    progressNotes: s.progressNotes,
    changedLabel: lastChangedLabel(s, ws),
    bmiChecks: bmi.get(s.code) ?? 0,
    replacements: repl.get(s.code) ?? 0,
  }));
}

// ------------------------------------------------------------------ filters (?cabang= &stasiun= &usulan= &flag=)

/** "Belum diisi" in the Usulan filter. */
export const NO_PROPOSAL = "belum-diisi";

/** URL value of a label: "Coaching intensif" → "coaching-intensif", "Jatuh tempo ≤ 7 hari" → "jatuh-tempo-7-hari". */
export function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type Filters = {
  /** Report group ("Cabang"), e.g. "CGK & HLP", or null for all. */
  group: string | null;
  station: string | null;
  /** A PROPOSALS value, NO_PROPOSAL, or null for all. */
  proposal: string | null;
  flag: Flag | null;
};

export type FilterScope = {
  groups: readonly string[];
  /** Station code → report group. */
  groupOf: Readonly<Record<string, string>>;
  /** parseStation(ws, ?stasiun=) already checked the code. */
  station: string | null;
};

/** Filters from the URL; unknown values fall back to "all". A station decides its own Cabang. */
export function parseFilters(sp: SearchParams, scope: FilterScope): Filters {
  const rawGroup = firstParam(sp.cabang)?.trim().toLowerCase();
  let group = scope.groups.find((g) => g.toLowerCase() === rawGroup || slug(g) === rawGroup) ?? null;
  const station = scope.station;
  if (station) group = scope.groupOf[station] ?? group;

  const rawProposal = firstParam(sp.usulan)?.trim().toLowerCase();
  const proposal =
    rawProposal === NO_PROPOSAL ? NO_PROPOSAL : (PROPOSALS.find((p) => slug(p) === rawProposal || p.toLowerCase() === rawProposal) ?? null);

  const rawFlag = firstParam(sp.flag)?.trim().toLowerCase();
  const flag = FLAGS.find((f) => slug(f) === rawFlag || f.toLowerCase() === rawFlag) ?? null;
  return { group, station, proposal, flag };
}

/** Rows in the Cabang / Stasiun scope (the summary counts these). */
export function scopeRows(rows: readonly TrackerRow[], filters: Pick<Filters, "group" | "station">): TrackerRow[] {
  return rows.filter(
    (r) => (!filters.station || r.station === filters.station) && (!filters.group || r.reportGroup === filters.group),
  );
}

/** Rows matching every filter. */
export function filterRows(rows: readonly TrackerRow[], filters: Filters, today: IsoDate): TrackerRow[] {
  return scopeRows(rows, filters).filter((r) => {
    if (filters.proposal === NO_PROPOSAL ? !!r.proposal : filters.proposal && r.proposal !== filters.proposal) return false;
    if (filters.flag && staffFlag(r, today) !== filters.flag) return false;
    return true;
  });
}

/** Name or ID (or NIPP) contains the text, case and spacing ignored. */
export function matchesSearch(row: Pick<TrackerRow, "code" | "name" | "nipp">, text: string): boolean {
  const q = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return true;
  return `${row.code} ${row.name} ${row.nipp ?? ""}`.toLowerCase().replace(/\s+/g, " ").includes(q);
}

// ------------------------------------------------------------------ summary

/** Re-assessed (Praktik ulang filled), Tidak Sesuai, and still waiting for a final decision. */
export function needsDecision(row: Pick<TrackerRow, "reassessPractice" | "finalDecision">): boolean {
  return reassessResult(row.reassessPractice) === "Tidak Sesuai → usulan ganti" && !row.finalDecision;
}

export type TrackerSummary = {
  total: number;
  /** In PROPOSALS order, then "Belum diisi" (only when > 0). */
  proposals: Array<{ label: string; value: string; count: number }>;
  /** In FLAGS order. */
  flags: Array<{ flag: Flag; count: number }>;
  /** Staff proposed for "Coaching intensif" (the group the re-assessment is for). */
  intensive: number;
  /** Of those, re-assessed (Praktik ulang filled). */
  intensiveReassessed: number;
  /** Everyone with a Praktik ulang, any proposal. */
  reassessed: number;
  compliant: number;
  notCompliant: number;
  /** Tidak Sesuai without Keputusan akhir. */
  awaitingDecision: number;
};

export function summarize(rows: readonly TrackerRow[], today: IsoDate): TrackerSummary {
  const proposals = PROPOSALS.map((p) => ({ label: p as string, value: slug(p), count: rows.filter((r) => r.proposal === p).length }));
  const blank = rows.filter((r) => !r.proposal).length;
  if (blank > 0) proposals.push({ label: "Belum diisi", value: NO_PROPOSAL, count: blank });
  const flagOf = rows.map((r) => staffFlag(r, today));
  const intensive = rows.filter((r) => r.proposal === "Coaching intensif");
  const results = rows.map((r) => reassessResult(r.reassessPractice));
  return {
    total: rows.length,
    proposals,
    flags: FLAGS.map((flag) => ({ flag, count: flagOf.filter((f) => f === flag).length })),
    intensive: intensive.length,
    intensiveReassessed: intensive.filter((r) => r.reassessPractice !== null).length,
    reassessed: results.filter((r) => r !== null).length,
    compliant: results.filter((r) => r === "Sesuai").length,
    notCompliant: results.filter((r) => r === "Tidak Sesuai → usulan ganti").length,
    awaitingDecision: rows.filter(needsDecision).length,
  };
}
