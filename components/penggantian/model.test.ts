import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TRAINING_DUE,
  DEFAULT_WITHDRAW_DUE,
  checkForm,
  checkPatch,
  filterQuery,
  filterRows,
  formFromRow,
  formKeyOf,
  formScores,
  matchesQuery,
  newFormValues,
  parseFilters,
  parseNumberText,
  patchFromCells,
  scopeRows,
  searchStaff,
  summarize,
  toViews,
  type ReplacementSource,
  type ReplacementView,
  type StaffOption,
} from "./model";

const TODAY = "2026-10-19";
const GROUPS = ["CGK & HLP", "DPS", "SUB", "KNO", "BPN"];

function source(over: Partial<ReplacementSource> & { id: number }): ReplacementSource {
  return {
    staffCode: null,
    name: `SDM ${over.id}`,
    reportGroup: "DPS",
    category: "Penggantian",
    basis: null,
    withdrawDue: DEFAULT_WITHDRAW_DUE,
    directorApproval: "Belum",
    withdrawnOn: null,
    withdrawStatus: "Belum Mulai",
    replacementName: null,
    selectedOn: null,
    postTest: null,
    practice: null,
    trainingDue: DEFAULT_TRAINING_DUE,
    startedOn: null,
    notes: null,
    sortOrder: over.id,
    ...over,
  };
}

const view = (over: Partial<ReplacementSource> & { id: number }): ReplacementView =>
  toViews([source(over)], () => "Diubah lewat tautan ini")[0];

const STAFF: StaffOption[] = [
  { code: "DPS-01", name: "Ayu Lestari", station: "DPS", reportGroup: "DPS" },
  { code: "BPN-03", name: "Petugas Uji Bpn", station: "BPN", reportGroup: "BPN" },
  { code: "CGK-07", name: "Ilham Pratama", station: "HLP", reportGroup: "CGK & HLP" },
];

describe("toViews", () => {
  test("orders by sort order then id, numbers 1..n and turns numeric text into numbers", () => {
    const rows = toViews(
      [source({ id: 9, sortOrder: 2, postTest: "85.5" }), source({ id: 4, sortOrder: null }), source({ id: 3, sortOrder: 1 })],
      (r) => `row ${r.id}`,
    );
    expect(rows.map((r) => [r.id, r.no])).toEqual([[3, 1], [9, 2], [4, 3]]);
    expect(rows[1].postTest).toBe(85.5);
    expect(rows[1].changed).toBe("row 9");
  });
});

describe("parseFilters and filterQuery", () => {
  test("keeps known values and drops the rest", () => {
    expect(parseFilters({ cabang: "CGK & HLP", kategori: "strong-reminder", flag: "terlambat", cari: "  ayu " }, GROUPS)).toEqual({
      cabang: "CGK & HLP",
      kategori: "strong-reminder",
      flag: "terlambat",
      cari: "ayu",
    });
    expect(parseFilters({ cabang: "XYZ", kategori: "lain", flag: ["nope"], cari: undefined }, GROUPS)).toEqual({
      cabang: null,
      kategori: null,
      flag: null,
      cari: "",
    });
  });
  test("round-trips to a query without empty values", () => {
    expect(filterQuery({ cabang: "DPS", kategori: null, flag: null, cari: "" })).toEqual({
      cabang: "DPS",
      kategori: null,
      flag: null,
      cari: null,
    });
  });
});

describe("filtering", () => {
  const rows = [
    view({ id: 1, name: "Ayu Lestari", staffCode: "DPS-01", reportGroup: "DPS" }),
    view({ id: 2, name: "Petugas Uji Bpn", reportGroup: "BPN", category: "Strong reminder", withdrawDue: "2026-10-19" }),
    view({ id: 3, name: "Budi", reportGroup: "SUB", withdrawDue: "2026-10-10" }),
    view({ id: 4, name: "Dewi", reportGroup: "SUB", withdrawStatus: "Batal / N.A.", replacementName: "Rizal Baru" }),
  ];
  const none = { cabang: null, kategori: null, flag: null, cari: "" } as const;

  test("Cabang and Kategori narrow the summary scope", () => {
    expect(scopeRows(rows, { ...none, cabang: "SUB" }).map((r) => r.id)).toEqual([3, 4]);
    expect(scopeRows(rows, { ...none, kategori: "strong-reminder" }).map((r) => r.id)).toEqual([2]);
  });
  test("Flag uses the workbook flag; belum-terdaftar uses Tracker Staf", () => {
    expect(filterRows(rows, { ...none, flag: "terlambat" }, TODAY, STAFF).map((r) => r.id)).toEqual([3]);
    expect(filterRows(rows, { ...none, flag: "jatuh-tempo" }, TODAY, STAFF).map((r) => r.id)).toEqual([2]);
    expect(filterRows(rows, { ...none, flag: "on-track" }, TODAY, STAFF).map((r) => r.id)).toEqual([1]);
    expect(filterRows(rows, { ...none, flag: "selesai" }, TODAY, STAFF).map((r) => r.id)).toEqual([4]);
    expect(filterRows(rows, { ...none, flag: "belum-terdaftar" }, TODAY, STAFF).map((r) => r.id)).toEqual([4]);
  });
  test("search matches name, ID and replacement, every word, accents and case ignored", () => {
    expect(filterRows(rows, { ...none, cari: "dps-01" }, TODAY, STAFF).map((r) => r.id)).toEqual([1]);
    expect(filterRows(rows, { ...none, cari: "rizal dewi" }, TODAY, STAFF).map((r) => r.id)).toEqual([4]);
    expect(matchesQuery("petúgas uji", "Petugas Uji Bpn")).toBe(true);
    expect(matchesQuery("", "x")).toBe(true);
  });
});

describe("summarize", () => {
  test("counts withdrawals, passes, flags, pending approvals and unregistered replacements", () => {
    const rows = [
      view({ id: 1, withdrawStatus: "Selesai", replacementName: "Ayu Lestari", postTest: 85, practice: 4.25, directorApproval: "Ya" }),
      view({ id: 2, withdrawDue: "2026-10-10", replacementName: "Orang Baru", postTest: 70, practice: 4 }),
      view({ id: 3, withdrawStatus: "Batal / N.A.", directorApproval: null }),
      view({ id: 4, directorApproval: "Tidak", withdrawDue: "2026-10-24" }),
    ];
    expect(summarize(rows, TODAY, STAFF)).toEqual({
      total: 4,
      withdrawn: 1,
      withReplacement: 2,
      passed: 1,
      late: 1,
      dueSoon: 1,
      approvalPending: 1,
      notRegistered: 1,
    });
  });
});

describe("searchStaff", () => {
  test("by name, ID or Cabang, limited", () => {
    expect(searchStaff(STAFF, "uji bpn").map((s) => s.code)).toEqual(["BPN-03"]);
    expect(searchStaff(STAFF, "cgk-07").map((s) => s.code)).toEqual(["CGK-07"]);
    expect(searchStaff(STAFF, "hlp ilham").map((s) => s.code)).toEqual(["CGK-07"]);
    expect(searchStaff(STAFF, "", 2)).toHaveLength(2);
  });
});

describe("parseNumberText", () => {
  test("decimal comma or point; anything else is null", () => {
    expect(parseNumberText("4,25")).toBe(4.25);
    expect(parseNumberText(" 85.5 ")).toBe(85.5);
    expect(parseNumberText("80")).toBe(80);
    expect(parseNumberText("1.000,5")).toBeNull();
    expect(parseNumberText("abc")).toBeNull();
  });
});

describe("checkPatch (server side)", () => {
  test("trims, turns blanks into null and keeps valid values", () => {
    expect(
      checkPatch({ staff_code: " DPS-01 ", basis: "  ", post_test: "85,5", practice: 4, withdraw_due: "2026-10-31", replacement_name: "A   B" }),
    ).toEqual({
      ok: true,
      patch: { staff_code: "DPS-01", basis: null, post_test: 85.5, practice: 4, withdraw_due: "2026-10-31", replacement_name: "A B" },
    });
  });
  test("refuses unknown keys, bad enums, dates and ranges", () => {
    expect(checkPatch({ id: 3 })).toMatchObject({ ok: false, field: "id" });
    expect(checkPatch({ category: "Coaching" })).toMatchObject({ ok: false, field: "category" });
    expect(checkPatch({ withdraw_status: "selesai" })).toMatchObject({ ok: false, field: "withdraw_status" });
    expect(checkPatch({ started_on: "2026-02-30" })).toMatchObject({ ok: false, field: "started_on" });
    expect(checkPatch({ post_test: 101 })).toMatchObject({ ok: false, field: "post_test" });
    expect(checkPatch({ practice: 0.5 })).toMatchObject({ ok: false, field: "practice" });
    expect(checkPatch({ practice: 4.255 })).toMatchObject({ ok: false, field: "practice" });
    expect(checkPatch({ notes: 5 })).toMatchObject({ ok: false, field: "notes" });
    expect(checkPatch({})).toMatchObject({ ok: false, field: "patch" });
    expect(checkPatch(null)).toMatchObject({ ok: false });
  });
});

describe("patchFromCells", () => {
  test("keeps patch keys only and clears blanks", () => {
    expect(patchFromCells({ staff_code: "DPS-01", flag: "Terlambat", passed: "Lulus", notes: "", post_test: 90 })).toEqual({
      staff_code: "DPS-01",
      notes: null,
      post_test: 90,
    });
  });
});

describe("the form", () => {
  test("a new row starts with the programme defaults", () => {
    expect(newFormValues()).toMatchObject({
      category: "Penggantian",
      withdrawDue: "2026-10-31",
      trainingDue: "2026-11-15",
      directorApproval: "Belum",
      withdrawStatus: "Belum Mulai",
    });
  });

  test("a new row needs the SDM and sends every filled field", () => {
    expect(checkForm(newFormValues(), null)).toEqual({ ok: false, errors: { staffCode: "Pilih SDM dari Tracker Staf." } });
    expect(checkForm({ ...newFormValues("BPN-03"), category: "Strong reminder", basis: " Grooming " }, null)).toEqual({
      ok: true,
      patch: {
        staff_code: "BPN-03",
        category: "Strong reminder",
        basis: "Grooming",
        withdraw_due: "2026-10-31",
        director_approval: "Belum",
        withdraw_status: "Belum Mulai",
        training_due: "2026-11-15",
      },
    });
  });

  test("an edit sends only what changed, with comma decimals parsed", () => {
    const row = view({ id: 7, staffCode: "DPS-01", postTest: 80, practice: 4 });
    const values = { ...formFromRow(row), postTest: "80", practice: "4,25", withdrawStatus: "Selesai", notes: "" };
    expect(formFromRow(row).practice).toBe("4");
    expect(checkForm(values, row)).toEqual({ ok: true, patch: { practice: 4.25, withdraw_status: "Selesai" } });
    expect(checkForm(formFromRow(row), row)).toEqual({ ok: true, patch: {} });
    expect(checkForm({ ...formFromRow(row), postTest: "" }, row)).toEqual({ ok: true, patch: { post_test: null } });
  });

  test("bad numbers and dates stay in the form with a message", () => {
    const row = view({ id: 7, staffCode: "DPS-01" });
    const result = checkForm({ ...formFromRow(row), postTest: "120", practice: "4,555", startedOn: "0002-11-15" }, row);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.postTest).toContain("0 sampai 100");
    expect(result.errors.practice).toContain("2 angka");
    expect(result.errors.startedOn).toContain("Tanggal");
  });

  test("an old row without ID SDM may stay unlinked", () => {
    const row = view({ id: 8, staffCode: null, name: "Nama lama" });
    expect(checkForm({ ...formFromRow(row), notes: "cek" }, row)).toEqual({ ok: true, patch: { notes: "cek" } });
  });

  test("live scores and server field mapping", () => {
    expect(formScores({ postTest: "85,5", practice: "x" })).toEqual({ postTest: 85.5, practice: null });
    expect(formKeyOf("post_test")).toBe("postTest");
    expect(formKeyOf("report_group")).toBe("staffCode");
    expect(formKeyOf("unknown")).toBeNull();
  });
});

