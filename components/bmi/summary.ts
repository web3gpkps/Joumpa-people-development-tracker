/*
 * Pure view helpers for the Cek BMI screen (no React, no server code), so they are unit
 * tested in summary.test.ts. Formulas stay in lib/rules; these only pick and count.
 */
import { diffDays, formatTanggalPendek } from "@/lib/dates";
import { bmiCheckDate, type BmiPeriodValue, type Settings } from "@/lib/rules";
import type { BmiSummary } from "./schedule";
import { toneForStatus, type StatusTone } from "@/components/ui/StatusChip";

/** The slot whose planned date is the latest on or before today; slot 1 before the first check. */
export function defaultPeriod(s: Settings, today: string): number {
  let chosen = 1;
  for (let p = 1; p <= s.bmiPeriods; p++) {
    if (bmiCheckDate(p, s) <= today) chosen = p;
  }
  return chosen;
}

export type BmiSlotCounts = {
  staffCount: number;
  checked: number;
  normal: number;
  kurus: number;
  overweight: number;
  obesitas: number;
  /** (Overweight + Obesitas) ÷ checked in this slot, 0..1; null when nobody is checked. */
  pctOverweight: number | null;
  /** From each person's own schedule (nextCheck), not the selected slot. */
  late: number;
  dueSoon: number;
  scheduled: number;
};

/** Counts for one slot over a set of staff summaries (one station, or everyone in view). */
export function slotCounts(summaries: readonly BmiSummary[], period: number): BmiSlotCounts {
  const out: BmiSlotCounts = {
    staffCount: summaries.length,
    checked: 0,
    normal: 0,
    kurus: 0,
    overweight: 0,
    obesitas: 0,
    pctOverweight: null,
    late: 0,
    dueSoon: 0,
    scheduled: 0,
  };
  for (const s of summaries) {
    const slot = s.periods[period - 1] ?? null;
    if (slot && slot.bmi !== null) {
      out.checked += 1;
      if (slot.category === "Normal") out.normal += 1;
      else if (slot.category === "Kurus") out.kurus += 1;
      else if (slot.category === "Overweight") out.overweight += 1;
      else if (slot.category === "Obesitas") out.obesitas += 1;
    }
    if (s.scheduleStatus === "Terlambat cek") out.late += 1;
    else if (s.scheduleStatus === "Cek ≤ 7 hari") out.dueSoon += 1;
    else out.scheduled += 1;
  }
  out.pctOverweight = out.checked === 0 ? null : (out.overweight + out.obesitas) / out.checked;
  return out;
}

/** How often everyone is checked (lib/rules nextBmiCheck): "tiap 14 hari". */
export function checkRhythm(s: Settings): string {
  return `tiap ${s.bmiIntervalDays} hari`;
}

/** True when this slot holds a complete check (TB and BB, so a BMI). */
export function isChecked(slot: BmiPeriodValue | null | undefined): boolean {
  return Boolean(slot && slot.bmi !== null);
}

/**
 * One status line per person for the chosen slot: "Sudah dicek · 26 Okt",
 * "Belum dicek · terlambat 3 hari", "Belum dicek · jatuh tempo 2 hari lagi" or
 * "Belum dicek · cek berikutnya 9 Nov". The tone comes from the shared tone map.
 */
export function slotStatusLine(
  slot: BmiPeriodValue | null | undefined,
  summary: Pick<BmiSummary, "nextCheck" | "dueBy" | "scheduleStatus">,
  today: string,
): { text: string; tone: StatusTone } {
  if (slot && isChecked(slot)) {
    return {
      text: slot.checkDate ? `Sudah dicek · ${formatTanggalPendek(slot.checkDate)}` : "Sudah dicek",
      tone: "good",
    };
  }
  const tone = toneForStatus(summary.scheduleStatus);
  if (summary.scheduleStatus === "Terlambat cek") {
    return { text: `Belum dicek · terlambat ${Math.max(1, diffDays(today, summary.dueBy))} hari`, tone };
  }
  if (summary.scheduleStatus === "Cek ≤ 7 hari") {
    const days = diffDays(summary.dueBy, today);
    return { text: days <= 0 ? "Belum dicek · jatuh tempo hari ini" : `Belum dicek · jatuh tempo ${days} hari lagi`, tone };
  }
  return { text: `Belum dicek · cek berikutnya ${formatTanggalPendek(summary.nextCheck)}`, tone: "neutral" };
}

const SCHEDULE_RANK: Record<string, number> = { "Terlambat cek": 0, "Cek ≤ 7 hari": 1 };

/**
 * Due and late first: late, then due within 7 days, then the rest; inside each group the
 * people not yet checked in the chosen slot come first. Stable, so the staff order stays.
 */
export function dueFirst<T>(items: readonly T[], summaryOf: (item: T) => BmiSummary, period: number): T[] {
  const rank = (item: T) => {
    const s = summaryOf(item);
    return (SCHEDULE_RANK[s.scheduleStatus] ?? 2) * 2 + (isChecked(s.periods[period - 1]) ? 1 : 0);
  };
  return items
    .map((item, index) => ({ item, index, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.item);
}
