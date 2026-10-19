import { describe, expect, test } from "bun:test";
import { accountCounts, approvalBranch, defaultTab, matchesSearch, needsBranch, rowsForTab, type AccountRow } from "./account-view";

const row = (id: string, status: AccountRow["status"], createdAt: string, extra: Partial<AccountRow> = {}): AccountRow => ({
  id,
  email: `${id}@example.invalid`,
  fullName: `Akun ${id}`,
  branchCode: "CGK",
  status,
  createdAt,
  decidedAt: null,
  ...extra,
});

const ROWS = [
  row("a", "pending", "2026-10-14T09:00:00Z"),
  row("b", "pending", "2026-10-13T09:00:00Z"),
  row("c", "active", "2026-10-01T09:00:00Z", { decidedAt: "2026-10-02T09:00:00Z" }),
  row("d", "active", "2026-10-03T09:00:00Z", { decidedAt: "2026-10-05T09:00:00Z" }),
  row("e", "inactive", "2026-09-30T09:00:00Z", { decidedAt: "2026-10-10T09:00:00Z" }),
];

describe("account approval view", () => {
  test("counts per status", () => {
    expect(accountCounts(ROWS)).toEqual({ pending: 2, active: 2, inactive: 1 });
    expect(accountCounts([])).toEqual({ pending: 0, active: 0, inactive: 0 });
  });

  test("waiting accounts oldest first, the others by latest decision", () => {
    expect(rowsForTab(ROWS, "pending").map((r) => r.id)).toEqual(["b", "a"]);
    expect(rowsForTab(ROWS, "active").map((r) => r.id)).toEqual(["d", "c"]);
    expect(rowsForTab(ROWS, "inactive").map((r) => r.id)).toEqual(["e"]);
  });

  test("does not reorder the input", () => {
    const before = ROWS.map((r) => r.id).join();
    rowsForTab(ROWS, "pending");
    expect(ROWS.map((r) => r.id).join()).toBe(before);
  });

  test("opens on the waiting tab only when something waits", () => {
    expect(defaultTab(ROWS)).toBe("pending");
    expect(defaultTab(ROWS.filter((r) => r.status !== "pending"))).toBe("active");
    expect(defaultTab([])).toBe("active");
  });

  test("an unassigned sign-up cannot be approved without a chosen branch", () => {
    const unassigned = { branchCode: "UNASSIGNED" };
    expect(needsBranch(unassigned)).toBe(true);
    expect(needsBranch({ branchCode: "SUB" })).toBe(false);
    expect(approvalBranch(unassigned, undefined)).toBeNull();
    expect(approvalBranch(unassigned, "")).toBeNull();
    expect(approvalBranch(unassigned, "UNASSIGNED")).toBeNull();
    expect(approvalBranch(unassigned, "dps")).toBe("DPS");
    expect(approvalBranch({ branchCode: "SUB" }, undefined)).toBe("SUB");
    expect(approvalBranch({ branchCode: "SUB" }, "KPS")).toBe("KPS");
  });

  test("search looks at name, e-mail and branch", () => {
    const r = row("x", "pending", "2026-10-14T09:00:00Z", { fullName: "Budi Santoso", branchCode: "DPS" });
    expect(matchesSearch(r, "")).toBe(true);
    expect(matchesSearch(r, "  budi ")).toBe(true);
    expect(matchesSearch(r, "x@example")).toBe(true);
    expect(matchesSearch(r, "dps")).toBe(true);
    expect(matchesSearch(r, "surabaya")).toBe(false);
  });
});
