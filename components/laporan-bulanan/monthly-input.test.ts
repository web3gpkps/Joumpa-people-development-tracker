import { describe, expect, test } from "bun:test";
import { checkMonthlyInput, compliantError, fieldOfColumn, isPeriod } from "./monthly-input";

const base = { reportGroup: "DPS", period: "2026-10-01" };

describe("checkMonthlyInput", () => {
  test("turns the patch into column names, only the keys sent", () => {
    const result = checkMonthlyInput({ ...base, patch: { receivedOn: "2026-11-04", activeStaff: 12, satisfaction: 4.5 } });
    expect(result).toEqual({
      ok: true,
      reportGroup: "DPS",
      period: "2026-10-01",
      patch: { received_on: "2026-11-04", active_staff: 12, satisfaction: 4.5 },
    });
  });

  test("null and blank text clear a cell; notes are trimmed", () => {
    const result = checkMonthlyInput({ ...base, patch: { dueOn: null, notes: "  ", responded: "" } });
    expect(result.ok && result.patch).toEqual({ due_on: null, notes: null, responded: null });
    const notes = checkMonthlyInput({ ...base, patch: { notes: "  Sudah dikirim  " } });
    expect(notes.ok && notes.patch).toEqual({ notes: "Sudah dikirim" });
  });

  test("an empty patch is a new report with nothing filled in yet", () => {
    expect(checkMonthlyInput({ ...base, patch: {} })).toMatchObject({ ok: true, patch: {} });
  });

  test("rejects values outside the database ranges, naming the column", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ activeStaff: -1 }, "active_staff"],
      [{ activeStaff: 2.5 }, "active_staff"],
      [{ complaints: 10001 }, "complaints"],
      [{ satisfaction: 5.01 }, "satisfaction"],
      [{ satisfaction: 4.255 }, "satisfaction"],
      [{ responded: "Mungkin" }, "responded"],
      [{ dueOn: "2026-02-30" }, "due_on"],
      [{ receivedOn: "05/11/2026" }, "received_on"],
      [{ notes: "x".repeat(4001) }, "notes"],
    ];
    for (const [patch, field] of cases) {
      const result = checkMonthlyInput({ ...base, patch });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe(field);
    }
  });

  test("rejects unknown keys, a missing Cabang and a period that is not a first day", () => {
    expect(checkMonthlyInput({ ...base, patch: { updatedAt: "x" } }).ok).toBe(false);
    expect(checkMonthlyInput({ ...base, reportGroup: " ", patch: {} }).ok).toBe(false);
    expect(checkMonthlyInput({ ...base, period: "2026-10-05", patch: {} }).ok).toBe(false);
    expect(checkMonthlyInput(null).ok).toBe(false);
  });

  test("compliant staff cannot exceed active staff when both are sent", () => {
    const result = checkMonthlyInput({ ...base, patch: { activeStaff: 10, compliantStaff: 11 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("compliant_staff");
    expect(checkMonthlyInput({ ...base, patch: { activeStaff: 10, compliantStaff: 10 } }).ok).toBe(true);
  });
});

describe("helpers", () => {
  test("isPeriod", () => {
    expect(isPeriod("2026-10-01")).toBe(true);
    expect(isPeriod("2026-13-01")).toBe(false);
    expect(isPeriod("2026-10")).toBe(false);
  });

  test("compliantError", () => {
    expect(compliantError(10, 11)).not.toBeNull();
    expect(compliantError(null, 11)).toBeNull();
    expect(compliantError(10, 9)).toBeNull();
  });

  test("fieldOfColumn", () => {
    expect(fieldOfColumn("compliant_staff")).toBe("compliantStaff");
    expect(fieldOfColumn("report_group")).toBeNull();
    expect(fieldOfColumn(undefined)).toBeNull();
  });
});
