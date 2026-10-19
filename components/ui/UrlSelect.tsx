"use client";

import { useRouter } from "next/navigation";
import { useId, useTransition, type ReactNode } from "react";
import { Select } from "./Field";
import { cx } from "./cx";
import type { UrlOption } from "./url-options";

export type { UrlOption } from "./url-options";


type UrlSelectProps = {
  /** Visible label above the select (13/600 muted), e.g. "Laporan" or "Status". */
  label: string;
  /** Extra text after the label, inside the label row (WeekSelect's "sekarang" marker). */
  labelExtra?: ReactNode;
  options: UrlOption[];
  /** Value of the option shown now. */
  current: string;
  /** Width class of the select. Default "w-full sm:w-56". */
  width?: string;
  className?: string;
  /** Extra attributes for the <select> (e.g. data-remember-stasiun-select). */
  selectProps?: Record<`data-${string}`, string>;
};

/**
 * A filter that navigates: a native select whose options are real URLs, so the choice
 * lives in the URL and survives a reload. Client component. For stations use StationSelect,
 * for weeks and BMI periods use WeekSelect.
 */
export function UrlSelect({ label, labelExtra, options, current, width = "w-full sm:w-56", className, selectProps }: UrlSelectProps) {
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className={cx("flex flex-col gap-1", className)} data-print="hide">
      <label htmlFor={id} className="section-label">
        {label}
        {labelExtra}
      </label>
      <Select
        id={id}
        value={current}
        aria-busy={pending || undefined}
        onChange={(event) => {
          const option = options.find((o) => o.value === event.target.value);
          if (option) startTransition(() => router.push(option.href, { scroll: false }));
        }}
        className={width}
        {...selectProps}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
