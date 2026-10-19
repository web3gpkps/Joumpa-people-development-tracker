import { describe, expect, test } from "bun:test";
import type { StaffInput } from "@/components/staff/actions";
import { checkEditBmiStaff, editBmiStaff, type EditableStaff, type EditBmiStaffInput, type EditBmiStaffPorts } from "./edit-staff";

const stored: EditableStaff = {
  code: "TMB-01", station: "SUB", name: "Petugas Uji", employeeNo: "10001", gender: "L",
};
const input: EditBmiStaffInput = { code: "TMB-01", name: "  Petugas Benar ", employeeNo: " 10002 ", gender: "P" };

function harness(staff: EditableStaff[] | null = [stored]) {
  const sent: StaffInput[] = [];
  const ports: EditBmiStaffPorts = {
    load: async () => staff,
    saveStaff: async (profile) => {
      sent.push(profile);
      return { ok: true, code: profile.code ?? "", name: profile.name, savedAt: "2026-10-15T00:00:00Z" };
    },
  };
  return { sent, ports };
}

describe("editing a profile from Cek BMI", () => {
  test("changes name, NIPP and L/P only", async () => {
    const h = harness();
    expect(await editBmiStaff(input, h.ports)).toEqual({ ok: true, name: "Petugas Benar", employeeNo: "10002", gender: "P" });
    expect(h.sent).toEqual([
      { code: "TMB-01", station: null, name: "Petugas Benar", nipp: "10002", gender: "P" },
    ]);
  });

  test("an emptied NIPP and L/P are saved as empty", async () => {
    const h = harness();
    expect(await editBmiStaff({ ...input, employeeNo: "  ", gender: null }, h.ports)).toMatchObject({ ok: true, employeeNo: null, gender: null });
    expect(h.sent[0]).toMatchObject({ nipp: "", gender: null });
  });

  test("a person the access cannot see is never saved", async () => {
    const h = harness([]);
    expect(await editBmiStaff(input, h.ports)).toMatchObject({ ok: false, error: { code: "out_of_scope" } });
    expect(h.sent).toEqual([]);
    const unknown = harness(null);
    expect(await editBmiStaff(input, unknown.ports)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  test("checks the inputs before loading anything", () => {
    expect(checkEditBmiStaff({ ...input, name: " " })?.field).toBe("name");
    expect(checkEditBmiStaff({ ...input, name: "x".repeat(201) })?.field).toBe("name");
    expect(checkEditBmiStaff({ ...input, name: "Dua\nbaris" })?.field).toBe("name");
    expect(checkEditBmiStaff({ ...input, employeeNo: "1".repeat(51) })?.field).toBe("employee_no");
    expect(checkEditBmiStaff({ ...input, gender: "X" as "L" })?.field).toBe("gender");
    expect(checkEditBmiStaff({ ...input, code: "" })?.field).toBe("staff_code");
    expect(checkEditBmiStaff(input)).toBeNull();
  });
});
