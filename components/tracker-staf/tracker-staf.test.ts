import { describe, expect, test } from "bun:test";
import { parseCell } from "@/lib/grid/values";
import type { WorkspaceStaff } from "@/lib/workspace";
import {
  COLUMNS,
  FIELD_RULES,
  PATCH_KEYS,
  PIC_KEYS,
  coachingItems,
  coachingItemsText,
  isPicKey,
  type TrackerRow,
} from "./fields";
import { changesToPatch, checkPatch, diffDraft, draftOf, parsePractice } from "./patch";
import { NO_PROPOSAL, filterRows, matchesSearch, needsDecision, parseFilters, scopeRows, slug, summarize, toRows, toScore } from "./rows";

const TODAY = "2026-10-19";

function row(over: Partial<TrackerRow> = {}): TrackerRow {
  return {
    no: 1,
    code: "SUB-01",
    name: "Petugas Contoh",
    station: "SUB",
    reportGroup: "SUB",
    nipp: null,
    gender: null,
    proposal: null,
    initialCoaching: null,
    coachingItems: null,
    initialPractice: null,
    mainAction: null,
    mainDue: null,
    pic: null,
    mainStatus: null,
    extraAction: null,
    extraDue: null,
    extraStatus: null,
    reassessedOn: null,
    reassessPractice: null,
    recoaching: null,
    finalDecision: null,
    progressNotes: null,
    changedLabel: "Diubah lewat pengelola, akun cabang, atau Google Sheet",
    bmiChecks: 0,
    replacements: 0,
    ...over,
  };
}

describe("column model", () => {
  test("workbook order, frozen identity first", () => {
    expect(COLUMNS.map((c) => c.header).slice(0, 5)).toEqual(["No", "ID", "Nama", "Cabang", "Stn"]);
    expect(COLUMNS.filter((c) => c.frozen).map((c) => c.key)).toEqual(["no", "code", "name"]);
    const firstUnfrozen = COLUMNS.findIndex((c) => !c.frozen);
    expect(COLUMNS.slice(firstUnfrozen).some((c) => c.frozen)).toBe(false);
    expect(COLUMNS.map((c) => c.key).slice(-4)).toEqual(["final_decision", "progress_notes", "flag", "changed"]);
  });

  test("every editable column is an RPC patch key with value rules", () => {
    for (const c of COLUMNS) {
      if (c.readonly) continue;
      expect((PATCH_KEYS as readonly string[]).includes(c.key)).toBe(true);
      if (c.key !== "station") expect(FIELD_RULES[c.key as keyof typeof FIELD_RULES]).toBeDefined();
    }
    expect(COLUMNS.filter((c) => c.readonly).map((c) => c.key)).toEqual(["no", "code", "report_group", "result", "flag", "changed"]);
  });

  test("the cream PIC columns", () => {
    expect([...PIC_KEYS]).toEqual([
      "main_status",
      "extra_status",
      "reassessed_on",
      "reassess_practice",
      "recoaching",
      "final_decision",
      "progress_notes",
    ]);
    expect(isPicKey("reassess_practice")).toBe(true);
    expect(isPicKey("main_action")).toBe(false);
  });

  test("groups are adjacent (one header each)", () => {
    const seen: string[] = [];
    let last: string | undefined;
    for (const c of COLUMNS) {
      if (c.group && c.group !== last) {
        expect(seen.includes(c.group)).toBe(false);
        seen.push(c.group);
      }
      last = c.group;
    }
  });

  test("practice columns take a decimal comma, 1 to 5, two decimals", () => {
    expect(parseCell(FIELD_RULES.reassess_practice, "4,17")).toEqual({ ok: true, value: 4.17 });
    expect(parseCell(FIELD_RULES.reassess_practice, "3.5")).toEqual({ ok: true, value: 3.5 });
    expect(parseCell(FIELD_RULES.reassess_practice, "5,5").ok).toBe(false);
    expect(parseCell(FIELD_RULES.reassess_practice, "4,175").ok).toBe(false);
    expect(parseCell(FIELD_RULES.main_status, "selesai")).toEqual({ ok: true, value: "Selesai" });
    expect(parseCell(FIELD_RULES.reassessed_on, "13/11/2026")).toEqual({ ok: true, value: "2026-11-13" });
  });
});

describe("coaching items", () => {
  test("codes with their meaning, unknown codes kept", () => {
    expect(coachingItems("C01, c02;X9 C01")).toEqual([
      { code: "C01", meaning: "Produk JOUMPA" },
      { code: "C02", meaning: "Tahapan layanan / WI" },
      { code: "X9", meaning: null },
    ]);
    expect(coachingItems("A01 D08")).toHaveLength(2);
    expect(coachingItemsText("A07")).toBe("A07 Sepatu (pantofel)");
    expect(coachingItems(null)).toEqual([]);
  });

});

describe("practice numbers", () => {
  test("comma or dot, 1 to 5, at most two decimals", () => {
    expect(parsePractice("4,17")).toBe(4.17);
    expect(parsePractice(" 4.17 ")).toBe(4.17);
    expect(parsePractice(4.17)).toBe(4.17);
    expect(parsePractice("")).toBeNull();
    expect(parsePractice(null)).toBeNull();
    for (const bad of ["0,9", "5,01", "4,175", "abc", "4,1,2"]) expect(Number.isNaN(parsePractice(bad))).toBe(true);
    expect(Number.isNaN(parsePractice(6))).toBe(true);
  });

  test("numeric(4,2) from the database as number or string", () => {
    expect(toScore(4.17)).toBe(4.17);
    expect(toScore("4.17")).toBe(4.17);
    expect(toScore(null)).toBeNull();
    expect(toScore("")).toBeNull();
  });
});

describe("patches", () => {
  test("grid changes become a patch; computed keys are dropped, blanks clear", () => {
    expect(changesToPatch({ main_status: "Selesai", result: "Sesuai", progress_notes: " ", reassess_practice: 4.17 })).toEqual({
      main_status: "Selesai",
      progress_notes: null,
      reassess_practice: 4.17,
    });
  });

  test("the server check normalises and rejects", () => {
    expect(
      checkPatch({ reassess_practice: "4,17", reassessed_on: "13/11/2026", main_status: "selesai", pic: "  Rina  Ayu ", extra_due: "" }),
    ).toEqual({
      ok: true,
      patch: { reassess_practice: 4.17, reassessed_on: "2026-11-13", main_status: "Selesai", pic: "Rina Ayu", extra_due: null },
    });
    expect(checkPatch({ reassess_practice: "3,999" })).toMatchObject({ ok: false, field: "reassess_practice" });
    expect(checkPatch({ final_decision: "Pecat" })).toMatchObject({ ok: false, field: "final_decision" });
    expect(checkPatch({ updated_at: "x" })).toMatchObject({ ok: false, field: "patch" });
    expect(checkPatch({ main_due: "31/02/2026" })).toMatchObject({ ok: false, field: "main_due" });
    expect(checkPatch({ name: "" })).toMatchObject({ ok: false, field: "name" });
    expect(checkPatch({})).toMatchObject({ ok: false, field: "patch" });
    expect(checkPatch("x")).toMatchObject({ ok: false });
  });

  test("a new staff member needs a station and a name", () => {
    expect(checkPatch({ name: "Budi" }, { isNew: true })).toMatchObject({ ok: false, field: "station" });
    expect(checkPatch({ station: "bpn" }, { isNew: true })).toMatchObject({ ok: false, field: "name" });
    expect(checkPatch({ station: "bpn", name: "Budi", gender: "l", proposal: "pembinaan" }, { isNew: true })).toEqual({
      ok: true,
      patch: { station: "BPN", name: "Budi", gender: "L", proposal: "Pembinaan" },
    });
  });

  test("the dialog sends only what changed (the sheet guide example)", () => {
    const r = row({ proposal: "Coaching intensif", mainStatus: "Proses", reassessPractice: null });
    const draft = { ...draftOf(r), main_status: "Selesai", reassessed_on: "2026-11-13", reassess_practice: "4,17" };
    expect(diffDraft(r, draft, ["SUB", "DPS"])).toEqual({
      patch: { main_status: "Selesai", reassessed_on: "2026-11-13", reassess_practice: 4.17 },
      errors: {},
    });
  });

  test("the dialog reports invalid fields and keeps them out", () => {
    const r = row({ reassessPractice: 3.5 });
    expect(draftOf(r).reassess_practice).toBe("3,5");
    const result = diffDraft(r, { ...draftOf(r), reassess_practice: "7", name: "", station: "XYZ" }, ["SUB"]);
    expect(Object.keys(result.errors).sort()).toEqual(["name", "reassess_practice", "station"]);
    expect(result.patch).toEqual({});
    expect(diffDraft(r, { ...draftOf(r), reassess_practice: "3,50" }, ["SUB"]).patch).toEqual({});
  });
});

describe("rows, filters and summary", () => {
  const ws = {
    linkId: null,
    linkLabels: {},
    bmiChecks: [{ staffCode: "SUB-01" }, { staffCode: "SUB-01" }],
    replacements: [{ staffCode: "SUB-01" }, { staffCode: null }],
  } as unknown as Parameters<typeof toRows>[1];

  test("rows are numbered in list order and carry the delete counts", () => {
    const staff = [
      { code: "SUB-01", name: "A", station: "SUB", reportGroup: "SUB", initialPractice: "3.50", reassessPractice: 4.17 },
      { code: "DPS-01", name: "B", station: "DPS", reportGroup: "DPS" },
    ] as unknown as WorkspaceStaff[];
    const rows = toRows(staff, ws);
    expect(rows.map((r) => [r.no, r.code, r.bmiChecks, r.replacements])).toEqual([
      [1, "SUB-01", 2, 1],
      [2, "DPS-01", 0, 0],
    ]);
    expect(rows[0].initialPractice).toBe(3.5);
    expect(rows[0].changedLabel).toBe("Diubah lewat pengelola, akun cabang, atau Google Sheet");
  });

  const scope = { groups: ["CGK & HLP", "DPS", "SUB"], groupOf: { CGK: "CGK & HLP", HLP: "CGK & HLP", DPS: "DPS", SUB: "SUB" } };

  test("URL filters: slugs or labels, unknown means all, a station sets its Cabang", () => {
    expect(parseFilters({ cabang: "cgk-hlp", usulan: "coaching-intensif", flag: "jatuh-tempo-7-hari" }, { ...scope, station: null })).toEqual({
      group: "CGK & HLP",
      station: null,
      proposal: "Coaching intensif",
      flag: "Jatuh tempo ≤ 7 hari",
    });
    expect(parseFilters({ cabang: "DPS" }, { ...scope, station: "HLP" }).group).toBe("CGK & HLP");
    expect(parseFilters({ cabang: "x", usulan: "y", flag: "z" }, { ...scope, station: null })).toEqual({
      group: null,
      station: null,
      proposal: null,
      flag: null,
    });
    expect(parseFilters({ usulan: NO_PROPOSAL }, { ...scope, station: null }).proposal).toBe(NO_PROPOSAL);
    expect(slug("CGK & HLP")).toBe("cgk-hlp");
  });

  const rows = [
    row({ code: "CGK-01", station: "CGK", reportGroup: "CGK & HLP", proposal: "Coaching intensif", mainDue: "2026-10-10" }),
    row({ code: "HLP-01", station: "HLP", reportGroup: "CGK & HLP", proposal: "Coaching intensif", reassessPractice: 3.5 }),
    row({
      code: "DPS-01",
      station: "DPS",
      reportGroup: "DPS",
      proposal: "Coaching intensif",
      mainStatus: "Selesai",
      extraStatus: "Batal / N.A.",
      reassessedOn: "2026-11-13",
      reassessPractice: 4.17,
    }),
    row({ code: "SUB-01", station: "SUB", reportGroup: "SUB", proposal: "Pembinaan", mainDue: "2026-10-24" }),
    row({ code: "SUB-02", name: "Siti Rahma", nipp: "12345", station: "SUB", reportGroup: "SUB" }),
  ];

  test("filters by Cabang, station, Usulan (incl. blank) and Flag", () => {
    const all = { group: null, station: null, proposal: null, flag: null };
    expect(scopeRows(rows, { group: "CGK & HLP", station: null }).map((r) => r.code)).toEqual(["CGK-01", "HLP-01"]);
    expect(filterRows(rows, { ...all, station: "SUB" }, TODAY).map((r) => r.code)).toEqual(["SUB-01", "SUB-02"]);
    expect(filterRows(rows, { ...all, proposal: NO_PROPOSAL }, TODAY).map((r) => r.code)).toEqual(["SUB-02"]);
    expect(filterRows(rows, { ...all, flag: "Terlambat" }, TODAY).map((r) => r.code)).toEqual(["CGK-01"]);
    expect(filterRows(rows, { ...all, flag: "Jatuh tempo ≤ 7 hari" }, TODAY).map((r) => r.code)).toEqual(["SUB-01"]);
    expect(filterRows(rows, { ...all, flag: "Selesai", proposal: "Coaching intensif" }, TODAY).map((r) => r.code)).toEqual(["DPS-01"]);
  });

  test("search by name, ID or NIPP", () => {
    expect(matchesSearch(rows[4], "siti  rah")).toBe(true);
    expect(matchesSearch(rows[4], "sub-02")).toBe(true);
    expect(matchesSearch(rows[4], "123")).toBe(true);
    expect(matchesSearch(rows[4], "dps")).toBe(false);
    expect(matchesSearch(rows[4], "  ")).toBe(true);
  });

  test("summary counts per Usulan and Flag, re-assessment and pending decisions", () => {
    const s = summarize(rows, TODAY);
    expect(s.total).toBe(5);
    expect(s.proposals.map((p) => [p.label, p.count])).toEqual([
      ["Coaching intensif", 3],
      ["Pembinaan", 1],
      ["Penggantian", 0],
      ["Siap bertugas", 0],
      ["Strong reminder", 0],
      ["Belum diisi", 1],
    ]);
    expect(s.flags).toEqual([
      { flag: "Selesai", count: 1 },
      { flag: "Terlambat", count: 1 },
      { flag: "Jatuh tempo ≤ 7 hari", count: 1 },
      { flag: "On track", count: 2 },
    ]);
    expect([s.intensive, s.intensiveReassessed, s.reassessed, s.compliant, s.notCompliant, s.awaitingDecision]).toEqual([3, 2, 2, 1, 1, 1]);
    expect(rows.filter(needsDecision).map((r) => r.code)).toEqual(["HLP-01"]);
    expect(needsDecision({ reassessPractice: 3.5, finalDecision: "Diganti" })).toBe(false);
  });
});
