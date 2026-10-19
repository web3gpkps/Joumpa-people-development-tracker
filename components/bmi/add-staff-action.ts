"use server";

import { saveStaff } from "@/components/staff/actions";
import { getWorkspaceFor, resolveAccess, ruleSettings, stationCodes } from "@/lib/workspace";
import { saveBmiCheck, saveBmiProfile } from "./actions";
import { addBmiStaff, type AddBmiStaffInput, type AddBmiStaffResult } from "./add-staff";
import { editBmiStaff, type EditBmiStaffInput, type EditBmiStaffResult } from "./edit-staff";

/**
 * "Tambah SDM" on Cek BMI. The station comes from the verified access (a link or branch
 * account sees only its own station); an owner or KPS access must pick one of its stations,
 * which is checked here against the workspace. Never trusts a station from the form otherwise.
 */
export async function addStaffFromBmi(accessKey: string, input: AddBmiStaffInput): Promise<AddBmiStaffResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  return addBmiStaff(input, {
    load: async () => {
      const result = await getWorkspaceFor(resolved.access);
      if (!result.ok) return null;
      const ws = result.workspace;
      return {
        kind: resolved.access.kind,
        scope: ws.scope,
        isKps: ws.isKps,
        isOwner: ws.isOwner,
        stations: stationCodes(ws),
        periods: ruleSettings(ws.settings).bmiPeriods,
        staff: ws.staff.map((st) => ({ code: st.code, name: st.name ?? null, employeeNo: st.nipp ?? null, station: st.station ?? null })),
      };
    },
    saveStaff: (profile) => saveStaff(accessKey, profile),
    saveProfile: (profile) => saveBmiProfile(accessKey, profile),
    saveCheck: (check) => saveBmiCheck(accessKey, check),
  });
}

/**
 * "Edit Profil" on a name in Cek BMI: corrects the name, the NIPP and L/P. The staff list comes
 * from the verified access, so a person outside its scope is never found; the database checks the
 * scope again.
 */
export async function editStaffFromBmi(accessKey: string, input: EditBmiStaffInput): Promise<EditBmiStaffResult> {
  const resolved = await resolveAccess(accessKey);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  return editBmiStaff(input, {
    load: async () => {
      const result = await getWorkspaceFor(resolved.access);
      if (!result.ok) return null;
      return result.workspace.staff.map((st) => ({
        code: st.code,
        station: st.station ?? null,
        name: st.name ?? null,
        employeeNo: st.nipp ?? null,
        gender: st.gender ?? null,
      }));
    },
    saveStaff: (profile) => saveStaff(accessKey, profile),
  });
}
