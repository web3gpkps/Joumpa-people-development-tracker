"use server";

import { refresh } from "next/cache";
import { resolveAccess, toLinkError, type LinkError } from "@/lib/workspace";

/** One staff member's identity (Tracker Staf + Cek BMI): what Cek BMI adds or corrects. */
export type StaffInput = {
  /** null adds a new staff member (the database assigns the station's next code, e.g. BPN-06). */
  code: string | null;
  /** New staff only. A station scope always adds to its own station; KPS must pick one. */
  station: string | null;
  name: string;
  nipp: string;
  gender: "L" | "P" | null;
};

export type StaffSaveResult =
  | { ok: true; code: string; name: string; savedAt: string }
  | { ok: false; error: LinkError };

function blankToNull(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
}

function invalid(field: string, message: string): StaffSaveResult {
  return { ok: false, error: { code: "invalid_input", field, message } };
}

/** pd_share_save_staff's field errors in the words of the form. */
function staffError(error: { message?: string; code?: string; details?: string | null }): LinkError {
  const linkError = toLinkError(error);
  if (linkError.code === "invalid_input" && linkError.field === "station") {
    return { ...linkError, message: "Pilih stasiun untuk SDM baru." };
  }
  if (linkError.code === "invalid_input" && linkError.field === "name") {
    return { ...linkError, message: "Nama wajib diisi, paling panjang 200 karakter." };
  }
  return linkError;
}

/**
 * Adds or corrects one staff member's name, NIPP and L/P (pd_share_save_staff). accessKey is
 * access.key (a link token, "account" or "owner"). The database enforces the scope: a station
 * scope adds to its own station only and cannot touch staff of another station.
 */
export async function saveStaff(accessKey: string, input: StaffInput): Promise<StaffSaveResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const name = blankToNull(input.name);
  if (!name) return invalid("name", "Nama wajib diisi.");
  if (name.length > 200) return invalid("name", "Nama paling panjang 200 karakter.");
  const nipp = blankToNull(input.nipp);
  if (nipp && nipp.length > 50) return invalid("nipp", "NIPP paling panjang 50 karakter.");
  if (input.gender !== null && input.gender !== "L" && input.gender !== "P") {
    return invalid("gender", "Pilih L, P, atau kosongkan.");
  }

  const patch: Record<string, string | null> = { name, nipp, gender: input.gender };
  const station = input.code === null ? blankToNull(input.station) : null;
  if (station) patch.station = station;

  const { data, error } = await resolved.rpc("pd_share_save_staff", {
    p_code: input.code as string,
    p_patch: patch,
  });
  if (error) return { ok: false, error: staffError(error) };
  const row = (data as { row?: { code?: string; name?: string } } | null)?.row;
  if (!row?.code) return { ok: false, error: { code: "unknown", message: "Tidak bisa disimpan. Coba lagi." } };

  refresh();
  return { ok: true, code: row.code, name: row.name ?? name, savedAt: new Date().toISOString() };
}
