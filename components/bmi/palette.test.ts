/*
 * Contrast guard for the Cek BMI palette. The colours live in app/globals.css (.bmi-tracker
 * custom properties); this test reads them from there and checks every text colour against
 * every background it is drawn on: WCAG AA, 4.5:1 for normal text. A graphic such as a metric
 * icon needs 3:1 and is not listed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");

const colours = new Map<string, string>();
for (const [, name, value] of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) colours.set(name, value.toLowerCase());

/** A colour by its custom property name (without "--"), or a literal "#rrggbb". */
function colour(ref: string): string {
  if (ref.startsWith("#")) return ref.toLowerCase();
  const value = colours.get(ref);
  if (!value) throw new Error(`--${ref} is not defined in app/globals.css`);
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const ROW = ["bmi-white", "bmi-zebra", "bmi-row-hover"];
// Text and the backgrounds it sits on. Each entry is [foreground, ...backgrounds].
const PAIRS: string[][] = [
  ["bmi-text", ...ROW],
  ["bmi-id", ...ROW],
  ["bmi-name", ...ROW],
  ["bmi-name-hover", ...ROW],
  ["bmi-soft", ...ROW],
  ["bmi-computed-text", "bmi-computed", "bmi-row-hover"],
  ["bmi-hint", "bmi-input", "bmi-input-hover", "bmi-input-row-hover"],
  ["bmi-head", "bmi-head-group", "bmi-head-field"],
  ["bmi-head-group-text", "bmi-head-group"],
  ["bmi-head-field-text", "bmi-head-field", "bmi-period-field", "bmi-period-field-selected"],
  ["bmi-period-text", "bmi-period-group"],
  ["bmi-period-selected-text", "bmi-period-group-selected"],
  ["bmi-summary-text", "bmi-summary-group"],
  ["bmi-muted", "bmi-white", "bmi-legend-bg", "bmi-note-bg", "bmi-zebra"],
  ["bmi-label", "bmi-white"],
  ["bmi-count", "bmi-legend-bg"],
  ["bmi-strong", "bmi-white", "bmi-zebra"],
  ["bmi-switch-text", "bmi-switch-bg"],
  ["bmi-switch-active", "bmi-white"],
  ["bmi-value-good", "bmi-white"],
  ["bmi-value-late", "bmi-white"],
  ["bmi-value-above", "bmi-white"],
  ["bmi-normal", "bmi-normal-bg"],
  ["bmi-overweight", "bmi-overweight-bg"],
  ["bmi-obesitas", "bmi-obesitas-bg"],
  ["bmi-kurus", "bmi-kurus-bg"],
  ["bmi-late", "bmi-late-bg"],
  ["bmi-due", "bmi-due-bg"],
  ["bmi-scheduled", "bmi-scheduled-bg"],
  ["bmi-pending", "bmi-pending-bg"],
  // Banner text sits on the dark left of the gradient (navy-deep to #124952 at 65%).
  ["bmi-hero-text", "navy-deep", "#114152", "#124952"],
  // Profile panel head: gradient from #0e3549 to #107363.
  ["bmi-panel-overline", "#0e3549", "#107363"],
  ["bmi-panel-text", "#0e3549", "#107363"],
  // White text on the banner chip and buttons at the lightest end of the gradient.
  ["#ffffff", "hero-end", "#173f45"],
];

describe("Cek BMI palette", () => {
  test("every text colour reads at 4.5:1 or better on its backgrounds", () => {
    const failures: string[] = [];
    for (const [fg, ...bgs] of PAIRS) {
      for (const bg of bgs) {
        const ratio = contrast(colour(fg), colour(bg));
        if (ratio < 4.5) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("the colours were found in the stylesheet", () => {
    expect(colours.get("bmi-muted")).toBe("#62707f");
    expect(colours.size).toBeGreaterThan(40);
  });
});
