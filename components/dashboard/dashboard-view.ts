/*
 * Beranda's view over one KPS / owner Workspace: the lib/pd-rules Dashboard input, the groups
 * worth a row, the KPI cards and the key timeline. Pure (no server-only import, no clock: today is
 * passed in). Every number comes from lib/pd-rules; nothing here recomputes a workbook formula.
 */
import { formatTanggal, type IsoDate } from "@/lib/dates";
import { formatRatio } from "@/lib/format";
import {
  TIMELINE,
  daysLeft,
  planFlag,
  reassessResult,
  replacementFlag,
  staffFlag,
  type DashboardInput,
  type DashboardKpis,
} from "@/lib/pd-rules";
import type { SheetKey } from "@/lib/workspace/access";
import { groupOfStation, reportGroups } from "@/lib/workspace/view";
import type { Workspace } from "@/lib/workspace";

type DashboardSource = Pick<Workspace, "stations" | "areas" | "staff" | "actionPlans" | "replacements">;

/**
 * The lib/pd-rules Dashboard input. A staff row without its own Cabang takes its station's;
 * archived Rencana Aksi rows (the owner also receives them) are left out. `groups` holds every
 * Cabang that has staff, replacements or plans, in station order: the database lists every
 * station, but only the workbook branches hold data.
 */
export function dashboardInput(ws: DashboardSource): DashboardInput {
  const staff = ws.staff.map((s) => ({
    reportGroup: s.reportGroup ?? groupOfStation(ws.stations, s.station),
    proposal: s.proposal,
    mainDue: s.mainDue,
    mainStatus: s.mainStatus,
    extraDue: s.extraDue,
    extraStatus: s.extraStatus,
    reassessPractice: s.reassessPractice,
  }));
  const replacements = ws.replacements.map((r) => ({
    reportGroup: r.reportGroup,
    category: r.category,
    withdrawDue: r.withdrawDue,
    withdrawStatus: r.withdrawStatus,
    postTest: r.postTest,
    practice: r.practice,
    trainingDue: r.trainingDue,
    startedOn: r.startedOn,
  }));
  const plans = ws.actionPlans
    .filter((p) => !p.archivedAt)
    .map((p) => ({
      reportGroup: p.reportGroup,
      area: p.area,
      dueDate: p.dueDate,
      status: p.status,
      progress: p.progress === null || p.progress === undefined ? null : Number(p.progress),
      archivedAt: p.archivedAt,
    }));

  const used = new Set<string>();
  for (const row of [...staff, ...replacements, ...plans]) if (row.reportGroup) used.add(row.reportGroup);
  const groups = reportGroups(ws).filter((g) => used.has(g));
  const areas = [...ws.areas].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name)).map((a) => a.name);

  return { groups, areas, staff, replacements, plans };
}

/** "Item terlambat" split by tracker, for the KPI foot (the KPI itself is dashboardKpis().late). */
export function lateBySource(input: DashboardInput, today: IsoDate) {
  return {
    staff: input.staff.filter((s) => staffFlag(s, today) === "Terlambat").length,
    replacements: input.replacements.filter((r) => replacementFlag(r, today) === "Terlambat").length,
    plans: input.plans.filter((p) => !p.archivedAt && planFlag(p, today) === "Terlambat").length,
  };
}

export type KpiCard = {
  key: string;
  label: string;
  /** The figure as shown ("12 / 15", "80%"), or null for "–" with `emptyReason`. */
  value: string | null;
  emptyReason?: string;
  foot: string;
  /** 0..100, draws a thin bar under the foot. */
  progress?: number;
  tone?: "good" | "warning" | "critical";
  /** The page that holds the rows behind the figure. */
  sheet?: SheetKey;
};

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : undefined);

/**
 * The KPI row (Dashboard row 6), in workbook order. A share with nothing to divide by is "–"
 * with a reason, never a 0% that reads like a result.
 */
export function kpiCards(kpis: DashboardKpis, input: DashboardInput, today: IsoDate): KpiCard[] {
  const plans = input.plans.filter((p) => !p.archivedAt);
  const plansDone = plans.filter((p) => p.status === "Selesai").length;
  const compliant = input.staff.filter((s) => reassessResult(s.reassessPractice) === "Sesuai").length;
  const late = lateBySource(input, today);
  const strongReminders = input.replacements.filter((r) => r.category === "Strong reminder").length;
  const proposed = kpis.replacements - strongReminders;

  return [
    {
      key: "staf",
      label: "Total staf",
      value: String(kpis.totalStaff),
      foot: `di ${input.groups.length} cabang`,
      sheet: "trackerStaf",
    },
    {
      key: "penggantian",
      label: "Penggantian selesai",
      value: `${kpis.replacementsDone} / ${kpis.replacements}`,
      foot: !kpis.replacements
        ? "belum ada usulan ganti"
        : strongReminders
          ? `${proposed} usulan ganti · ${strongReminders} strong reminder`
          : `${proposed} usulan ganti`,
      progress: share(kpis.replacementsDone, kpis.replacements),
      sheet: "penggantian",
    },
    {
      key: "dinilai-ulang",
      label: "Sudah dinilai ulang",
      value: `${kpis.reassessed} / ${kpis.intensive}`,
      foot: "dari staf coaching intensif",
      progress: share(Math.min(kpis.reassessed, kpis.intensive), kpis.intensive),
      sheet: "trackerStaf",
    },
    {
      key: "sesuai",
      label: "% Sesuai",
      value: kpis.reassessed ? formatRatio(kpis.compliance) : null,
      emptyReason: "belum ada yang dinilai ulang",
      foot: kpis.reassessed ? `${compliant} dari ${kpis.reassessed} yang dinilai ulang` : "belum ada yang dinilai ulang",
      tone: kpis.reassessed && compliant < kpis.reassessed ? "warning" : undefined,
      sheet: "trackerStaf",
    },
    {
      key: "rencana-aksi",
      label: "Rencana aksi selesai",
      value: plans.length ? formatRatio(kpis.plansDone) : null,
      emptyReason: "belum ada rencana aksi",
      foot: plans.length ? `${plansDone} dari ${plans.length} rencana aksi` : "belum ada rencana aksi",
      progress: share(plansDone, plans.length),
      sheet: "rencanaAksi",
    },
    {
      key: "terlambat",
      label: "Tindak lanjut terlambat",
      value: String(kpis.late),
      foot: `Staf ${late.staff} · Penggantian ${late.replacements} · Rencana aksi ${late.plans}`,
      tone: kpis.late > 0 ? "critical" : undefined,
    },
  ];
}

export type TimelineRow = {
  date: IsoDate;
  dateLabel: string;
  agenda: string;
  /** "Lewat", "Hari ini", "Besok" or "12 hari lagi". */
  remaining: string;
  state: "past" | "today" | "soon" | "later";
};

/** "Linimasa kunci" with Sisa hari: null is "Lewat", 0 is "Hari ini"; ≤ 7 days is "soon". */
export function timelineRows(today: IsoDate, timeline = TIMELINE): TimelineRow[] {
  return timeline.map(({ date, agenda }) => {
    const left = daysLeft(date, today);
    const state: TimelineRow["state"] = left === null ? "past" : left === 0 ? "today" : left <= 7 ? "soon" : "later";
    const remaining = left === null ? "Lewat" : left === 0 ? "Hari ini" : left === 1 ? "Besok" : `${left} hari lagi`;
    return { date, dateLabel: formatTanggal(date), agenda, remaining, state };
  });
}

/** Index of the first timeline row still ahead (today included), or rows.length when all have passed. */
export function nextTimelineIndex(rows: TimelineRow[]): number {
  const i = rows.findIndex((r) => r.state !== "past");
  return i < 0 ? rows.length : i;
}
