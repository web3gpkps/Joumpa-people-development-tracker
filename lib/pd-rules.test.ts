import { describe, expect, test } from "bun:test";
import {
  areaProgress,
  daysLeft,
  dashboardKpis,
  groupProgress,
  groupTotal,
  monthlyCompliance,
  monthlyOnTime,
  monthlyTargetMet,
  parsePeriod,
  periodLabel,
  planFlag,
  reassessResult,
  replacementFlag,
  replacementNotRegistered,
  replacementPassed,
  staffFlag,
  type DashboardInput,
} from "./pd-rules";

const TODAY = "2026-10-19";

describe("Tracker Staf", () => {
  test("Hasil penilaian ulang: ≥ 4 Sesuai, below proposes a replacement, blank stays blank", () => {
    expect(reassessResult(null)).toBeNull();
    expect(reassessResult("")).toBeNull();
    expect(reassessResult(4)).toBe("Sesuai");
    expect(reassessResult("4.5")).toBe("Sesuai");
    expect(reassessResult(3.99)).toBe("Tidak Sesuai → usulan ganti");
  });

  test("Flag follows the workbook formula", () => {
    // Both actions done (Batal / N.A. counts).
    expect(staffFlag({ mainStatus: "Selesai", extraStatus: "Batal / N.A." }, TODAY)).toBe("Selesai");
    // Main action open and past its deadline.
    expect(staffFlag({ mainDue: "2026-10-18", mainStatus: "Proses", extraStatus: "Batal / N.A." }, TODAY)).toBe("Terlambat");
    // Extra action open and past its deadline, main fine.
    expect(staffFlag({ mainDue: "2026-11-13", mainStatus: "Belum Mulai", extraDue: "2026-10-01", extraStatus: "Belum Mulai" }, TODAY)).toBe("Terlambat");
    // A done action never makes the row late.
    expect(staffFlag({ mainDue: "2026-10-01", mainStatus: "Selesai", extraDue: "2026-12-01", extraStatus: "Proses" }, TODAY)).toBe("On track");
    // Due within 7 days (inclusive), and today itself.
    expect(staffFlag({ mainDue: "2026-10-26", mainStatus: "Belum Mulai" }, TODAY)).toBe("Jatuh tempo ≤ 7 hari");
    expect(staffFlag({ mainDue: TODAY, mainStatus: "Belum Mulai" }, TODAY)).toBe("Jatuh tempo ≤ 7 hari");
    expect(staffFlag({ mainDue: "2026-10-27", mainStatus: "Belum Mulai" }, TODAY)).toBe("On track");
    // Blank deadline: no deadline.
    expect(staffFlag({ mainStatus: "Belum Mulai" }, TODAY)).toBe("On track");
  });
});

describe("Penggantian SDM", () => {
  test("Lulus training? needs post-test ≥ 80 and practice ≥ 4", () => {
    expect(replacementPassed({ postTest: 80, practice: 4 })).toBe("Lulus");
    expect(replacementPassed({ postTest: 79.5, practice: 4.5 })).toBe("Belum lulus");
    expect(replacementPassed({ postTest: 90, practice: 3.83 })).toBe("Belum lulus");
    expect(replacementPassed({ postTest: 90, practice: null })).toBeNull();
  });

  test("Flag", () => {
    const base = { withdrawDue: "2026-10-31", trainingDue: "2026-11-15" };
    expect(replacementFlag({ ...base, withdrawStatus: "Belum Mulai" }, TODAY)).toBe("On track");
    expect(replacementFlag({ ...base, withdrawStatus: "Belum Mulai" }, "2026-10-24")).toBe("Jatuh tempo ≤ 7 hari");
    expect(replacementFlag({ ...base, withdrawStatus: "Proses" }, "2026-11-01")).toBe("Terlambat");
    // Withdrawn, replacement not on duty after the training deadline.
    expect(replacementFlag({ ...base, withdrawStatus: "Selesai" }, "2026-11-16")).toBe("Terlambat");
    expect(replacementFlag({ ...base, withdrawStatus: "Selesai", startedOn: "2026-11-10" }, "2026-11-16")).toBe("Selesai");
    // Cancelled (strong reminder kept on duty): done, also after 15 Nov.
    expect(replacementFlag({ ...base, withdrawStatus: "Batal / N.A." }, "2026-11-20")).toBe("Selesai");
  });

  test("a replacement name with no Tracker Staf row is flagged", () => {
    const staff = [{ name: "Budi  Santoso" }, { name: null }];
    expect(replacementNotRegistered({ replacementName: "budi santoso" }, staff)).toBe(false);
    expect(replacementNotRegistered({ replacementName: "Ani" }, staff)).toBe(true);
    expect(replacementNotRegistered({ replacementName: "  " }, staff)).toBe(false);
  });
});

describe("Rencana Aksi", () => {
  test("Flag", () => {
    expect(planFlag({ status: "Selesai", dueDate: "2026-10-01" }, TODAY)).toBe("Selesai");
    expect(planFlag({ status: "Batal / N.A." }, TODAY)).toBe("Selesai");
    expect(planFlag({ status: "Proses", dueDate: "2026-10-18" }, TODAY)).toBe("Terlambat");
    expect(planFlag({ status: "Belum Mulai", dueDate: "2026-10-31" }, TODAY)).toBe("On track");
    expect(planFlag({ status: "Belum Mulai", dueDate: "2026-10-24" }, TODAY)).toBe("Jatuh tempo ≤ 7 hari");
    expect(planFlag({ status: "Belum Mulai", dueDate: null }, TODAY)).toBe("On track");
  });
});

describe("Laporan Bulanan", () => {
  test("Tepat waktu?", () => {
    expect(monthlyOnTime({ dueOn: "2026-11-05" }, TODAY)).toBeNull();
    expect(monthlyOnTime({ dueOn: "2026-11-05" }, "2026-11-06")).toBe("Terlambat");
    expect(monthlyOnTime({ dueOn: "2026-11-05", receivedOn: "2026-11-05" }, "2026-12-01")).toBe("Ya");
    expect(monthlyOnTime({ dueOn: "2026-11-05", receivedOn: "2026-11-07" }, "2026-12-01")).toBe("Terlambat");
  });

  test("% Sesuai and the 90% target", () => {
    expect(monthlyCompliance({ activeStaff: 32, compliantStaff: 29 })).toBeCloseTo(0.90625);
    expect(monthlyTargetMet({ activeStaff: 32, compliantStaff: 29 })).toBe("Ya");
    expect(monthlyTargetMet({ activeStaff: 32, compliantStaff: 28 })).toBe("Belum");
    expect(monthlyCompliance({ activeStaff: 0, compliantStaff: 0 })).toBeNull();
    expect(monthlyCompliance({ activeStaff: 10, compliantStaff: null })).toBeNull();
  });

  test("periods read and print as in the sheet", () => {
    expect(periodLabel("2026-10-01")).toBe("Okt 2026");
    expect(periodLabel("2027-01-01")).toBe("Jan 2027");
    expect(parsePeriod("Okt 2026")).toBe("2026-10-01");
    expect(parsePeriod("Des 2026")).toBe("2026-12-01");
    expect(parsePeriod("desember 2026")).toBe("2026-12-01");
    expect(parsePeriod("Oct-2026")).toBe("2026-10-01");
    expect(parsePeriod("10/2026")).toBe("2026-10-01");
    expect(parsePeriod("13/2026")).toBeNull();
    expect(parsePeriod("bulan depan")).toBeNull();
  });
});

describe("Dashboard", () => {
  const input: DashboardInput = {
    groups: ["CGK & HLP", "DPS"],
    areas: ["Penggantian SDM", "BMI"],
    staff: [
      { reportGroup: "CGK & HLP", proposal: "Penggantian", mainDue: "2026-10-31", mainStatus: "Belum Mulai" },
      { reportGroup: "CGK & HLP", proposal: "Coaching intensif", reassessPractice: 4.2, mainStatus: "Selesai", extraStatus: "Batal / N.A." },
      { reportGroup: "DPS", proposal: "Coaching intensif", reassessPractice: 3.5, mainDue: "2026-10-01", mainStatus: "Proses" },
      { reportGroup: "DPS", proposal: "Pembinaan" },
    ],
    replacements: [
      { reportGroup: "CGK & HLP", withdrawStatus: "Selesai", withdrawDue: "2026-10-31", trainingDue: "2026-11-15" },
      { reportGroup: "DPS", withdrawStatus: "Belum Mulai", withdrawDue: "2026-10-10" },
    ],
    plans: [
      { reportGroup: "CGK & HLP", area: "Penggantian SDM", status: "Selesai", progress: 100, dueDate: "2026-10-31" },
      { reportGroup: "DPS", area: "Penggantian SDM", status: "Proses", progress: 50, dueDate: "2026-10-15" },
      { reportGroup: "DPS", area: "BMI", status: "Belum Mulai", progress: 0, dueDate: "2026-12-31" },
      { reportGroup: "DPS", area: "BMI", status: "Proses", progress: 80, dueDate: "2026-10-01", archivedAt: "2026-10-18T00:00:00Z" },
    ],
  };

  test("KPIs", () => {
    expect(dashboardKpis(input, TODAY)).toEqual({
      totalStaff: 4,
      replacementsDone: 1,
      replacements: 2,
      reassessed: 2,
      intensive: 2,
      compliance: 0.5,
      plansDone: 1 / 3,
      // staff DPS (main late) + replacement DPS (withdrawal late) + plan DPS (Proses, due 15 Okt); archived ignored
      late: 3,
    });
  });

  test("per Cabang, with the total row", () => {
    const rows = groupProgress(input, TODAY);
    expect(rows[0]).toEqual({
      group: "CGK & HLP",
      totalStaff: 2,
      proposedReplacement: 1,
      replacementDone: 1,
      intensive: 1,
      reassessed: 1,
      compliant: 1,
      notCompliant: 0,
      guidance: 0,
      completed: 1,
      completedShare: 0.5,
      late: 0,
    });
    expect(rows[1].late).toBe(3);
    expect(rows[1].notCompliant).toBe(1);
    const total = groupTotal(rows);
    expect(total.totalStaff).toBe(4);
    expect(total.completedShare).toBe(0.25);
  });

  test("per area", () => {
    const [repl, bmi] = areaProgress(input, TODAY);
    expect(repl).toEqual({
      area: "Penggantian SDM",
      rows: 2,
      done: 1,
      inProgress: 1,
      notStarted: 0,
      late: 1,
      avgProgress: 75,
      earliestDue: "2026-10-15",
    });
    expect(bmi.rows).toBe(1);
    expect(bmi.earliestDue).toBe("2026-12-31");
  });

  test("Sisa hari", () => {
    expect(daysLeft("2026-10-31", TODAY)).toBe(12);
    expect(daysLeft(TODAY, TODAY)).toBe(0);
    expect(daysLeft("2026-10-18", TODAY)).toBeNull();
  });
});
