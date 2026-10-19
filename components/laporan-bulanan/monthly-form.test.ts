import { describe, expect, test } from "bun:test";
import { formFromRow, formToPatch } from "./monthly-form";
import type { MonthlyReportRow } from "./monthly-view";

const row: MonthlyReportRow = {
  key: "KNO|2026-10-01",
  reportGroup: "KNO",
  period: "2026-10-01",
  periodLabel: "Okt 2026",
  dueOn: "2026-11-05",
  receivedOn: null,
  activeStaff: 10,
  compliantStaff: 9,
  complaints: 0,
  responded: "Ya",
  satisfaction: 4.5,
  notes: null,
  changed: null,
};

describe("formFromRow", () => {
  test("numbers with a decimal comma, blanks empty", () => {
    expect(formFromRow(row)).toEqual({
      dueOn: "2026-11-05",
      receivedOn: "",
      activeStaff: "10",
      compliantStaff: "9",
      complaints: "0",
      responded: "Ya",
      satisfaction: "4,5",
      notes: "",
    });
  });
});

describe("formToPatch", () => {
  test("an untouched form changes nothing", () => {
    expect(formToPatch(row, formFromRow(row))).toEqual({ ok: true, patch: {} });
  });

  test("only changed fields, typed the Indonesian way", () => {
    const form = { ...formFromRow(row), receivedOn: "2026-11-04", satisfaction: "4,25", notes: " Dikirim lewat email " };
    expect(formToPatch(row, form)).toEqual({
      ok: true,
      patch: { receivedOn: "2026-11-04", satisfaction: 4.25, notes: "Dikirim lewat email" },
    });
  });

  test("emptying a field clears it", () => {
    expect(formToPatch(row, { ...formFromRow(row), responded: "", complaints: " " })).toEqual({
      ok: true,
      patch: { complaints: null, responded: null },
    });
  });

  test("every invalid field gets its own message", () => {
    const result = formToPatch(row, { ...formFromRow(row), activeStaff: "sepuluh", satisfaction: "5,5", complaints: "1,5" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["activeStaff", "complaints", "satisfaction"]);
  });

  test("compliant staff above active staff is refused", () => {
    const result = formToPatch(row, { ...formFromRow(row), compliantStaff: "11" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.compliantStaff).toContain("tidak boleh lebih");
  });
});
