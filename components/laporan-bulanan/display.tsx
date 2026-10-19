/*
 * How Laporan Bulanan values read, shared by the grid, the phone cards and the summary. No hooks,
 * so server and client components both use it. Status words keep the workbook's Ya / Belum /
 * Tidak / Terlambat; the tone only repeats what the word says.
 */
import { formatDecimal, formatProgress } from "@/lib/format";
import { StatusChip, type StatusTone } from "@/components/ui/StatusChip";

const TONES: Record<string, StatusTone> = {
  Ya: "good",
  Belum: "warning",
  Tidak: "critical",
  Terlambat: "critical",
};

/** Tepat waktu?, Capai target?, Direspons ≤ 1×24 jam?: the word in its tone, or a dash. */
export function YesNo({ value, empty = "belum ada data" }: { value: string | null | undefined; empty?: string }) {
  if (!value) return <Dash reason={empty} />;
  return <StatusChip label={value} tone={TONES[value] ?? "neutral"} />;
}

/** A muted dash with a spoken reason (DESIGN.md: empty is "–" with a reason). */
export function Dash({ reason }: { reason: string }) {
  return (
    <>
      <span aria-hidden="true" className="text-ink-muted">
        –
      </span>
      <span className="sr-only">{reason}</span>
    </>
  );
}

/** % Sesuai with one decimal when it has one, so 89,6% never rounds up to the 90% target. */
export function formatCompliance(share: number | null): string {
  return share === null ? "" : formatProgress(share * 100);
}

/** Indeks kepuasan, always two decimals: "4,50". */
export function formatSatisfaction(value: number | null): string {
  return formatDecimal(value, 2);
}
