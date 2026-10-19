import { describe, expect, test } from "bun:test";
import type { StaffInput } from "@/components/staff/actions";
import type { BmiCheckInput, BmiProfileInput } from "./actions";
import { addBmiStaff, checkAddBmiStaff, resolveStation, type AddBmiStaffInput, type AddBmiStaffPorts, type AddBmiStaffWorkspace } from "./add-staff";

const station: AddBmiStaffWorkspace = {
  kind: "link", scope: "SUB", isKps: false, isOwner: false, stations: ["SUB"], periods: 5, staff: [],
};
const kps: AddBmiStaffWorkspace = { ...station, kind: "owner", scope: "KPS", isKps: true, isOwner: true, stations: ["SUB", "DPS"] };

const input: AddBmiStaffInput = {
  name: " Petugas Baru ",
  employeeNo: " 20001 ",
  gender: "L",
  bmiNote: "",
  station: "DPS",
  firstCheck: { period: 2, checkDate: "2026-10-26", heightCm: 170, weightKg: 70 },
  savedCode: null,
};

function harness(workspace: AddBmiStaffWorkspace | null = station, fail: Partial<Record<"staff" | "profile" | "check", true>> = {}) {
  const staff: StaffInput[] = [];
  const profiles: BmiProfileInput[] = [];
  const checks: BmiCheckInput[] = [];
  const ports: AddBmiStaffPorts = {
    load: async () => workspace,
    saveStaff: async (s) => {
      staff.push(s);
      return fail.staff
        ? { ok: false, error: { code: "invalid_input", field: "name", message: "Nama ditolak." } }
        : { ok: true, code: "TMB-07", name: s.name, savedAt: "2026-10-15T00:00:00Z" };
    },
    saveProfile: async (p) => {
      profiles.push(p);
      return fail.profile ? { ok: false, error: { code: "unknown", message: "gagal" } } : { ok: true, deleted: false, savedAt: "x" };
    },
    saveCheck: async (c) => {
      checks.push(c);
      return fail.check ? { ok: false, error: { code: "invalid_input", field: "height_cm", message: "Tinggi 120 sampai 210 cm." } } : { ok: true, deleted: false, savedAt: "x" };
    },
  };
  return { staff, profiles, checks, ports };
}

describe("add staff to a single-station access", () => {
  test("creates the staff member, the profile and the first check, at its own station", async () => {
    const h = harness();
    expect(await addBmiStaff(input, h.ports)).toEqual({ ok: true, code: "TMB-07" });
    expect(h.staff).toEqual([
      { code: null, station: "SUB", name: "Petugas Baru", nipp: "20001", gender: "L" },
    ]);
    expect(h.profiles).toEqual([{ staffCode: "TMB-07", gender: "L", bmiNote: null }]);
    expect(h.checks).toEqual([{ staffCode: "TMB-07", period: 2, checkDate: "2026-10-26", heightCm: 170, weightKg: 70 }]);
  });

  test("the first check may be omitted, and may be the first period", async () => {
    const none = harness();
    expect(await addBmiStaff({ ...input, firstCheck: null }, none.ports)).toEqual({ ok: true, code: "TMB-07" });
    expect(none.checks).toEqual([]);
    const first = harness();
    expect(await addBmiStaff({ ...input, firstCheck: { ...input.firstCheck!, period: 1 } }, first.ports)).toMatchObject({ ok: true });
    expect(first.checks[0].period).toBe(1);
  });

  test("an unverifiable access cannot add anything", async () => {
    const h = harness(null);
    expect(await addBmiStaff(input, h.ports)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(h.staff).toEqual([]);
  });
});

describe("add staff to a KPS or owner access", () => {
  test("must pick one of the workspace stations", async () => {
    const h = harness(kps);
    expect(await addBmiStaff(input, h.ports)).toMatchObject({ ok: true });
    expect(h.staff[0].station).toBe("DPS");
    for (const bad of [null, "", "KNO"]) {
      const r = harness(kps);
      expect(await addBmiStaff({ ...input, station: bad }, r.ports)).toMatchObject({ ok: false, error: { field: "station" } });
      expect(r.staff).toEqual([]);
    }
  });

  test("resolveStation: a single station ignores the request", () => {
    expect(resolveStation(station, "DPS")).toEqual({ ok: true, station: "SUB" });
    expect(resolveStation(kps, "SUB")).toEqual({ ok: true, station: "SUB" });
  });
});

describe("validation and retries", () => {
  test("inputs are checked before anything is written", () => {
    expect(checkAddBmiStaff({ ...input, name: "" }, 5)?.field).toBe("name");
    expect(checkAddBmiStaff({ ...input, employeeNo: "1".repeat(51) }, 5)?.field).toBe("employee_no");
    expect(checkAddBmiStaff({ ...input, gender: "X" as "L" }, 5)?.field).toBe("gender");
    expect(checkAddBmiStaff({ ...input, bmiNote: "x".repeat(2001) }, 5)?.field).toBe("bmi_note");
    expect(checkAddBmiStaff({ ...input, firstCheck: { ...input.firstCheck!, period: 6 } }, 5)?.field).toBe("period");
    expect(checkAddBmiStaff({ ...input, firstCheck: { ...input.firstCheck!, period: 0 } }, 5)?.field).toBe("period");
    expect(checkAddBmiStaff({ ...input, firstCheck: { ...input.firstCheck!, heightCm: 119 } }, 5)?.field).toBe("height_cm");
    expect(checkAddBmiStaff({ ...input, firstCheck: { ...input.firstCheck!, weightKg: 70.25 } }, 5)?.field).toBe("weight_kg");
    expect(checkAddBmiStaff({ ...input, firstCheck: { ...input.firstCheck!, checkDate: "0002-01-01" } }, 5)?.field).toBe("check_date");
    expect(checkAddBmiStaff({ ...input, firstCheck: { ...input.firstCheck!, period: 52 } }, 52)).toBeNull();
  });

  test("a failed first check is reported with the saved code, and a retry does not insert twice", async () => {
    const h = harness(station, { check: true });
    expect(await addBmiStaff(input, h.ports)).toMatchObject({ ok: false, code: "TMB-07" });
    const retry = harness({ ...station, staff: [{ code: "TMB-07", name: "Petugas Baru", employeeNo: "20001", station: "SUB" }] });
    expect(await addBmiStaff({ ...input, savedCode: "TMB-07" }, retry.ports)).toEqual({ ok: true, code: "TMB-07" });
    expect(retry.staff).toEqual([]);
  });

  test("a retry cannot target another person or station", async () => {
    const other = harness({ ...station, staff: [{ code: "TMB-07", name: "Orang Lain", employeeNo: "20001", station: "SUB" }] });
    expect(await addBmiStaff({ ...input, savedCode: "TMB-07" }, other.ports)).toMatchObject({ ok: false, error: { code: "out_of_scope" } });
    expect(other.profiles).toEqual([]);
  });

  test("a refused insert never writes the profile or a check", async () => {
    const h = harness(station, { staff: true });
    expect(await addBmiStaff(input, h.ports)).toMatchObject({ ok: false, error: { field: "name" } });
    expect(h.profiles).toEqual([]);
    expect(h.checks).toEqual([]);
  });
});
