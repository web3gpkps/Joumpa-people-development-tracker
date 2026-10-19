import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type BmiCheckRow, type Settings } from "@/lib/rules";
import { trackerSummary } from "./schedule";
import { checkRhythm, defaultPeriod, dueFirst, slotCounts, slotStatusLine } from "./summary";

const bmiSummary = (checks: BmiCheckRow[], settings: Settings, today: string) => trackerSummary(checks, "L", settings, today);

const s: Settings = { ...DEFAULT_SETTINGS, bmiFirstCheck: "2026-10-12", bmiIntervalDays: 14, bmiPeriods: 6 };

describe("defaultPeriod", () => {
  test("slot 1 before the first check", () => {
    expect(defaultPeriod(s, "2026-10-01")).toBe(1);
  });
  test("latest planned slot on or before today", () => {
    expect(defaultPeriod(s, "2026-10-26")).toBe(2);
    expect(defaultPeriod(s, "2026-11-08")).toBe(2);
    expect(defaultPeriod(s, "2026-11-09")).toBe(3);
  });
  test("never past the last slot", () => {
    expect(defaultPeriod(s, "2027-06-01")).toBe(6);
  });
});

describe("slotCounts", () => {
  // 3 Nov: the 12–25 Okt window has closed, the 26 Okt–8 Nov window closes within a week.
  const today = "2026-11-03";
  const check = (period: number, heightCm: number, weightKg: number, checkDate: string): BmiCheckRow => ({
    staffCode: "IULS-01",
    period,
    heightCm,
    weightKg,
    checkDate,
  });
  // A: normal in slot 1. B: obese in slot 1. C: not checked yet.
  const a = bmiSummary([check(1, 170, 60, "2026-10-12")], s, today);
  const b = bmiSummary([check(1, 160, 90, "2026-10-19")], s, today);
  const c = bmiSummary([], s, today);

  test("counts categories in the chosen slot", () => {
    const counts = slotCounts([a, b, c], 1);
    expect(counts.staffCount).toBe(3);
    expect(counts.checked).toBe(2);
    expect(counts.normal).toBe(1);
    expect(counts.obesitas).toBe(1);
    expect(counts.pctOverweight).toBe(0.5);
  });

  test("an empty slot has no overweight share", () => {
    const counts = slotCounts([a, b, c], 2);
    expect(counts.checked).toBe(0);
    expect(counts.pctOverweight).toBeNull();
  });

  test("schedule status comes from each person's own rhythm", () => {
    // a: last check 12 Okt → due by 8 Nov (≤ 7 hari); b: last check 19 Okt → due by 15 Nov (Terjadwal); c: never checked → due by 25 Okt (late).
    const counts = slotCounts([a, b, c], 1);
    expect(counts.dueSoon).toBe(1);
    expect(counts.scheduled).toBe(1);
    expect(counts.late).toBe(1);
  });
});

describe("check rhythm", () => {
  test("one rhythm for everyone", () => {
    expect(checkRhythm(s)).toBe("tiap 14 hari");
    expect(checkRhythm({ ...s, bmiIntervalDays: 7 })).toBe("tiap 7 hari");
  });

  test("the sheet summary stays as lib/rules computes it, with the schedule on top", () => {
    const one = bmiSummary([{ staffCode: "X", period: 1, heightCm: 170, weightKg: 60, checkDate: "2026-10-12" }], s, "2026-10-20");
    expect(one.checks).toBe(1);
    expect(one.lastCheckDate).toBe("2026-10-12");
    expect(one.nextCheck).toBe("2026-10-26");
    expect(one.heightRequirement).not.toBeUndefined();
  });
});

describe("slot status line and order", () => {
  // A check is due by the end of its 14-day window: never checked → due 25 Okt (late on 3 Nov);
  // checked 12 Okt → next window 26 Okt–8 Nov (5 days left); checked 1 Nov → next 15 Nov.
  const today = "2026-11-03";
  const row = (period: number, checkDate: string): BmiCheckRow => ({
    staffCode: "X",
    period,
    heightCm: 170,
    weightKg: 60,
    checkDate,
  });
  const checked = bmiSummary([row(1, "2026-10-12")], s, today);
  const never = bmiSummary([], s, today);
  const scheduled = bmiSummary([row(1, "2026-11-01")], s, today);

  test("checked in the slot", () => {
    expect(slotStatusLine(checked.periods[0], checked, today)).toEqual({ text: "Sudah dicek · 12 Okt", tone: "good" });
  });

  test("late, due soon and scheduled", () => {
    expect(slotStatusLine(never.periods[1], never, today)).toEqual({ text: "Belum dicek · terlambat 9 hari", tone: "critical" });
    expect(slotStatusLine(checked.periods[1], checked, today)).toEqual({
      text: "Belum dicek · jatuh tempo 5 hari lagi",
      tone: "warning",
    });
    expect(slotStatusLine(scheduled.periods[1], scheduled, today)).toEqual({
      text: "Belum dicek · cek berikutnya 15 Nov",
      tone: "neutral",
    });
  });

  test("late first, then due soon, then the rest", () => {
    const items = [
      { id: "scheduled", s: scheduled },
      { id: "checked", s: checked },
      { id: "never", s: never },
    ];
    expect(dueFirst(items, (i) => i.s, 2).map((i) => i.id)).toEqual(["never", "checked", "scheduled"]);
  });
});
