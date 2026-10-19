import { describe, expect, test } from "bun:test";
import type { Workspace } from "@/lib/workspace";
import {
  applyFilters,
  currentPeriod,
  defaultDueOn,
  groupsWithReports,
  parseFilters,
  periodFromMonth,
  periodSummaries,
  periodsWithReports,
  satisfactionBelowTarget,
  toRows,
  yearOptions,
} from "./monthly-view";

const groups = ["CGK & HLP", "DPS", "SUB", "KNO", "BPN"];

type Report = Workspace["monthlyReports"][number];
const report = (over: Partial<Report>): Report =>
  ({
    reportGroup: "DPS",
    period: "2026-10-01",
    dueOn: "2026-11-05",
    receivedOn: null,
    activeStaff: null,
    compliantStaff: null,
    complaints: null,
    responded: null,
    satisfaction: null,
    notes: null,
    updatedAt: "2026-11-04T03:00:00Z",
    updatedByLink: null,
    ...over,
  }) as Report;

const ws = {
  linkId: "link-1",
  linkLabels: { "link-2": "KPS pusat" },
  monthlyReports: [
    report({ reportGroup: "SUB", period: "2026-10-01", receivedOn: "2026-11-04", activeStaff: 10, compliantStaff: 9, complaints: 1, responded: "Ya" }),
    report({ reportGroup: "DPS", period: "2026-10-01", receivedOn: "2026-11-07", activeStaff: 10, compliantStaff: 8, responded: "Belum" }),
    report({ reportGroup: "KNO", period: "2026-11-01", dueOn: "2026-12-05", updatedByLink: "link-2" }),
    report({ reportGroup: "CGK & HLP", period: "2026-10-01", updatedByLink: "link-1" }),
  ],
};

describe("toRows", () => {
  const rows = toRows(ws, groups);

  test("oldest period first (the next report due on top), then Cabang in station order", () => {
    expect(rows.map((r) => `${r.periodLabel} ${r.reportGroup}`)).toEqual([
      "Okt 2026 CGK & HLP",
      "Okt 2026 DPS",
      "Okt 2026 SUB",
      "Nov 2026 KNO",
    ]);
  });

  test("says who changed a row last", () => {
    expect(rows[3].changed).toStartWith("KPS pusat, ");
    expect(rows[0].changed).toStartWith("tautan ini, ");
    expect(rows[1].changed).toStartWith("pengelola, akun cabang, atau Google Sheet, ");
  });
});

describe("filters", () => {
  const rows = toRows(ws, groups);

  test("only values the rows hold are accepted", () => {
    expect(parseFilters(rows, "DPS", "2026-10")).toEqual({ group: "DPS", period: "2026-10-01" });
    expect(parseFilters(rows, "BPN", "2026-09")).toEqual({ group: null, period: null });
    expect(parseFilters(rows, undefined, "semua")).toEqual({ group: null, period: null });
  });

  test("applyFilters", () => {
    expect(applyFilters(rows, { group: null, period: "2026-10-01" })).toHaveLength(3);
    expect(applyFilters(rows, { group: "KNO", period: null }).map((r) => r.period)).toEqual(["2026-11-01"]);
  });

  test("filter options", () => {
    expect(groupsWithReports(rows, groups)).toEqual(["CGK & HLP", "DPS", "SUB", "KNO"]);
    expect(groupsWithReports(rows, ["DPS"])).toEqual(["DPS", "CGK & HLP", "KNO", "SUB"]);
    expect(periodsWithReports(rows)).toEqual(["2026-11-01", "2026-10-01"]);
  });
});

describe("periodSummaries", () => {
  test("received, on time, late and target per period, oldest first", () => {
    const [okt, nov] = periodSummaries(toRows(ws, groups), "2026-11-10");
    expect(nov).toMatchObject({ label: "Nov 2026", reports: 1, received: 0, onTime: 0, late: 0 });
    expect(okt).toMatchObject({
      label: "Okt 2026",
      reports: 3,
      received: 2,
      onTime: 1,
      // DPS came in late; CGK & HLP is still missing after 5 Nov.
      late: 2,
      measured: 2,
      targetMet: 1,
      complaints: 1,
      unresponded: 1,
    });
  });
});

describe("dates", () => {
  test("due on the 5th of the next month, across the year end", () => {
    expect(defaultDueOn("2026-10-01")).toBe("2026-11-05");
    expect(defaultDueOn("2026-12-01")).toBe("2027-01-05");
  });

  test("periodFromMonth and currentPeriod", () => {
    expect(periodFromMonth("2026-10")).toBe("2026-10-01");
    expect(periodFromMonth("2026-13")).toBeNull();
    expect(periodFromMonth("semua")).toBeNull();
    expect(currentPeriod("2026-10-19")).toBe("2026-10-01");
  });

  test("yearOptions spans last year to next year plus reported years", () => {
    expect(yearOptions("2026-10-19", [{ period: "2023-01-01" }])).toEqual(["2023", "2025", "2026", "2027"]);
  });
});

describe("satisfactionBelowTarget", () => {
  test("only KNO and BPN carry the 4,25 target", () => {
    expect(satisfactionBelowTarget({ reportGroup: "KNO" }, 4.2)).toBe(true);
    expect(satisfactionBelowTarget({ reportGroup: "KNO" }, 4.25)).toBe(false);
    expect(satisfactionBelowTarget({ reportGroup: "DPS" }, 3)).toBe(false);
    expect(satisfactionBelowTarget({ reportGroup: "BPN" }, null)).toBe(false);
  });
});
