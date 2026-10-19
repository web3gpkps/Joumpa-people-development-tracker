import type { ReactNode } from "react";
import { cx } from "./cx";

type ToolbarProps = {
  /** Filters on the left: StationSelect, WeekSelect, UrlSelect (Laporan, Status), search. */
  children?: ReactNode;
  /**
   * Right side: the count ("15 SDM"), a SaveSummary, the grid legend (<GridLegend />)
   * and page-level buttons for the filtered thing. Wraps below the filters on phones.
   */
  end?: ReactNode;
  /** Accessible name of the group, e.g. "Filter penilaian". Default "Filter". */
  label?: string;
  className?: string;
};

/**
 * One row above the thing it filters (DESIGN.md Toolbar / FilterBar). Filter state lives in
 * the URL (the selects navigate), so the toolbar itself is stateless and server-friendly.
 * Hidden when printing.
 *
 *   <Toolbar end={<span>15 SDM</span>}>
 *     {ws.isKps ? <StationSelect options={…} current={station ?? "semua"} /> : null}
 *     <WeekSelect label="Minggu" options={…} current={String(week)} nowValue={String(thisWeek)} />
 *   </Toolbar>
 */
export function Toolbar({ children, end, label = "Filter", className }: ToolbarProps) {
  return (
    <div
      role="group"
      aria-label={label}
      data-print="hide"
      className={cx("flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between", className)}
    >
      {children ? <div className="flex min-w-0 flex-wrap items-end gap-3">{children}</div> : <span />}
      {end ? <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">{end}</div> : null}
    </div>
  );
}

/** Alias: the same row, named for screens where it only holds filters. */
export const FilterBar = Toolbar;
