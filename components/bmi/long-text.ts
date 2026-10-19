/*
 * Long free text in a one-line table cell. The cell shows the text on one line with an
 * ellipsis; only when the text really is clipped does it get an expand toggle. Pure, so
 * long-text.test.ts covers it; the DOM measuring lives in ExpandableText.tsx.
 */

/**
 * Widest glyph (px) at the table type of 12px. Real text averages about 6.7px per character,
 * so a text of n characters needs at most n * MAX_GLYPH_PX: shorter than width / MAX_GLYPH_PX
 * characters can never overflow and is not measured at all.
 */
export const MAX_GLYPH_PX = 12;

/** The text as the one-line cell shows it: line breaks and runs of spaces become one space. */
export function oneLine(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Cheap pre-check before measuring: could this text overflow a one-line cell whose text area
 * is `widthPx` wide? False for empty and clearly short text, so those cells never measure
 * and never show a toggle. True means "measure it", not "it is clipped".
 */
export function mayOverflow(text: string | null | undefined, widthPx: number): boolean {
  const line = oneLine(text);
  if (line === "") return false;
  return line.length * MAX_GLYPH_PX > widthPx;
}

/** True when an element's content is wider than its box (the ellipsis is showing). */
export function isClipped(box: { scrollWidth: number; clientWidth: number }): boolean {
  // 1px of slack: fractional widths round differently between scrollWidth and clientWidth.
  return box.scrollWidth - box.clientWidth > 1;
}

/** Accessible name of the toggle: "Lihat selengkapnya, Coaching Evaluation Feedback, <nama>". */
export function expandLabel(expanded: boolean, column: string, name: string): string {
  return `${expanded ? "Hide" : "Lihat selengkapnya"}, ${column}, ${name}`;
}
