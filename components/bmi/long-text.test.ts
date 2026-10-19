import { describe, expect, test } from "bun:test";
import { expandLabel, isClipped, mayOverflow, oneLine } from "./long-text";

const coaching = 'Penilaian Coaching :\nItem "Sesuai" : 29\nItem "Tidak Sesuai" : 3\nScore : 87';

describe("one-line preview", () => {
  test("line breaks and repeated spaces collapse to single spaces", () => {
    expect(oneLine("a\n  b\r\nc")).toBe("a b c");
    expect(oneLine(null)).toBe("");
    expect(oneLine("   ")).toBe("");
  });
});

describe("mayOverflow", () => {
  test("empty or blank text never overflows", () => {
    expect(mayOverflow(null, 177)).toBe(false);
    expect(mayOverflow(undefined, 177)).toBe(false);
    expect(mayOverflow("  \n ", 177)).toBe(false);
  });

  test("short text can never overflow and is not measured", () => {
    expect(mayOverflow("Sesuai", 177)).toBe(false);
    expect(mayOverflow("x".repeat(14), 177)).toBe(false);
  });

  test("text that might not fit is sent to the measuring step, line breaks or not", () => {
    expect(mayOverflow("x".repeat(15), 177)).toBe(true);
    expect(mayOverflow(coaching, 177)).toBe(true);
    expect(mayOverflow(coaching, 1000)).toBe(false);
  });
});

describe("isClipped", () => {
  test("clipped only when the content is wider than the box", () => {
    expect(isClipped({ scrollWidth: 320, clientWidth: 177 })).toBe(true);
    expect(isClipped({ scrollWidth: 177, clientWidth: 177 })).toBe(false);
    expect(isClipped({ scrollWidth: 178, clientWidth: 177 })).toBe(false);
  });
});

describe("expandLabel", () => {
  test("names the action, the column and the person", () => {
    expect(expandLabel(false, "Coaching Evaluation Feedback", "Petugas uji")).toBe(
      "Lihat selengkapnya, Coaching Evaluation Feedback, Petugas uji",
    );
    expect(expandLabel(true, "Result/Remarks", "Petugas uji")).toBe("Hide, Result/Remarks, Petugas uji");
  });
});
