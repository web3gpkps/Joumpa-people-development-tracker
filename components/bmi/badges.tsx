import type { BmiCategory, HeightRequirement } from "@/lib/rules";
import type { BmiScheduleStatus } from "./schedule";

/** An empty value: a dash for the eye and "kosong" for a screen reader. */
export function Dash({ reason = "kosong" }: { reason?: string }) {
  return (
    <>
      <span aria-hidden="true">–</span>
      <span className="sr-only">{reason}</span>
    </>
  );
}

const CATEGORY_CLASS: Record<BmiCategory, string> = {
  Kurus: "kurus",
  Normal: "normal",
  Overweight: "overweight",
  Obesitas: "obesitas",
};

const SCHEDULE_CLASS: Record<BmiScheduleStatus, string> = {
  "Terlambat cek": "late",
  "Cek ≤ 7 hari": "due",
  Terjadwal: "scheduled",
};

/** BMI category in the tracker palette (the text is always there, colour only groups it). */
export function CategoryBadge({ category }: { category: BmiCategory | null | undefined }) {
  if (!category) return <Dash reason="belum ada" />;
  return <span className={`bmi-badge bmi-badge--${CATEGORY_CLASS[category]}`}>{category}</span>;
}

export function ScheduleBadge({ status }: { status: BmiScheduleStatus }) {
  return <span className={`bmi-badge bmi-badge--${SCHEDULE_CLASS[status]}`}>{status}</span>;
}

const HEIGHT_CLASS: Record<HeightRequirement, string> = {
  Memenuhi: "normal",
  "Tidak Memenuhi": "obesitas",
  "Isi standar di Parameter": "pending",
};

/** Syarat Tinggi Badan (sheet column AJ) in the tracker palette. */
export function HeightBadge({ value }: { value: HeightRequirement | null | undefined }) {
  if (!value) return <Dash reason="belum ada" />;
  return <span className={`bmi-badge bmi-badge--${HEIGHT_CLASS[value]}`}>{value}</span>;
}

/** A period nobody has been checked in yet. */
export function PendingBadge({ children }: { children: string }) {
  return <span className="bmi-badge bmi-badge--pending">{children}</span>;
}
