/**
 * Parameter BMI (public.pd_settings, id = 1): labels, short help, and validation that mirrors the
 * table's CHECK constraints (supabase/migrations/*_pd_schema.sql), so the form says what the
 * database would refuse before it is sent. Pure: used by the form and the Server Action.
 */
import { parseDecimal } from "@/components/ui/Field";
import { MAX_BMI_INTERVAL_DAYS, MAX_BMI_PERIODS } from "@/lib/bmi-periods";

export type SettingKey =
  | "bmi_first_check"
  | "bmi_interval_days"
  | "bmi_periods"
  | "bmi_underweight_below"
  | "bmi_normal_max"
  | "bmi_overweight_max"
  | "min_height_female"
  | "min_height_male";

export type SettingKind = "date" | "int" | "decimal" | "optional-decimal";

export type SettingField = {
  key: SettingKey;
  kind: SettingKind;
  label: string;
  /** One short line: the allowed range or what the value is used for. */
  help: string;
  unit?: string;
};

export type SettingSection = { id: string; title: string; fields: SettingField[] };

export const SETTING_SECTIONS: SettingSection[] = [
  {
    id: "cek-bmi",
    title: "Cek BMI",
    fields: [
      {
        key: "bmi_first_check",
        kind: "date",
        label: "Tanggal BMI Cek ke-1",
        help: "Cek berikutnya dijadwalkan dari tanggal ini",
      },
      {
        key: "bmi_interval_days",
        kind: "int",
        label: "Interval antar cek BMI",
        help: `Semua SDM, 1 sampai ${MAX_BMI_INTERVAL_DAYS} hari. 14 hari = tiap dua minggu`,
        unit: "hari",
      },
      {
        key: "bmi_periods",
        kind: "int",
        label: "Jumlah cek BMI",
        help: `1 sampai ${MAX_BMI_PERIODS}`,
        unit: "kali",
      },
    ],
  },
  {
    id: "klasifikasi-bmi",
    title: "Klasifikasi BMI",
    fields: [
      {
        key: "bmi_underweight_below",
        kind: "decimal",
        label: "Kurus di bawah BMI",
        help: "Kemenkes RI: 18,5",
      },
      { key: "bmi_normal_max", kind: "decimal", label: "Normal sampai BMI", help: "Kemenkes RI: 25,0" },
      {
        key: "bmi_overweight_max",
        kind: "decimal",
        label: "Overweight sampai BMI",
        help: "Di atasnya Obesitas. Kemenkes RI: 27,0",
      },
    ],
  },
  {
    id: "tinggi-badan",
    title: "Syarat tinggi badan",
    fields: [
      {
        key: "min_height_female",
        kind: "optional-decimal",
        label: "Tinggi minimal perempuan",
        help: "120 sampai 210 cm, boleh kosong",
        unit: "cm",
      },
      {
        key: "min_height_male",
        kind: "optional-decimal",
        label: "Tinggi minimal laki-laki",
        help: "120 sampai 210 cm, boleh kosong",
        unit: "cm",
      },
    ],
  },
];

export const SETTING_FIELDS: SettingField[] = SETTING_SECTIONS.flatMap((s) => s.fields);

export type SettingsValues = Record<SettingKey, string>;
export type SettingsErrors = Partial<Record<SettingKey, string>>;

export type SettingsUpdate = {
  bmi_first_check: string;
  bmi_interval_days: number;
  bmi_periods: number;
  bmi_underweight_below: number;
  bmi_normal_max: number;
  bmi_overweight_max: number;
  min_height_female: number | null;
  min_height_male: number | null;
};

/** A DB row value as the form shows it: dates as-is, decimals with a comma ("18,5"). */
export function toFormValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? String(value).replace(".", ",") : value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** True for a valid date that is not a Monday (the BMI schedule starts on a Monday). */
export function notMonday(value: string): boolean {
  return isIsoDate(value) && new Date(`${value}T00:00:00Z`).getUTCDay() !== 1;
}

function between(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/** Parses and checks every field; `update` is set only when there are no errors. */
export function validateSettings(values: SettingsValues): { errors: SettingsErrors; update: SettingsUpdate | null } {
  const errors: SettingsErrors = {};
  const out: Partial<Record<SettingKey, string | number | null>> = {};

  for (const field of SETTING_FIELDS) {
    const raw = (values[field.key] ?? "").trim();
    if (field.kind === "date") {
      if (raw === "") errors[field.key] = "Wajib diisi.";
      else if (!isIsoDate(raw)) errors[field.key] = "Tanggal tidak valid.";
      else out[field.key] = raw;
      continue;
    }
    const n = parseDecimal(raw);
    if (n === null) {
      if (field.kind === "optional-decimal") out[field.key] = null;
      else errors[field.key] = "Wajib diisi.";
      continue;
    }
    if (Number.isNaN(n)) {
      errors[field.key] = "Isi angka, misalnya 18,5.";
      continue;
    }
    if (field.kind === "int" && !Number.isInteger(n)) {
      errors[field.key] = "Isi bilangan bulat.";
      continue;
    }
    out[field.key] = n;
  }

  const num = (k: SettingKey) => (typeof out[k] === "number" ? (out[k] as number) : null);
  const check = (k: SettingKey, ok: boolean, message: string) => {
    if (!errors[k] && num(k) !== null && !ok) errors[k] = message;
  };

  check("bmi_interval_days", between(num("bmi_interval_days") ?? 0, 1, MAX_BMI_INTERVAL_DAYS), `Isi 1 sampai ${MAX_BMI_INTERVAL_DAYS} hari.`);
  check("bmi_periods", between(num("bmi_periods") ?? 0, 1, MAX_BMI_PERIODS), `Isi 1 sampai ${MAX_BMI_PERIODS} cek.`);

  const under = num("bmi_underweight_below");
  const normal = num("bmi_normal_max");
  const over = num("bmi_overweight_max");
  check("bmi_underweight_below", (under ?? 0) > 0, "Harus lebih dari 0.");
  if (under !== null && normal !== null) {
    check("bmi_underweight_below", under <= normal, "Tidak boleh di atas batas Normal.");
  }
  if (normal !== null && over !== null) {
    check("bmi_normal_max", normal <= over, "Tidak boleh di atas batas Overweight.");
  }
  check("bmi_overweight_max", (over ?? 0) <= 100, "Tidak boleh di atas 100.");

  for (const k of ["min_height_female", "min_height_male"] as const) {
    check(k, between(num(k) ?? 0, 120, 210), "Isi 120 sampai 210 cm, atau kosongkan.");
  }

  if (Object.keys(errors).length > 0) return { errors, update: null };
  return { errors, update: out as SettingsUpdate };
}
