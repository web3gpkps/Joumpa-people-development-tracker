"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { validateSettings, type SettingsErrors, type SettingsValues } from "@/components/admin/settings-schema";

export type SaveSettingsResult =
  | { ok: true; savedAt: string }
  | { ok: false; message: string; errors?: SettingsErrors };

/** Saves the Parameter BMI row (pd_settings, id = 1). The database re-checks every CHECK constraint. */
export async function saveSettings(values: SettingsValues): Promise<SaveSettingsResult> {
  await requireAdmin();
  const { errors, update } = validateSettings(values);
  if (!update) return { ok: false, message: "Periksa isian yang ditandai.", errors };

  const supabase = await createClient();
  const { data, error } = await supabase.from("pd_settings").update(update).eq("id", 1).select("updated_at").maybeSingle();
  if (error) {
    // private.pd_settings_guard_bmi_periods: a check that already has data would be cut off.
    if (error.message === "bmi_periods_below_used") {
      const used = /check (\d+)/.exec(error.details ?? "")?.[1];
      return {
        ok: false,
        message: "Jumlah cek belum diubah.",
        errors: {
          bmi_periods: used
            ? `BMI Cek ke-${used} sudah berisi data. Jumlah cek minimal ${used}.`
            : "Ada cek yang sudah berisi data di atas jumlah ini.",
        },
      };
    }
    return { ok: false, message: "Parameter belum tersimpan. Periksa isian, lalu coba lagi." };
  }
  if (!data) {
    return { ok: false, message: "Parameter tidak bisa diubah dengan akun ini." };
  }
  refresh();
  return { ok: true, savedAt: data.updated_at };
}
