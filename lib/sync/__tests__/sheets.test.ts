import { describe, expect, test } from "bun:test";
import { emptyOps, encodeRaw, tabsToRead, type RealOps } from "../layouts";
import { isoToSerial } from "../normalize";
import { GoogleSheets, a1Column, contiguousDesc, quoteTab } from "../sheets";
import { SYNC_TABLES } from "../tables";
import { smallDb } from "../testing/fixtures";
import { WorkbookWorld } from "../testing/workbook";

/** The v2 workbook tabs the adapter knows, with sheetIds 1..6 in this order. */
const TABS = ["Parameter BMI", "Tracker Staf", "Cek BMI", "Penggantian SDM", "Rencana Aksi", "Laporan Bulanan"];

// Google batchUpdate request objects, loosely typed for assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Req = Record<string, any>;

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
}

function mockFetch(responses: ((c: Call) => { status?: number; json: unknown } | undefined)[] = []) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const call = { method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    for (const r of responses) {
      const hit = r(call);
      if (hit) return new Response(JSON.stringify(hit.json), { status: hit.status ?? 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  return { calls, fetch: f };
}

const token = async () => "test-token";

describe("helpers", () => {
  test("a1Column", () => {
    expect([0, 1, 25, 26, 27, 36, 51, 52, 701, 702].map(a1Column)).toEqual(["A", "B", "Z", "AA", "AB", "AK", "AZ", "BA", "ZZ", "AAA"]);
  });
  test("quoteTab escapes quotes", () => {
    expect(quoteTab("Penggantian SDM")).toBe("'Penggantian SDM'");
    expect(quoteTab("O'Brien")).toBe("'O''Brien'");
  });
  test("contiguousDesc groups rows bottom-up", () => {
    expect(contiguousDesc([2, 3, 4, 9, 7, 8, 12])).toEqual([[12, 12], [7, 9], [2, 4]]);
  });
  test("encodeRaw: dates as serials, null clears, text stays literal", () => {
    expect(encodeRaw("2026-10-12", "date")).toBe(isoToSerial("2026-10-12"));
    expect(encodeRaw(null, "text")).toBe("");
    expect(encodeRaw("=SUM(A1)", "text")).toBe("=SUM(A1)");
    expect(encodeRaw("1234", "text")).toBe("1234");
  });
});

const META = (sheets: { title: string; sheetId: number }[], locale = "in_ID", timeZone = "Asia/Jakarta") => (c: Call) =>
  c.url.includes("?fields=")
    ? { json: { properties: { locale, timeZone }, sheets: sheets.map((s) => ({ properties: { ...s, gridProperties: { rowCount: 1000, columnCount: 26 } } })) } }
    : undefined;

describe("GoogleSheets.read", () => {
  test("one metadata call + values and formulas for the synced tabs only", async () => {
    const m = mockFetch([
      META([{ title: "Tracker Staf", sheetId: 1 }, { title: "Dashboard", sheetId: 2 }], "en_US", "America/Los_Angeles"),
      (c) =>
        c.url.includes("values:batchGet")
          ? { json: { valueRanges: [{ values: c.url.includes("FORMULA") ? [["ID SDM", "=B5"]] : [["ID SDM", "SUB-01"]] }] } }
          : undefined,
    ]);
    const gs = new GoogleSheets("sheet-id", token, { fetch: m.fetch });
    const real = await gs.read(tabsToRead());
    expect(m.calls).toHaveLength(3);
    expect(m.calls.every((c) => c.method === "GET")).toBe(true);
    const urls = m.calls.slice(1).map((c) => decodeURIComponent(c.url.replace(/\+/g, " ")));
    expect(urls.some((u) => u.includes("valueRenderOption=UNFORMATTED_VALUE"))).toBe(true);
    expect(urls.some((u) => u.includes("valueRenderOption=FORMULA"))).toBe(true);
    expect(urls.every((u) => u.includes("ranges='Tracker Staf'") && !u.includes("Dashboard") && u.includes("dateTimeRenderOption=SERIAL_NUMBER"))).toBe(true);
    expect(real.tabs["Tracker Staf"]).toMatchObject({ values: [["ID SDM", "SUB-01"]], formulas: [["ID SDM", "=B5"]], rowCount: 1000 });
    expect(real.tabs["Rencana Aksi"]).toBeUndefined();
    expect(real.locale).toBe("en_US");
    expect(SYNC_TABLES.length).toBe(6);
  });

  test("retries 429 and 5xx, then surfaces a SheetsError without a token in the message", async () => {
    let n = 0;
    const m = mockFetch([() => (n++ < 2 ? { status: 429, json: { error: { status: "RESOURCE_EXHAUSTED" } } } : { json: { properties: {}, sheets: [] } })]);
    await new GoogleSheets("id", token, { fetch: m.fetch, retryDelayMs: 1 }).read(["Tracker Staf"]);
    expect(m.calls).toHaveLength(3);

    const deny = mockFetch([() => ({ status: 403, json: { error: { status: "PERMISSION_DENIED", message: "The caller does not have permission" } } })]);
    await expect(new GoogleSheets("id", token, { fetch: deny.fetch, retryDelayMs: 1 }).read(["Tracker Staf"])).rejects.toThrow(/403 PERMISSION_DENIED/);
    expect(deny.calls).toHaveLength(1);
  });
});

async function applyWith(ops: RealOps, ids = new Map<number, number | string>(), locale = "in_ID", timeZone = "Asia/Jakarta") {
  const sheets = TABS.map((title, i) => ({ title, sheetId: i + 1 }));
  const m = mockFetch([META(sheets, locale, timeZone), (c) => (c.url.includes("values:batchGet") ? { json: { valueRanges: sheets.map(() => ({ values: [] })) } } : undefined)]);
  const gs = new GoogleSheets("id", token, { fetch: m.fetch });
  await gs.read(sheets.map((s) => s.title));
  m.calls.length = 0;
  await gs.apply(ops, ids);
  return m.calls;
}

describe("GoogleSheets.apply", () => {
  test("a refused locale does not block the sync: time zone alone, then the rest of the setup", async () => {
    const w = new WorkbookWorld(smallDb());
    const { ops } = w.prepare();
    const sheets = TABS.map((title, i) => ({ title, sheetId: i + 1 }));
    let refused = 0;
    const m = mockFetch([
      META(sheets, "en_US", "America/Los_Angeles"),
      (c) => (c.url.includes("values:batchGet") ? { json: { valueRanges: sheets.map(() => ({ values: [] })) } } : undefined),
      (c) => {
        const first = (c.body?.requests as Req[] | undefined)?.[0]?.updateSpreadsheetProperties;
        if (first?.properties?.locale && refused++ === 0) {
          return { status: 400, json: { error: { status: "INVALID_ARGUMENT", message: "Invalid requests[0].updateSpreadsheetProperties: Unsupported locale: in_ID" } } };
        }
        return undefined;
      },
    ]);
    const gs = new GoogleSheets("id", token, { fetch: m.fetch, retryDelayMs: 1 });
    await gs.read(sheets.map((s) => s.title));
    m.calls.length = 0;
    await gs.apply(ops, new Map());
    const setups = m.calls.filter((c) => (c.body?.requests as Req[] | undefined)?.[0]?.updateSpreadsheetProperties);
    expect(setups).toHaveLength(2);
    expect((setups[1].body!.requests as Req[])[0].updateSpreadsheetProperties).toEqual({ properties: { timeZone: "Asia/Jakarta" }, fields: "timeZone" });
    expect((setups[1].body!.requests as Req[]).some((r) => r.updateCells?.rows?.[0]?.values?.[0]?.userEnteredValue?.stringValue === "ID Sistem")).toBe(true);
    expect(m.calls.some((c) => c.url.endsWith("values:batchUpdate"))).toBe(true);
  });

  test("locale and time zone are set once: a Jakarta sheet is left alone whatever its locale", async () => {
    const w = new WorkbookWorld(smallDb());
    const { ops } = w.prepare();
    const calls = await applyWith(ops, new Map(), "en_US");
    const setup = (calls.find((c) => c.url.endsWith(":batchUpdate"))?.body?.requests ?? []) as Req[];
    expect(setup.some((r) => r.updateSpreadsheetProperties)).toBe(false);
  });

  test("first sync of the workbook: locale, id columns (format copied, ID Sistem hidden), then RAW values", async () => {
    const w = new WorkbookWorld(smallDb());
    const { ops } = w.prepare();
    const calls = await applyWith(ops, new Map(), "en_US", "America/Los_Angeles");
    const setup = calls[0].body!.requests as Req[];
    expect(calls[0].url).toEndWith(":batchUpdate");
    expect(setup[0].updateSpreadsheetProperties.properties).toEqual({ locale: "in_ID", timeZone: "Asia/Jakarta" });
    expect(setup.some((r) => r.addSheet)).toBe(false);
    const formats = setup.filter((r) => r.copyPaste?.pasteType === "PASTE_FORMAT").map((r) => [r.copyPaste.destination.sheetId, r.copyPaste.destination.startColumnIndex]);
    expect(formats).toEqual([[2, 22], [4, 18], [4, 19], [5, 13]]);
    expect(setup.filter((r) => r.updateDimensionProperties).map((r) => r.updateDimensionProperties)).toMatchObject([
      { range: { sheetId: 4, dimension: "COLUMNS", startIndex: 18, endIndex: 19 }, properties: { hiddenByUser: true } },
      { range: { sheetId: 5, dimension: "COLUMNS", startIndex: 13, endIndex: 14 }, properties: { hiddenByUser: true } },
    ]);
    const header = setup.filter((r) => r.updateCells).map((r) => [r.updateCells.range.sheetId, r.updateCells.range.startRowIndex, r.updateCells.rows[0].values[0].userEnteredValue.stringValue]);
    expect(header).toEqual([[2, 3, "ID SDM"], [4, 3, "ID Sistem"], [4, 3, "ID SDM"], [5, 3, "ID Sistem"]]);

    const values = calls.find((c) => c.url.endsWith("values:batchUpdate"))!;
    expect(values.body!.valueInputOption).toBe("RAW");
    const data = values.body!.data as { range: string; values: unknown[][] }[];
    expect(data).toContainEqual({ range: "'Tracker Staf'!W5", values: [["SUB-01"]] });
    expect(data).toContainEqual({ range: "'Penggantian SDM'!S5", values: [[1]] });
    expect(data).toContainEqual({ range: "'Rencana Aksi'!N6", values: [[2]] });
    expect(calls.some((c) => c.url.includes(":append"))).toBe(false);
    expect(calls.some((c) => (c.body?.requests as Req[] | undefined)?.some((r) => r.addProtectedRange || r.deleteDimension))).toBe(false);
  });

  test("formula copies (PASTE_FORMULA) and notes go in one structural batch after the values", async () => {
    const ops = emptyOps();
    ops.writes.push({ table: "pd_action_plans", tab: "Rencana Aksi", row: 60, col: 2, value: "Tindakan baru" });
    ops.formulaCopies.push({ table: "pd_action_plans", tab: "Rencana Aksi", fromRow: 5, toRow: 60, cols: [12] });
    ops.formulaCopies.push({ table: "pd_staff", tab: "Tracker Staf", fromRow: 5, toRow: 61, cols: [18, 21] });
    ops.notes.push({ table: "pd_bmi_checks", tab: "Cek BMI", row: 6, col: 8, text: "JOUMPA sync: Di luar rentang 120–210." });
    ops.grow.push({ table: "pd_action_plans", tab: "Rencana Aksi", rowCount: 1100 });
    const calls = await applyWith(ops);
    expect((calls[0].body!.requests as Req[])[0].updateSheetProperties.properties).toEqual({ sheetId: 5, gridProperties: { rowCount: 1100 } });
    expect(calls[1].url).toEndWith("values:batchUpdate");
    expect(calls[1].body!.data).toEqual([{ range: "'Rencana Aksi'!C60", values: [["Tindakan baru"]] }]);
    const structural = calls[2].body!.requests as Req[];
    expect(structural.slice(0, 3).map((r) => [r.copyPaste.pasteType, r.copyPaste.source.sheetId, r.copyPaste.source.startRowIndex, r.copyPaste.destination.startRowIndex, r.copyPaste.destination.startColumnIndex])).toEqual([
      ["PASTE_FORMULA", 5, 4, 59, 12],
      ["PASTE_FORMULA", 2, 4, 60, 18],
      ["PASTE_FORMULA", 2, 4, 60, 21],
    ]);
    expect(structural[3].updateCells).toMatchObject({ fields: "note", range: { sheetId: 3, startRowIndex: 5, startColumnIndex: 8 } });
  });

  test("ids resolved after the DB insert; unknown refs skipped; skipped tables untouched", async () => {
    const ops = emptyOps();
    ops.writes.push({ table: "pd_replacements", tab: "Penggantian SDM", row: 6, col: 18, value: null, ref: 1 });
    ops.writes.push({ table: "pd_replacements", tab: "Penggantian SDM", row: 7, col: 18, value: null, ref: 2 });
    ops.writes.push({ table: "pd_action_plans", tab: "Rencana Aksi", row: 5, col: 6, value: "PIC" });
    const sheets = ["Penggantian SDM", "Rencana Aksi"].map((title, i) => ({ title, sheetId: i + 1 }));
    const m = mockFetch([META(sheets), (c) => (c.url.includes("batchGet") ? { json: { valueRanges: [{}, {}] } } : undefined)]);
    const gs = new GoogleSheets("id", token, { fetch: m.fetch });
    await gs.read(sheets.map((s) => s.title));
    m.calls.length = 0;
    await gs.apply(ops, new Map([[1, 42]]), { skipTables: new Set(["pd_action_plans"]) });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].body!.data).toEqual([{ range: "'Penggantian SDM'!S6", values: [[42]] }]);
  });

  // BUG (lib/sync/sheets.ts GoogleSheets.apply, step 2 "values": `value = typeof id === "string" ?
  // Number(id) : id`): pd_staff's generated key is a text code. A person typed into Tracker Staf without
  // an ID SDM is inserted, the DB returns "SUB-03", and the adapter writes Number("SUB-03") = NaN,
  // which JSON-encodes as null: W stays empty. The next run can only re-link the row by adoption
  // (Stn + Nama); if those changed meanwhile, or two id-less rows match, the person is inserted again.
  test("a generated pd_staff code is written to the sheet as text", async () => {
    const ops = emptyOps();
    ops.writes.push({ table: "pd_staff", tab: "Tracker Staf", row: 9, col: 22, value: null, ref: 1 });
    ops.writes.push({ table: "pd_replacements", tab: "Penggantian SDM", row: 6, col: 18, value: null, ref: 2 });
    const calls = await applyWith(ops, new Map<number, number | string>([[1, "SUB-03"], [2, "7"]]));
    expect(calls[0].body!.data).toEqual([
      { range: "'Tracker Staf'!W9", values: [["SUB-03"]] },
      { range: "'Penggantian SDM'!S6", values: [[7]] },
    ]);
  });

  test("no requests at all when there is nothing to do and the locale is right", async () => {
    const calls = await applyWith(emptyOps());
    expect(calls).toEqual([]);
  });
});
