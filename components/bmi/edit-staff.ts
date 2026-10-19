import type { StaffInput, StaffSaveResult } from "@/components/staff/actions";
import type { LinkError } from "@/lib/workspace/errors";
import { checkNameAndNipp } from "./add-staff";

/** What the "Edit Profil" dialog sends: the three things a person's profile lets you correct. */
export type EditBmiStaffInput = {
  /** ID SDM of the person being edited. It is the key and never changes. */
  code: string;
  name: string;
  /** NIPP (No Pegawai). */
  employeeNo: string;
  /** null leaves the L/P column empty. */
  gender: "L" | "P" | null;
};

/** The values as stored, so the screen can show them at once. */
export type EditBmiStaffResult =
  | { ok: true; name: string; employeeNo: string | null; gender: "L" | "P" | null }
  | { ok: false; error: LinkError };

/** The stored staff row the save starts from: everything the form does not touch is sent back as it is. */
export type EditableStaff = {
  code: string;
  station: string | null;
  name: string | null;
  employeeNo: string | null;
  gender: string | null;
};

export type EditBmiStaffPorts = {
  /** The staff the verified access may see, loaded on the server (never from the form). */
  load: () => Promise<EditableStaff[] | null>;
  saveStaff: (input: StaffInput) => Promise<StaffSaveResult>;
};

function invalid(field: string, message: string): LinkError {
  return { code: "invalid_input", field, message };
}

/** Name, NIPP and L/P. null when fine. */
export function checkEditBmiStaff(input: EditBmiStaffInput): LinkError | null {
  if (!input || typeof input !== "object" || typeof input.code !== "string" || input.code.trim() === "") {
    return invalid("staff_code", "Data SDM tidak lengkap. Muat ulang halaman lalu coba lagi.");
  }
  const identity = checkNameAndNipp(input.name, input.employeeNo);
  if (identity) return identity;
  if (input.gender !== null && input.gender !== "L" && input.gender !== "P") return invalid("gender", "Pilih L, P, atau kosongkan.");
  return null;
}

/**
 * Saves a corrected profile. The person must be one the access can see; pd_share_save_staff
 * changes only the fields it is given (name, NIPP, L/P), so the rest of the row stays as it is.
 */
export async function editBmiStaff(input: EditBmiStaffInput, ports: EditBmiStaffPorts): Promise<EditBmiStaffResult> {
  const problem = checkEditBmiStaff(input);
  if (problem) return { ok: false, error: problem };
  const staff = await ports.load();
  if (!staff) {
    return {
      ok: false,
      error: { code: "unauthorized", message: "Akses ini tidak bisa diperiksa. Muat ulang halaman, lalu coba lagi." },
    };
  }
  const current = staff.find((s) => s.code === input.code);
  if (!current) {
    return { ok: false, error: { code: "out_of_scope", message: "SDM ini tidak ada lagi. Muat ulang halaman." } };
  }

  const employeeNo = input.employeeNo.trim();
  const profile: StaffInput = {
    code: current.code,
    station: null,
    name: input.name.trim(),
    nipp: employeeNo,
    gender: input.gender,
  };

  try {
    const saved = await ports.saveStaff(profile);
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, name: profile.name, employeeNo: employeeNo || null, gender: input.gender };
  } catch {
    return { ok: false, error: { code: "unknown", message: "Koneksi terputus. Hasil penyimpanan belum bisa dipastikan." } };
  }
}
