"use client";

import Link from "next/link";
import { cx } from "./cx";
import { UrlSelect } from "./UrlSelect";
import type { UrlOption } from "./url-options";

type WeekSelectProps = {
  /** "Minggu" for weeks, "Periode" for BMI periods. */
  label: string;
  /** In order; the steppers move to the previous / next option. */
  options: UrlOption[];
  /** Value shown now. */
  current: string;
  /** The current week / period ("now"): a bright emerald dot and "sekarang" in the accent colour. */
  nowValue?: string;
  className?: string;
};

const stepper =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface text-base text-ink transition-colors duration-120 hover:bg-bg";

/**
 * Week or BMI-period picker (DESIGN.md: the week rail is not global chrome): a select with
 * ‹ › 44px steppers, all URL-driven. The current one is marked "sekarang".
 */
export function WeekSelect({ label, options, current, nowValue, className }: WeekSelectProps) {
  const index = options.findIndex((o) => o.value === current);
  const prev = index > 0 ? options[index - 1] : null;
  const next = index >= 0 && index < options.length - 1 ? options[index + 1] : null;
  // When the selected option is "now", the label above already says so; mark the option only otherwise.
  const labelled = nowValue && nowValue !== current
    ? options.map((o) => (o.value === nowValue ? { ...o, label: `${o.label} · sekarang` } : o))
    : options;

  return (
    <div className={cx("flex flex-col gap-1", className)} data-print="hide">
      <div className="flex items-end gap-1">
        {prev ? (
          <Link href={prev.href} scroll={false} aria-label={`Sebelumnya: ${prev.label}`} className={stepper}>
            <span aria-hidden="true">‹</span>
          </Link>
        ) : (
          <span aria-hidden="true" className={cx(stepper, "cursor-not-allowed border-line text-ink-muted hover:bg-surface")}>
            ‹
          </span>
        )}
        <UrlSelect
          label={label}
          labelExtra={
            nowValue && nowValue === current ? (
              <span className="text-accent">
                {" · "}
                <span aria-hidden="true" className="mr-1 inline-block size-1.5 rounded-full bg-accent-bright align-middle" />
                sekarang
              </span>
            ) : null
          }
          options={labelled}
          current={current}
          width="w-full sm:w-72"
        />
        {next ? (
          <Link href={next.href} scroll={false} aria-label={`Berikutnya: ${next.label}`} className={stepper}>
            <span aria-hidden="true">›</span>
          </Link>
        ) : (
          <span aria-hidden="true" className={cx(stepper, "cursor-not-allowed border-line text-ink-muted hover:bg-surface")}>
            ›
          </span>
        )}
      </div>
    </div>
  );
}
