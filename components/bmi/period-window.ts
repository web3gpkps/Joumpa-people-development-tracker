/*
 * Which period column groups the table draws. Pure, covered by period-window.test.ts.
 *
 * A programme can have up to 52 checks (260 period columns). Drawing all of them for 100 people
 * is tens of thousands of cells, so from WINDOW_FROM periods up the table draws only the groups
 * near what is on screen plus a buffer, and stands in for the rest with one spacer cell per run
 * of hidden groups. Every group has the same width, so the position of a group is arithmetic and
 * the table keeps its real width: the scrollbar, the sticky columns and "Lihat Cek" behave as if
 * every group were there.
 */

/** From this many periods the table draws a window of them; fewer are all drawn. */
export const WINDOW_FROM = 10;
/** Groups drawn beyond each edge of what is on screen. */
export const BUFFER = 2;

/** The widths the arithmetic needs, in px (BmiTable's column widths add up to these). */
export type TableGeometry = {
  /** Width of everything before the first period group. */
  leading: number;
  /** Width of one period group. */
  perPeriod: number;
  /** Width of the frozen columns, which cover the left edge of the scroll area. */
  frozen: number;
};

/** Inclusive range of 0-based period indexes. */
export type PeriodRange = { first: number; last: number };

export type PeriodSegment =
  | { kind: "cells"; first: number; last: number }
  /** Groups not drawn: one spacer as wide as all of them. */
  | { kind: "gap"; first: number; last: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** True when this many periods are drawn as a window rather than all of them. */
export function isWindowed(periods: number): boolean {
  return periods >= WINDOW_FROM;
}

/** The groups that show in the scroll area (at least partly), 0-based, clamped to the real groups. */
export function periodsInView(scrollLeft: number, viewWidth: number, periods: number, g: TableGeometry): PeriodRange {
  const from = scrollLeft + g.frozen;
  const to = scrollLeft + Math.max(viewWidth, g.frozen + 1);
  return {
    first: clamp(Math.floor((from - g.leading) / g.perPeriod), 0, periods - 1),
    last: clamp(Math.floor((to - g.leading) / g.perPeriod), 0, periods - 1),
  };
}

/** The range to draw for what is on screen: the view plus BUFFER groups on each side. */
export function windowFor(view: PeriodRange, periods: number): PeriodRange {
  return { first: Math.max(0, view.first - BUFFER), last: Math.min(periods - 1, view.last + BUFFER) };
}

/** A starting window before the scroll area is measured: `index` and the groups after it. */
export function initialWindow(index: number, periods: number): PeriodRange {
  const first = clamp(index, 0, periods - 1);
  return windowFor({ first, last: Math.min(periods - 1, first + 2) }, periods);
}

/**
 * True when the drawn range no longer holds the view with at least one group to spare on each
 * side that has more groups beyond it: time to move the window. Moving only then keeps a slow
 * scroll from redrawing the table on every group boundary.
 */
export function needsShift(drawn: PeriodRange, view: PeriodRange, periods: number): boolean {
  if (view.first < drawn.first || view.last > drawn.last) return true;
  if (drawn.first > 0 && view.first - drawn.first < 1) return true;
  if (drawn.last < periods - 1 && drawn.last - view.last < 1) return true;
  return false;
}

/** The runs of drawn groups and gaps, left to right, covering every period exactly once. */
export function segmentsFor(periods: number, drawn: PeriodRange | null): PeriodSegment[] {
  if (periods <= 0) return [];
  if (!drawn) return [{ kind: "cells", first: 0, last: periods - 1 }];
  const first = clamp(drawn.first, 0, periods - 1);
  const last = clamp(drawn.last, first, periods - 1);
  const out: PeriodSegment[] = [];
  if (first > 0) out.push({ kind: "gap", first: 0, last: first - 1 });
  out.push({ kind: "cells", first, last });
  if (last < periods - 1) out.push({ kind: "gap", first: last + 1, last: periods - 1 });
  return out;
}

/** scrollLeft that puts group `index` (0-based) just right of the frozen columns, as the sheet does. */
export function scrollLeftFor(index: number, g: TableGeometry): number {
  return Math.max(0, g.leading + index * g.perPeriod - g.frozen - 8);
}
