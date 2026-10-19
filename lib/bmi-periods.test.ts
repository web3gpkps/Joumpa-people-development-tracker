import { describe, expect, test } from "bun:test";
import { bmiCheckLabel, bmiCheckLabels, bmiCheckName, bmiPeriodRange, formatPeriodRange } from "./bmi-periods";

const S = { bmiFirstCheck: "2026-10-12", bmiIntervalDays: 14, bmiPeriods: 6 };

describe("BMI check periods", () => {
  test("a period runs from its planned date to the day before the next one", () => {
    expect(bmiPeriodRange(1, S)).toEqual({ start: "2026-10-12", end: "2026-10-25" });
    expect(bmiPeriodRange(2, S)).toEqual({ start: "2026-10-26", end: "2026-11-08" });
    expect(bmiPeriodRange(6, S)).toEqual({ start: "2026-12-21", end: "2027-01-03" });
  });

  test("consecutive periods leave no gap and do not overlap, for any interval", () => {
    for (const bmiIntervalDays of [1, 7, 14, 30, 90]) {
      const s = { ...S, bmiIntervalDays };
      for (let p = 1; p < 8; p++) {
        const a = bmiPeriodRange(p, s);
        const b = bmiPeriodRange(p + 1, s);
        const nextDay = new Date(`${a.end}T00:00:00Z`).getTime() + 86400000;
        expect(new Date(`${b.start}T00:00:00Z`).getTime()).toBe(nextDay);
      }
    }
  });

  test("range text collapses what the two dates share", () => {
    expect(formatPeriodRange({ start: "2026-10-15", end: "2026-10-20" })).toBe("15-20 Oct 2026");
    expect(formatPeriodRange({ start: "2026-10-26", end: "2026-11-08" })).toBe("26 Oct-8 Nov 2026");
    expect(formatPeriodRange({ start: "2026-12-21", end: "2027-01-03" })).toBe("21 Dec 2026-3 Jan 2027");
    expect(formatPeriodRange({ start: "2026-10-15", end: "2026-10-15" })).toBe("15 Oct 2026");
  });

  test("labels name the check and its period", () => {
    expect(bmiCheckName(3)).toBe("BMI Cek ke-3");
    expect(bmiCheckLabel(1, S)).toBe("BMI Cek ke-1 (Periode 12-25 Oct 2026)");
    expect(bmiCheckLabel(3, S)).toBe("BMI Cek ke-3 (Periode 9-22 Nov 2026)");
    expect(bmiCheckLabel(2, { ...S, bmiIntervalDays: 7 })).toBe("BMI Cek ke-2 (Periode 19-25 Oct 2026)");
  });

  test("one label per check, following the settings", () => {
    const labels = bmiCheckLabels({ ...S, bmiPeriods: 8 });
    expect(labels).toHaveLength(8);
    expect(labels[7]).toBe("BMI Cek ke-8 (Periode 18-31 Jan 2027)");
    expect(bmiCheckLabels({ ...S, bmiPeriods: 1 })).toEqual(["BMI Cek ke-1 (Periode 12-25 Oct 2026)"]);
  });
});
