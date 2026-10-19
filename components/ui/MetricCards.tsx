import type { ReactNode } from "react";
import { cx } from "./cx";

export type Metric = {
  label: string;
  value: ReactNode;
  /** One short line under the value, e.g. "Cek ke-1 · 67% selesai". */
  foot?: string;
  /** Colours the value for exceptions; default is ink. */
  tone?: "good" | "critical" | "warning";
  /** 0..100: draws a thin progress bar under the foot. */
  progress?: number;
};

const valueTone = { good: "text-good", critical: "text-critical", warning: "text-warning" } as const;
const barTone = { good: "bg-good", critical: "bg-critical", warning: "bg-warning" } as const;

/** Four-up summary cards above a table. Server-component friendly; hidden when printing. */
export function MetricCards({ items, label }: { items: Metric[]; label: string }) {
  return (
    <section aria-label={label} data-print="hide" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {items.map((m) => (
        <div key={m.label} className="min-w-0 rounded-panel border border-line bg-surface p-3 shadow-card sm:p-5">
          <p className="text-xs text-ink-muted">{m.label}</p>
          {/* Compact on phones, so the task below the summary starts within the first screen. */}
          <p
            data-numeric
            className={cx(
              "mt-1 text-[22px] leading-7 font-semibold sm:mt-2 sm:text-[28px] sm:leading-9",
              m.tone ? valueTone[m.tone] : "text-ink",
            )}
          >
            {m.value}
          </p>
          {m.foot ? <p className="mt-1 text-xs text-ink-muted max-sm:line-clamp-1">{m.foot}</p> : null}
          {m.progress !== undefined ? (
            <div aria-hidden="true" className="mt-2 h-1 sm:mt-3 overflow-hidden rounded-full bg-neutral-tint">
              <div
                className={cx("h-full rounded-full", m.tone ? barTone[m.tone] : "bg-brand")}
                style={{ width: `${Math.max(0, Math.min(100, m.progress))}%` }}
              />
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}
