import { describe, expect, test } from "bun:test";
import { bmiScheduleLine, bmiScheduleSummary, nextBmiCheck, type BmiScheduleRow } from "./programme-calendar";

// Parameter BMI defaults: 5 checks every 14 days from Mon 12 Okt 2026.
const schedule: BmiScheduleRow = { bmi_first_check: "2026-10-12", bmi_interval_days: 14, bmi_periods: 5 };

describe("BMI schedule", () => {
  test("the next check on or after today", () => {
    expect(nextBmiCheck(schedule, "2026-10-01")).toEqual({ period: 1, date: "2026-10-12" });
    expect(nextBmiCheck(schedule, "2026-10-13")).toEqual({ period: 2, date: "2026-10-26" });
    expect(nextBmiCheck(schedule, "2026-12-08")).toBeNull();
  });

  test("one short line for the shell", () => {
    expect(bmiScheduleLine(schedule, "2026-10-19")).toBe("Cek BMI ke-2: 26 Okt");
    expect(bmiScheduleLine(schedule, "2026-10-26")).toBe("Cek BMI ke-2 hari ini");
    expect(bmiScheduleLine(schedule, "2026-12-20")).toBe("Cek BMI ke-5 sudah lewat");
  });

  test("a sentence for the dashboard", () => {
    expect(bmiScheduleSummary(schedule, "2026-10-19")).toBe("Cek BMI berikutnya: ke-2 dari 5, Senin, 26 Okt 2026.");
  });
});
