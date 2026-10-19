import { describe, expect, test } from "bun:test";
import {
  changedFields,
  cleanPatch,
  completionFill,
  formValues,
  newPlanInput,
  parseProgress,
  type PlanFormValues,
} from "./plan-input";

const stored = {
  itemNo: "6a",
  area: "Grooming",
  action: "Grooming check harian",
  reportGroup: "SUB",
  target: null,
  dueDate: "2026-10-31",
  pic: "Kepala Stasiun",
  status: "Proses",
  progress: 40,
  doneOn: null,
  evidence: null,
  notes: null,
};

describe("parseProgress", () => {
  test("accepts what people type", () => {
    expect(parseProgress("75")).toBe(75);
    expect(parseProgress(" 75 % ")).toBe(75);
    expect(parseProgress("12,5")).toBe(12.5);
    expect(parseProgress("")).toBeNull();
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress("tujuh")).toBeNaN();
  });
});

describe("cleanPatch", () => {
  test("trims text, blank clears, dates and progress checked", () => {
    expect(
      cleanPatch({ action: "  Kelas  ", target: "", due_date: "2026-11-15", progress: "60", pic: " A   B " }),
    ).toEqual({ ok: true, patch: { action: "Kelas", target: null, due_date: "2026-11-15", progress: 60, pic: "A B" } });
  });

  test("blank status falls back to Belum Mulai, blank progress to 0", () => {
    expect(cleanPatch({ status: "", progress: "" })).toEqual({ ok: true, patch: { status: "Belum Mulai", progress: 0 } });
  });

  test("field errors", () => {
    const result = cleanPatch({
      progress: "101",
      due_date: "31/10/2026",
      done_on: "2026-02-30",
      status: "Done",
      item_no: "12345678901",
      action: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual(["action", "done_on", "due_date", "item_no", "progress", "status"]);
    const half = cleanPatch({ progress: 50.5 });
    expect(half.ok ? null : half.fieldErrors.progress).toBe("Isi bilangan bulat 0 sampai 100.");
  });

  test("unknown keys are refused", () => {
    expect(cleanPatch({ archived_at: null })).toEqual({ ok: false, fieldErrors: {} });
  });

  test("insert needs Area and Tindakan; Cabang only for KPS", () => {
    expect(cleanPatch({ target: "x" }, { insert: true })).toMatchObject({
      ok: false,
      fieldErrors: { area: "Pilih area.", action: "Tindakan wajib diisi." },
    });
    expect(cleanPatch({ area: "Grooming", action: "Cek", report_group: "" }, { insert: true })).toEqual({
      ok: true,
      patch: { area: "Grooming", action: "Cek" },
    });
    expect(cleanPatch({ area: "Grooming", action: "Cek", report_group: "" }, { insert: true, needsGroup: true })).toMatchObject(
      { ok: false, fieldErrors: { report_group: "Pilih cabang." } },
    );
    expect(cleanPatch({ area: "Grooming", action: "Cek" }, { insert: true, needsGroup: true })).toMatchObject({
      ok: false,
      fieldErrors: { report_group: "Pilih cabang." },
    });
  });

  test("an update may not clear Area, Tindakan or Cabang", () => {
    expect(cleanPatch({ area: "", report_group: " " })).toMatchObject({
      ok: false,
      fieldErrors: { area: "Area wajib diisi.", report_group: "Pilih cabang." },
    });
  });
});

describe("changedFields", () => {
  const before = formValues(stored);

  test("only what changed, text compared trimmed, progress numerically", () => {
    const after: PlanFormValues = { ...before, status: "Selesai", progress: "40,0", pic: " Kepala Stasiun ", notes: "Hujan" };
    expect(changedFields(before, after)).toEqual({ status: "Selesai", notes: "Hujan" });
  });

  test("nothing changed", () => {
    expect(changedFields(before, { ...before })).toEqual({});
  });
});

describe("newPlanInput", () => {
  const values = { ...formValues(stored), item_no: "", target: "", pic: "" };

  test("station scope: no Cabang, optional fields only when filled", () => {
    expect(newPlanInput(values, false)).toEqual({ area: "Grooming", action: "Grooming check harian", due_date: "2026-10-31" });
  });

  test("KPS sends the Cabang, even blank (so it is reported)", () => {
    expect(newPlanInput({ ...values, report_group: "" }, true)).toMatchObject({ report_group: "" });
  });
});

describe("completionFill", () => {
  test("offers 100% and today only where needed", () => {
    expect(completionFill({ progress: "40", done_on: "" }, "2026-10-19")).toEqual({ progress: "100", done_on: "2026-10-19" });
    expect(completionFill({ progress: "100", done_on: "" }, "2026-10-19")).toEqual({ done_on: "2026-10-19" });
    expect(completionFill({ progress: "100", done_on: "2026-10-18" }, "2026-10-19")).toEqual({});
  });
});
