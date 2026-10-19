import { describe, expect, test } from "bun:test";
import { HEIGHT_RANGE, WEIGHT_RANGE, heightError, planCheck, serverCheckErrors, weightError } from "./entry";

describe("heightError and weightError", () => {
  test("empty is left to the caller", () => {
    expect(heightError("")).toBeUndefined();
    expect(weightError("  ")).toBeUndefined();
  });
  test("accepts a decimal comma or point and the whole range", () => {
    expect(heightError("165,5")).toBeUndefined();
    expect(heightError("120")).toBeUndefined();
    expect(heightError("210.0")).toBeUndefined();
    expect(weightError("30")).toBeUndefined();
    expect(weightError("62,5")).toBeUndefined();
  });
  test("refuses text, a second decimal and values out of range", () => {
    expect(heightError("tinggi")).toContain("angka");
    expect(heightError("165,55")).toContain("satu angka");
    expect(heightError("119")).toBe(HEIGHT_RANGE);
    expect(heightError("211")).toBe(HEIGHT_RANGE);
    expect(weightError("29,9")).toBe(WEIGHT_RANGE);
    expect(weightError("201")).toBe(WEIGHT_RANGE);
  });
});

describe("planCheck", () => {
  const ok = { date: "2026-10-12", height: "165,5", weight: "62" };

  test("a complete check", () => {
    expect(planCheck(ok)).toEqual({ ok: true, check: { checkDate: "2026-10-12", heightCm: 165.5, weightKg: 62 } });
  });

  test("height, weight and date are all required", () => {
    expect(planCheck({ date: "", height: "", weight: "" })).toEqual({
      ok: false,
      errors: { date: "Isi tanggal cek.", height: "Isi tinggi badan.", weight: "Isi berat badan." },
    });
    expect(planCheck({ ...ok, weight: "" })).toEqual({ ok: false, errors: { weight: "Isi berat badan." } });
  });

  test("each input reports its own problem", () => {
    expect(planCheck({ date: "2026-02-30", height: "100", weight: "62,55" })).toEqual({
      ok: false,
      errors: {
        date: "Tanggal cek tidak valid.",
        height: HEIGHT_RANGE,
        weight: "Cukup satu angka di belakang koma.",
      },
    });
  });
});

describe("serverCheckErrors", () => {
  test("maps an invalid_input field to its input", () => {
    expect(serverCheckErrors({ code: "invalid_input", field: "height_cm", message: "x" })).toEqual({ height: HEIGHT_RANGE });
    expect(serverCheckErrors({ code: "invalid_input", field: "weight_kg", message: "x" })).toEqual({ weight: WEIGHT_RANGE });
    expect(serverCheckErrors({ code: "invalid_input", field: "check_date", message: "x" })).toEqual({
      date: "Tanggal cek tidak valid.",
    });
  });
  test("other refusals map to nothing", () => {
    expect(serverCheckErrors({ code: "unauthorized", message: "x" })).toEqual({});
    expect(serverCheckErrors({ code: "invalid_input", message: "x" })).toEqual({});
  });
});
