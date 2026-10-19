import { describe, expect, test } from "bun:test";
import { ACCOUNT_ACCESS, navSections, OWNER_ACCESS } from "@/lib/workspace/access";
import {
  BRANCH_BMI_MENU_LABEL,
  branchAccountNavigation,
  branchMayOpen,
  bmiPeriodView,
  isBranchAccount,
  isBranchScope,
} from "./branch-scope";

describe("Cek BMI period view", () => {
  test("every access opens on all periods and can switch to the chosen one", () => {
    expect(bmiPeriodView(undefined).allSlots).toBe(true);
    expect(bmiPeriodView("1").allSlots).toBe(true);
    expect(bmiPeriodView("0").allSlots).toBe(false);
  });
  test("the label is Cek and the query keeps the default out of the URL", () => {
    expect(bmiPeriodView(undefined).label).toBe("Cek");
    expect(bmiPeriodView(undefined).query(true)).toBeNull();
    expect(bmiPeriodView(undefined).query(false)).toBe(0);
  });
});

describe("single-station scope", () => {
  const ws = { isKps: false, isOwner: false };

  test("station links and station accounts; never KPS or the owner", () => {
    expect(isBranchScope({ kind: "link" }, ws)).toBe(true);
    expect(isBranchScope({ kind: "account" }, ws)).toBe(true);
    expect(isBranchScope({ kind: "link" }, { ...ws, isKps: true })).toBe(false);
    expect(isBranchScope({ kind: "account" }, { ...ws, isKps: true })).toBe(false);
    expect(isBranchScope({ kind: "owner" }, ws)).toBe(false);
    expect(isBranchScope({ kind: "link" }, { ...ws, isOwner: true })).toBe(false);
  });

  test("a branch account is an account of one station", () => {
    expect(isBranchAccount({ kind: "account" }, ws)).toBe(true);
    expect(isBranchAccount({ kind: "link" }, ws)).toBe(false);
    expect(isBranchAccount({ kind: "account" }, { ...ws, isKps: true })).toBe(false);
  });

  test("it may open Rencana Aksi and Cek BMI only", () => {
    expect(branchMayOpen("rencanaAksi")).toBe(true);
    expect(branchMayOpen("bmi")).toBe(true);
    for (const key of ["dashboard", "trackerStaf", "penggantian", "laporanBulanan"] as const) {
      expect(branchMayOpen(key)).toBe(false);
    }
  });

  test("its menu holds exactly those two pages", () => {
    const keys = navSections({ kind: "link", basePath: "/s/x" }, { branchOnly: true }).flatMap((s) => s.items.map((i) => i.key));
    expect(keys).toEqual(["rencanaAksi", "bmi"]);
  });

  test("KPS and the owner see every page; only the owner sees Pengelolaan", () => {
    const kps = navSections(ACCOUNT_ACCESS).flatMap((s) => s.items.map((i) => i.key));
    expect(kps).toEqual(["dashboard", "laporanBulanan", "rencanaAksi", "bmi", "trackerStaf", "penggantian"]);
    const owner = navSections(OWNER_ACCESS).flatMap((s) => s.items.map((i) => i.key));
    expect(owner).toContain("sinkronisasi");
    expect(kps).not.toContain("sinkronisasi");
  });

  test("a branch account's Cek BMI keeps v1's name; the original sections are untouched", () => {
    const original = navSections(ACCOUNT_ACCESS, { branchOnly: true });
    const before = JSON.stringify(original);
    const renamed = branchAccountNavigation(original).flatMap((s) => s.items);
    expect(renamed.find((i) => i.key === "bmi")?.label).toBe(BRANCH_BMI_MENU_LABEL);
    expect(renamed.find((i) => i.key === "rencanaAksi")?.label).toBe("Rencana Aksi");
    expect(JSON.stringify(original)).toBe(before);
  });
});
