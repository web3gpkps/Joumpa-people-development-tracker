/*
 * Rencana Aksi view model: the rows of the tab "Rencana Aksi" shaped for the screen. Pure and
 * client-safe (no server-only import): the server page shapes, sorts and filters; the client
 * components reuse the types and labels. The Flag is lib/pd-rules planFlag, never re-derived here.
 */
import { formatTanggal, type IsoDate } from "@/lib/dates";
import { relativeDays } from "@/lib/format";
import { DUE_SOON_DAYS, FLAGS, STATUSES, planFlag, type Flag } from "@/lib/pd-rules";
import { diffDays } from "@/lib/dates";
import { lastChangedLabel } from "@/lib/workspace/view";
import type { Workspace, WorkspaceActionPlan } from "@/lib/workspace";

export type PlanView = {
  id: number;
  itemNo: string | null;
  area: string;
  action: string;
  reportGroup: string;
  target: string | null;
  dueDate: IsoDate | null;
  pic: string | null;
  status: string;
  /** 0..100 */
  progress: number;
  doneOn: IsoDate | null;
  evidence: string | null;
  notes: string | null;
  flag: Flag;
  /** Days until the due date (negative once late); null without a due date or once done. */
  daysLeft: number | null;
  /** "Diubah lewat tautan ini, 8 Okt 14.05". */
  changedLabel: string;
  /** Set for archived rows (owner only). */
  archivedAt: string | null;
};

export function toPlanView(
  row: WorkspaceActionPlan,
  today: IsoDate,
  ws: Pick<Workspace, "linkId" | "linkLabels">,
): PlanView {
  const flag = planFlag(row, today);
  return {
    id: row.id,
    itemNo: row.itemNo,
    area: row.area,
    action: row.action,
    reportGroup: row.reportGroup,
    target: row.target,
    dueDate: row.dueDate,
    pic: row.pic,
    status: row.status,
    progress: row.progress ?? 0,
    doneOn: row.doneOn,
    evidence: row.evidence,
    notes: row.notes,
    flag,
    daysLeft: flag !== "Selesai" && row.dueDate ? diffDays(row.dueDate, today) : null,
    changedLabel: lastChangedLabel(row, ws),
    archivedAt: row.archivedAt,
  };
}

// ------------------------------------------------------------------ order

/**
 * Workbook item numbers in reading order: "1" < "2" < "6a" < "6b" < "10" < "A". Blank last.
 * The leading number decides, then the rest as text.
 */
export function compareItemNo(a: string | null, b: string | null): number {
  const ta = a?.trim() ?? "";
  const tb = b?.trim() ?? "";
  if (ta === "" || tb === "") return ta === tb ? 0 : ta === "" ? 1 : -1;
  const ma = /^(\d+)(.*)$/.exec(ta);
  const mb = /^(\d+)(.*)$/.exec(tb);
  if (ma && mb) {
    const n = Number(ma[1]) - Number(mb[1]);
    if (n !== 0) return n;
    return ma[2].localeCompare(mb[2], "id", { sensitivity: "base", numeric: true });
  }
  if (ma) return -1;
  if (mb) return 1;
  return ta.localeCompare(tb, "id", { sensitivity: "base", numeric: true });
}

/** Default order: area (dropdown order), then No, then Cabang (station order), then id. */
export function sortPlans<T extends Pick<PlanView, "area" | "itemNo" | "reportGroup" | "id">>(
  rows: readonly T[],
  areas: readonly string[],
  groups: readonly string[],
): T[] {
  const areaIndex = new Map(areas.map((a, i) => [a, i] as const));
  const groupIndex = new Map(groups.map((g, i) => [g, i] as const));
  const rank = (map: Map<string, number>, key: string) => map.get(key) ?? map.size;
  return [...rows].sort(
    (a, b) =>
      rank(areaIndex, a.area) - rank(areaIndex, b.area) ||
      a.area.localeCompare(b.area) ||
      compareItemNo(a.itemNo, b.itemNo) ||
      rank(groupIndex, a.reportGroup) - rank(groupIndex, b.reportGroup) ||
      a.id - b.id,
  );
}

// ------------------------------------------------------------------ filters (URL)

export const ALL = "semua";

export type PlanFilters = {
  /** Report group, KPS and owner only. */
  cabang: string | null;
  area: string | null;
  flag: Flag | null;
  status: string | null;
  /** Free text, trimmed; "" for none. */
  q: string;
};

type Raw = string | string[] | undefined;
const first = (v: Raw) => (Array.isArray(v) ? v[0] : v);

/**
 * Filters from the URL (?cabang=&area=&flag=&status=&q=). Unknown values are dropped, so a
 * stale link shows everything instead of nothing. A station scope never filters by Cabang.
 */
export function parseFilters(
  query: Record<string, Raw>,
  ctx: { isKps: boolean; groups: readonly string[]; areas: readonly string[] },
): PlanFilters {
  const pick = <T extends string>(raw: Raw, allowed: readonly T[]): T | null => {
    const value = first(raw)?.trim();
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
  };
  const flag = pick(query.flag, FLAGS);
  return {
    cabang: ctx.isKps ? pick(query.cabang, ctx.groups) : null,
    area: pick(query.area, ctx.areas),
    flag,
    // One "Flag / status" select: a flag wins over a status.
    status: flag ? null : pick(query.status, STATUSES),
    q: (first(query.q) ?? "").trim().slice(0, 100),
  };
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");

/** The text a search matches: No, area, tindakan, Cabang, sasaran, PIC, bukti, catatan. */
export function searchText(row: PlanView): string {
  return norm(
    [row.itemNo, row.area, row.action, row.reportGroup, row.target, row.pic, row.evidence, row.notes]
      .filter(Boolean)
      .join(" "),
  );
}

export function filterPlans(rows: readonly PlanView[], f: PlanFilters): PlanView[] {
  const words = norm(f.q).split(" ").filter(Boolean);
  return rows.filter((r) => {
    if (f.cabang && r.reportGroup !== f.cabang) return false;
    if (f.area && r.area !== f.area) return false;
    if (f.flag && r.flag !== f.flag) return false;
    if (f.status && r.status !== f.status) return false;
    if (words.length > 0) {
      const text = searchText(r);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
}

/** Number of filters in use besides Cabang (shown as "2 filter aktif"). */
export function activeFilterCount(f: PlanFilters): number {
  return [f.area, f.flag ?? f.status, f.q || null].filter(Boolean).length;
}

/** The query of a filter set, for links; `change` overrides single keys (null removes). */
export function filterQuery(f: PlanFilters, change: Partial<Record<keyof PlanFilters, string | null>> = {}) {
  const merged: Record<keyof PlanFilters, string | null> = {
    cabang: f.cabang,
    area: f.area,
    flag: f.flag,
    status: f.status,
    q: f.q || null,
    ...change,
  };
  return merged;
}

// ------------------------------------------------------------------ summary

export type PlanSummary = {
  total: number;
  byFlag: Record<Flag, number>;
  /** Mean of % progres (0..100), null without rows. */
  avgProgress: number | null;
  /** Open rows due today up to DUE_SOON_DAYS days ahead (= Flag "Jatuh tempo ≤ 7 hari"). */
  dueSoon: number;
};

export function summarize(rows: readonly PlanView[]): PlanSummary {
  const byFlag = Object.fromEntries(FLAGS.map((f) => [f, 0])) as Record<Flag, number>;
  let progress = 0;
  let dueSoon = 0;
  for (const r of rows) {
    byFlag[r.flag] += 1;
    progress += r.progress;
    if (r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= DUE_SOON_DAYS) dueSoon += 1;
  }
  return { total: rows.length, byFlag, avgProgress: rows.length ? progress / rows.length : null, dueSoon };
}

// ------------------------------------------------------------------ labels

/** "31 Okt 2026" or null. */
export function dueLabel(due: IsoDate | null): string | null {
  return due ? formatTanggal(due) : null;
}

/** "Lewat 3 hari", "Hari ini", "5 hari lagi"; null when not counted. */
export function daysLeftLabel(days: number | null): string | null {
  if (days === null) return null;
  const text = relativeDays(days);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "42%" with a decimal comma when needed ("12,5%"). */
export function percentLabel(value: number | null): string {
  if (value === null) return "–";
  const rounded = Math.round(value * 10) / 10;
  return `${String(rounded).replace(".", ",")}%`;
}
