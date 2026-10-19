import { describe, expect, test } from "bun:test";
import { bmiCheckLabel, bmiCheckLabels, bmiCheckName, MAX_BMI_PERIODS } from "@/lib/bmi-periods";
import { DEFAULT_SETTINGS } from "@/lib/rules";
import { columnLetters, sheetColumnCount, sheetColumnRange } from "./labels";

const settings = { ...DEFAULT_SETTINGS, bmiFirstCheck: "2026-10-12", bmiIntervalDays: 14 };

describe("Cek BMI labels", () => {
  test("the screens name a check with the lead's helpers: short where space is tight, full otherwise", () => {
    expect(bmiCheckName(3)).toBe("BMI Cek ke-3");
    expect(bmiCheckLabel(3, settings)).toBe("BMI Cek ke-3 (Periode 9-22 Nov 2026)");
  });

  test("the labels follow the number of periods, up to the most the programme allows", () => {
    for (const periods of [1, 8, 26, MAX_BMI_PERIODS]) {
      const labels = bmiCheckLabels({ ...settings, bmiPeriods: periods });
      expect(labels).toHaveLength(periods);
      expect(labels[periods - 1].startsWith(`BMI Cek ke-${periods} (Periode `)).toBe(true);
      expect(new Set(labels).size).toBe(periods);
    }
  });

  test("column letters follow the spreadsheet", () => {
    expect(columnLetters(1)).toBe("A");
    expect(columnLetters(26)).toBe("Z");
    expect(columnLetters(27)).toBe("AA");
    expect(columnLetters(47)).toBe("AU");
    expect(columnLetters(702)).toBe("ZZ");
    expect(columnLetters(703)).toBe("AAA");
  });

  test("the tab grows by five columns for every period", () => {
    expect(sheetColumnCount(1)).toBe(17);
    expect(sheetColumnCount(8)).toBe(sheetColumnCount(7) + 5);
    expect(sheetColumnRange(5)).toBe("A–AK");
    expect(sheetColumnCount(MAX_BMI_PERIODS)).toBe(5 + 5 * MAX_BMI_PERIODS + 7);
    expect(sheetColumnRange(MAX_BMI_PERIODS)).toBe(`A–${columnLetters(sheetColumnCount(MAX_BMI_PERIODS))}`);
  });
});
