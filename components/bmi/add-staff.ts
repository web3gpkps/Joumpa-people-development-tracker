import type { StaffInput, StaffSaveResult } from "@/components/staff/actions";
import type { BmiActionResult, BmiCheckInput, BmiProfileInput } from "./actions";
import type { LinkError } from "@/lib/workspace/errors";
import { bmiCheckName } from "@/lib/bmi-periods";
import { isPlausibleDate } from "./format";

export type AddBmiStaffInput = {
  name: string;
  /** NIPP (No Pegawai); empty leaves it blank. */
  employeeNo: string;
  gender: "L" | "P";
  bmiNote: string;
  /**
   * Only read for an owner or KPS access, which must pick one station. A single-station access
   * (link or account) always adds to its own verified station and ignores this.
   */
  station?: string | null;
  firstCheck: { period: number; checkDate: string; heightCm: number; weightKg: number } | null;
  savedCode: string | null;
};

export type AddBmiStaffResult =
  | { ok: true; code: string }
  | { ok: false; error: LinkError; code?: string; uncertain?: boolean };

/** What the action knows about the verified access, loaded on the server (never from the form). */
export type AddBmiStaffWorkspace = {
  kind: "link" | "account" | "owner";
  scope: string;
  isKps: boolean;
  isOwner: boolean;
  /** Station codes of the workspace: the choices of an owner or KPS access. */
  stations: string[];
  /** Number of BMI periods in Parameter. */
  periods: number;
  staff: Array<{ code: string; name: string | null; employeeNo: string | null; station: string | null }>;
};

export type AddBmiStaffPorts = {
  load: () => Promise<AddBmiStaffWorkspace | null>;
  saveStaff: (input: StaffInput) => Promise<StaffSaveResult>;
  saveProfile: (input: BmiProfileInput) => Promise<BmiActionResult>;
  saveCheck: (input: BmiCheckInput) => Promise<BmiActionResult>;
};

function invalid(field: string, message: string): LinkError {
  return { code: "invalid_input", field, message };
}

/** True when the text has a line break, tab or other control code, which a one-line cell cannot show. */
export function hasControlCode(text: string): boolean {
  return [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

/** Name and NIPP as Master SDM holds them. null when fine. */
export function checkNameAndNipp(name: unknown, employeeNo: unknown): LinkError | null {
  if (typeof name !== "string" || name.trim() === "") return invalid("name", "Nama wajib diisi.");
  if (name.trim().length > 200) return invalid("name", "Nama paling panjang 200 karakter.");
  if (hasControlCode(name.trim())) return invalid("name", "Nama ditulis dalam satu baris.");
  if (typeof employeeNo !== "string" || employeeNo.trim().length > 50) {
    return invalid("employee_no", "NIPP paling panjang 50 karakter.");
  }
  return null;
}

/**
 * The station a new SDM goes to. A single-station access (link or account) gets its own
 * verified scope; an owner or KPS access must name one of the workspace's stations.
 */
export function resolveStation(
  workspace: Pick<AddBmiStaffWorkspace, "scope" | "isKps" | "isOwner" | "stations">,
  requested: string | null | undefined,
): { ok: true; station: string } | { ok: false; error: LinkError } {
  if (!workspace.isKps && !workspace.isOwner) return { ok: true, station: workspace.scope };
  const code = typeof requested === "string" ? requested.trim() : "";
  if (code && workspace.stations.includes(code)) return { ok: true, station: code };
  return { ok: false, error: invalid("station", "Pilih stasiun untuk SDM ini.") };
}

/** `periods` is the number of checks in Parameter (settings.bmiPeriods). */
export function checkAddBmiStaff(input: AddBmiStaffInput, periods: number): LinkError | null {
  if (!input || typeof input !== "object") return invalid("name", "Isian tidak lengkap.");
  const identity = checkNameAndNipp(input.name, input.employeeNo);
  if (identity) return identity;
  if (input.gender !== "L" && input.gender !== "P") return invalid("gender", "Pilih L atau P.");
  if (typeof input.bmiNote !== "string" || input.bmiNote.length > 2000) {
    return invalid("bmi_note", "Catatan paling panjang 2000 karakter.");
  }
  if (input.savedCode !== null && (typeof input.savedCode !== "string" || !input.savedCode.trim())) {
    return invalid("staff_code", "ID SDM tidak valid.");
  }
  if (input.firstCheck !== null) {
    const check = input.firstCheck;
    if (!check || !Number.isInteger(check.period) || check.period < 1 || check.period > periods) {
      return invalid("period", `Pilih ${bmiCheckName(1)} sampai ${bmiCheckName(periods)}.`);
    }
    if (typeof check.checkDate !== "string" || !isPlausibleDate(check.checkDate)) {
      return invalid("check_date", "Tanggal cek tidak valid.");
    }
    if (!Number.isFinite(check.heightCm) || check.heightCm < 120 || check.heightCm > 210) {
      return invalid("height_cm", "Tinggi 120 sampai 210 cm.");
    }
    if (!Number.isFinite(check.weightKg) || check.weightKg < 30 || check.weightKg > 200) {
      return invalid("weight_kg", "Berat 30 sampai 200 kg.");
    }
    if (Math.round(check.heightCm * 10) / 10 !== check.heightCm) {
      return invalid("height_cm", "Cukup satu angka di belakang koma.");
    }
    if (Math.round(check.weightKg * 10) / 10 !== check.weightKg) {
      return invalid("weight_kg", "Cukup satu angka di belakang koma.");
    }
  }
  return null;
}

function staffInput(input: AddBmiStaffInput, station: string): StaffInput {
  return {
    code: null,
    station,
    name: input.name.trim(),
    nipp: input.employeeNo.trim(),
    gender: input.gender,
  };
}

export async function addBmiStaff(input: AddBmiStaffInput, ports: AddBmiStaffPorts): Promise<AddBmiStaffResult> {
  const workspace = await ports.load();
  if (!workspace) {
    return {
      ok: false,
      error: { code: "unauthorized", message: "Akses ini tidak bisa diperiksa. Muat ulang halaman, lalu coba lagi." },
    };
  }
  const problem = checkAddBmiStaff(input, workspace.periods);
  if (problem) return { ok: false, error: problem };
  const target = resolveStation(workspace, input.station);
  if (!target.ok) return { ok: false, error: target.error };
  const station = target.station;

  let code = input.savedCode ?? undefined;
  if (code) {
    const saved = workspace.staff.find((staff) => staff.code === code && staff.station === station);
    if (!saved || saved.name !== input.name.trim() || (saved.employeeNo ?? "") !== input.employeeNo.trim()) {
      return { ok: false, error: { code: "out_of_scope", message: "Data SDM tidak sesuai. Muat ulang halaman." } };
    }
  }
  try {
    if (!code) {
      const staff = await ports.saveStaff(staffInput(input, station));
      if (!staff.ok) return { ok: false, error: staff.error };
      code = staff.code;
      if (!code) throw new Error("missing saved code");
    }
    const profile = await ports.saveProfile({
      staffCode: code,
      gender: input.gender,
      bmiNote: input.bmiNote.trim() || null,
    });
    if (!profile.ok) return { ok: false, error: profile.error, code };
    if (input.firstCheck) {
      const check = await ports.saveCheck({ staffCode: code, ...input.firstCheck });
      if (!check.ok) return { ok: false, error: check.error, code };
    }
    return { ok: true, code };
  } catch {
    return {
      ok: false,
      code,
      uncertain: !code,
      error: { code: "unknown", message: "Koneksi terputus. Hasil penyimpanan belum bisa dipastikan." },
    };
  }
}
