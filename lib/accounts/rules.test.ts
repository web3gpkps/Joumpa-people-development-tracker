import { describe, expect, test } from "bun:test";
import {
  branchLabel,
  branchOptions,
  cleanRegistration,
  isAccountStatus,
  safeCallbackPath,
  safeNextPath,
  validateRegistration,
} from "./rules";

const STATIONS = ["CGK", "DPS", "SUB"];
const good = cleanRegistration({
  fullName: "  Budi   Santoso ",
  email: " budi@example.com ",
  branch: "dps",
  password: "kata-sandi-1",
  confirm: "kata-sandi-1",
});

describe("registration rules", () => {
  test("cleaning trims names and e-mail, upper-cases the branch and keeps the password as typed", () => {
    expect(good).toEqual({
      fullName: "Budi Santoso",
      email: "budi@example.com",
      branch: "DPS",
      password: "kata-sandi-1",
      confirm: "kata-sandi-1",
    });
    expect(cleanRegistration({ password: "  spasi  " }).password).toBe("  spasi  ");
    expect(cleanRegistration({ fullName: 5, email: null }).fullName).toBe("");
  });

  test("a complete sign-up has no errors", () => {
    expect(validateRegistration(good, branchOptions(STATIONS))).toEqual({});
  });

  test("KPS is a valid branch, an unknown or empty branch is not", () => {
    expect(validateRegistration({ ...good, branch: "KPS" }, branchOptions(STATIONS))).toEqual({});
    expect(validateRegistration({ ...good, branch: "ZZZ" }, branchOptions(STATIONS)).branch).toBeDefined();
    expect(validateRegistration({ ...good, branch: "UNASSIGNED" }, branchOptions(STATIONS)).branch).toBeDefined();
    expect(validateRegistration({ ...good, branch: "" }, branchOptions(STATIONS)).branch).toBe("Pilih cabang Anda.");
  });

  test("each field reports its own error", () => {
    const errors = validateRegistration(
      { fullName: "Bu", email: "bukan-email", branch: "", password: "pendek", confirm: "lain" },
      branchOptions(STATIONS),
    );
    expect(Object.keys(errors).sort()).toEqual(["branch", "email", "fullName", "password"]);
  });

  test("the confirmation is compared only once the password itself is acceptable", () => {
    expect(validateRegistration({ ...good, confirm: "beda-sekali" }, branchOptions(STATIONS)).confirm).toBeDefined();
    expect(validateRegistration({ ...good, password: "x", confirm: "y" }, branchOptions(STATIONS)).confirm).toBeUndefined();
  });

  test("the password limit counts bytes, because bcrypt ignores the rest", () => {
    const long = "a".repeat(73);
    expect(validateRegistration({ ...good, password: long, confirm: long }, branchOptions(STATIONS)).password).toBeDefined();
    const wide = "é".repeat(37); // 74 bytes, 37 characters
    expect(validateRegistration({ ...good, password: wide, confirm: wide }, branchOptions(STATIONS)).password).toBeDefined();
    const ok = "a".repeat(72);
    expect(validateRegistration({ ...good, password: ok, confirm: ok }, branchOptions(STATIONS))).toEqual({});
  });

  test("branch options put KPS first and never twice", () => {
    expect(branchOptions(["CGK", "KPS", "DPS"])).toEqual(["KPS", "CGK", "DPS"]);
    expect(branchLabel("KPS")).toContain("semua stasiun");
    expect(branchLabel("CGK")).toBe("Stasiun CGK");
  });
});

describe("account status", () => {
  test("only the three known statuses pass", () => {
    for (const s of ["pending", "active", "inactive"]) expect(isAccountStatus(s)).toBe(true);
    for (const s of ["admin", "", null, undefined, 1]) expect(isAccountStatus(s)).toBe(false);
  });
});

describe("redirect targets", () => {
  test("stay inside the area of the signed-in role", () => {
    expect(safeNextPath("/admin/tautan", "/admin")).toBe("/admin/tautan");
    expect(safeNextPath("/admin?x=1", "/admin")).toBe("/admin?x=1");
    expect(safeNextPath("/cabang/bmi", "/cabang")).toBe("/cabang/bmi");
    expect(safeNextPath("/admin/tautan", "/cabang")).toBe("/cabang");
    expect(safeNextPath("/cabang/bmi", "/admin")).toBe("/admin");
  });

  test("refuse other sites, protocol-relative paths and control characters", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/admin//evil.example", "/admin/\\evil", "/admin/a\r\nb", "/login", "/s/abc", "", null, 3]) {
      expect(safeNextPath(bad, "/admin")).toBe("/admin");
    }
  });

  test("the recovery callback only continues to the reset page", () => {
    expect(safeCallbackPath("/reset-password")).toBe("/reset-password");
    for (const bad of ["/admin", "https://evil.example", "", undefined]) expect(safeCallbackPath(bad)).toBe("/login");
  });
});
