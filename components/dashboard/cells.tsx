/*
 * Table cell display for Beranda. Number formats live in lib/format (Indonesian decimal comma).
 * Server-component friendly.
 */
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

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

/** A count that needs action reads in its status tone; zero stays quiet. */
export function Flagged({ n, tone = "critical" }: { n: number; tone?: "critical" | "warning" }) {
  if (n === 0) return <span className="tabular-nums text-ink-muted">0</span>;
  return <span className={cx("font-semibold tabular-nums", tone === "critical" ? "text-critical" : "text-warning")}>{n}</span>;
}

/** "3/5": the part in ink, the whole muted. */
export function Ratio({ part, whole }: { part: number; whole: number }) {
  return (
    <span className="tabular-nums">
      {part}
      <span className="text-ink-muted">/{whole}</span>
    </span>
  );
}

/** A share 0..100 as text plus a thin bar under it (the bar is decoration; the text says it). */
export function ShareBar({ percent, label, tone = "brand" }: { percent: number; label: ReactNode; tone?: "brand" | "good" }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <span className="inline-flex min-w-16 flex-col items-end gap-1">
      <span className="tabular-nums">{label}</span>
      <span aria-hidden="true" className="block h-1 w-full overflow-hidden rounded-full bg-neutral-tint">
        <span className={cx("block h-full rounded-full", tone === "good" ? "bg-good" : "bg-brand")} style={{ width: `${width}%` }} />
      </span>
    </span>
  );
}
