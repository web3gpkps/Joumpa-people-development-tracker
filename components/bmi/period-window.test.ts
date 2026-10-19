import { describe, expect, test } from "bun:test";
import { MAX_BMI_PERIODS } from "@/lib/bmi-periods";
import {
  BUFFER,
  WINDOW_FROM,
  initialWindow,
  isWindowed,
  needsShift,
  periodsInView,
  scrollLeftFor,
  segmentsFor,
  windowFor,
  type PeriodSegment,
} from "./period-window";
import { GEOMETRY, IDENTITY, PERIOD_FIELDS, SUMMARY } from "./table-columns";

const g = { leading: 1000, perPeriod: 500, frozen: 300 };

/** Every period once, in order, with gaps and cells side by side. */
function covered(segments: PeriodSegment[], periods: number): number[] {
  return segments.flatMap((s) => Array.from({ length: s.last - s.first + 1 }, (_, n) => s.first + n)).slice(0, periods + 1);
}

describe("the table geometry", () => {
  test("is the sum of the real column widths", () => {
    expect(GEOMETRY.leading).toBe(IDENTITY.reduce((n, c) => n + c.width, 0));
    expect(GEOMETRY.perPeriod).toBe(PERIOD_FIELDS.reduce((n, c) => n + c.width, 0));
    // The three frozen columns: No, ID SDM, Nama Petugas (app/globals.css offsets 0, 48, 168).
    expect(GEOMETRY.frozen).toBe(IDENTITY.slice(0, 3).reduce((n, c) => n + c.width, 0));
    expect(SUMMARY.length).toBe(9);
  });
});

describe("windowing", () => {
  test("only many periods are windowed", () => {
    expect(isWindowed(1)).toBe(false);
    expect(isWindowed(WINDOW_FROM - 1)).toBe(false);
    expect(isWindowed(WINDOW_FROM)).toBe(true);
    expect(isWindowed(MAX_BMI_PERIODS)).toBe(true);
  });

  test("the groups in view follow the scroll position", () => {
    // Nothing scrolled: the frozen columns hide the first 300px, the view reaches 1200px.
    expect(periodsInView(0, 1200, 52, g)).toEqual({ first: 0, last: 0 });
    // 1000px of leading columns, then groups of 500px.
    expect(periodsInView(900, 1200, 52, g)).toEqual({ first: 0, last: 2 });
    expect(periodsInView(1700, 1000, 52, g)).toEqual({ first: 2, last: 3 });
  });

  test("never outside the real groups, at either end and for any view", () => {
    for (const periods of [WINDOW_FROM, 26, MAX_BMI_PERIODS]) {
      const end = g.leading + periods * g.perPeriod + 5000;
      for (const left of [0, 100, 5000, end, end * 3]) {
        const view = periodsInView(left, 1400, periods, g);
        expect(view.first).toBeGreaterThanOrEqual(0);
        expect(view.last).toBeLessThanOrEqual(periods - 1);
        expect(view.first).toBeLessThanOrEqual(view.last);
        const drawn = windowFor(view, periods);
        expect(drawn.first).toBeGreaterThanOrEqual(0);
        expect(drawn.last).toBeLessThanOrEqual(periods - 1);
        expect(drawn.first).toBeLessThanOrEqual(view.first);
        expect(drawn.last).toBeGreaterThanOrEqual(view.last);
      }
    }
  });

  test("the window is the view plus a buffer, and stays small however many periods there are", () => {
    const view = periodsInView(5000, 1400, MAX_BMI_PERIODS, g);
    const drawn = windowFor(view, MAX_BMI_PERIODS);
    expect(drawn).toEqual({ first: view.first - BUFFER, last: view.last + BUFFER });
    expect(drawn.last - drawn.first + 1).toBeLessThan(MAX_BMI_PERIODS / 3);
  });

  test("an initial window starts at the chosen period before anything is measured", () => {
    expect(initialWindow(0, 26)).toEqual({ first: 0, last: 2 + BUFFER });
    expect(initialWindow(10, 26)).toEqual({ first: 10 - BUFFER, last: 12 + BUFFER });
    expect(initialWindow(51, 52)).toEqual({ first: 51 - BUFFER, last: 51 });
    expect(initialWindow(99, 52).last).toBe(51);
  });

  test("the window moves only when the view gets within one group of its edge", () => {
    const drawn = { first: 8, last: 16 };
    expect(needsShift(drawn, { first: 10, last: 13 }, 52)).toBe(false);
    expect(needsShift(drawn, { first: 9, last: 13 }, 52)).toBe(false);
    expect(needsShift(drawn, { first: 8, last: 12 }, 52)).toBe(true);
    expect(needsShift(drawn, { first: 12, last: 16 }, 52)).toBe(true);
    expect(needsShift(drawn, { first: 14, last: 18 }, 52)).toBe(true);
    // At the ends of the table there is nothing more to draw, so the edge is fine.
    expect(needsShift({ first: 0, last: 6 }, { first: 0, last: 3 }, 52)).toBe(false);
    expect(needsShift({ first: 44, last: 51 }, { first: 48, last: 51 }, 52)).toBe(false);
  });
});

describe("segments", () => {
  test("no window draws every period in one run", () => {
    expect(segmentsFor(8, null)).toEqual([{ kind: "cells", first: 0, last: 7 }]);
    expect(segmentsFor(0, null)).toEqual([]);
  });

  test("a window has a gap on each side that has periods beyond it", () => {
    expect(segmentsFor(26, { first: 8, last: 14 })).toEqual([
      { kind: "gap", first: 0, last: 7 },
      { kind: "cells", first: 8, last: 14 },
      { kind: "gap", first: 15, last: 25 },
    ]);
    expect(segmentsFor(26, { first: 0, last: 4 })).toEqual([
      { kind: "cells", first: 0, last: 4 },
      { kind: "gap", first: 5, last: 25 },
    ]);
    expect(segmentsFor(26, { first: 20, last: 25 })).toEqual([
      { kind: "gap", first: 0, last: 19 },
      { kind: "cells", first: 20, last: 25 },
    ]);
  });

  test("every period is covered exactly once for 1, 8, 26 and 52 periods and any window", () => {
    for (const periods of [1, 8, 26, MAX_BMI_PERIODS]) {
      for (const first of [0, 3, periods - 1]) {
        const drawn = { first: Math.min(first, periods - 1), last: Math.min(first + 6, periods - 1) };
        const segments = segmentsFor(periods, drawn);
        expect(covered(segments, periods)).toEqual(Array.from({ length: periods }, (_, i) => i));
      }
    }
  });

  test("the table keeps its real width: the gaps are as wide as the groups they stand for", () => {
    for (const periods of [26, MAX_BMI_PERIODS]) {
      const width = (segments: PeriodSegment[]) =>
        segments.reduce((n, s) => n + (s.last - s.first + 1) * g.perPeriod, 0);
      expect(width(segmentsFor(periods, { first: 10, last: 15 }))).toBe(periods * g.perPeriod);
    }
  });

  test("a drawn range beyond the periods is clamped", () => {
    expect(segmentsFor(8, { first: 5, last: 30 })).toEqual([
      { kind: "gap", first: 0, last: 4 },
      { kind: "cells", first: 5, last: 7 },
    ]);
  });
});

describe("scroll position of a period", () => {
  test("puts the group just right of the frozen columns, never before the start", () => {
    expect(scrollLeftFor(0, g)).toBe(1000 - 300 - 8);
    expect(scrollLeftFor(3, g)).toBe(1000 + 1500 - 300 - 8);
    expect(scrollLeftFor(0, { leading: 100, perPeriod: 500, frozen: 300 })).toBe(0);
  });
  test("is the same for every period count, since only the index matters", () => {
    expect(scrollLeftFor(MAX_BMI_PERIODS - 1, GEOMETRY)).toBe(GEOMETRY.leading + (MAX_BMI_PERIODS - 1) * GEOMETRY.perPeriod - GEOMETRY.frozen - 8);
  });
});
