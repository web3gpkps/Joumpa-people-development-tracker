/**
 * Google Sheets REST v4 adapter (plain fetch + a service-account token from google-auth-library).
 *
 * Read: one metadata GET + two values:batchGet over the synced tabs (UNFORMATTED_VALUE with dates as
 * serials, and FORMULA so formula cells can be told apart from inputs).
 * Write (RealOps from lib/sync/layouts.ts), in this order:
 *   1. spreadsheets:batchUpdate  setup: locale/time zone, engine-owned tabs (if any),
 *                                 extra header cells (Penggantian SDM: ID Sistem, ID SDM), grid growth
 *   2. values:batchUpdate RAW    cell writes (dates as serial numbers into pre-formatted cells)
 *   3. spreadsheets:batchUpdate  formula copies for new rows (PASTE_FORMULA), notes, engine-tab row deletes
 *   4. values:append             new rows on the engine-owned tab (INSERT_ROWS)
 * Text is always written RAW, so "=SUM(...)" or "1234" stays literal text.
 */
import { JWT } from "google-auth-library";
import { loadServiceAccount } from "./credentials";
import type { RealOps, RealSnapshot, RealTab } from "./layouts";
import type { TableSpec } from "./types";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
// Google Sheets names Indonesian with the legacy code "in" (as it uses "iw" for Hebrew); "id_ID" is
// rejected with "Unsupported locale".
export const TARGET_LOCALE = "in_ID";
export const TARGET_TZ = "Asia/Jakarta";

/**
 * The spreadsheet's locale and time zone are set once, on the first sync (while the time zone is not
 * Jakarta yet). After that the engine leaves them alone, so a later manual change is not undone.
 */
export function needsSheetSetup(timeZone: string | undefined): boolean {
  return timeZone !== TARGET_TZ;
}

export class SheetsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly googleStatus?: string,
  ) {
    super(message);
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SheetsPort {
  read(tabs: string[]): Promise<RealSnapshot>;
  apply(ops: RealOps, ids: Map<number, number | string>, opts?: { skipTables?: Set<string> }): Promise<void>;
}

export function a1Column(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const quoteTab = (title: string) => `'${title.replace(/'/g, "''")}'`;
const cellRange = (tab: string, row: number, col: number) => `${quoteTab(tab)}!${a1Column(col)}${row}`;

export function serviceAccountTokenSource(
  env: Record<string, string | undefined> = process.env,
  scopes: string[] = [SCOPE],
): () => Promise<string> {
  let jwt: JWT | null = null;
  return async () => {
    if (!jwt) {
      const sa = loadServiceAccount(env);
      jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes });
    }
    const { token } = await jwt.getAccessToken();
    if (!token) throw new SheetsError("Google did not return an access token.", 401);
    return token;
  };
}

export class GoogleSheets implements SheetsPort {
  private meta = new Map<string, { sheetId: number; rowCount: number; columnCount: number }>();
  private locale?: string;
  private timeZone?: string;

  constructor(
    private readonly spreadsheetId: string,
    private readonly token: () => Promise<string>,
    private readonly opts: { fetch?: FetchLike; setLocale?: boolean; retryDelayMs?: number } = {},
  ) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): GoogleSheets {
    const id = env.GOOGLE_SHEETS_ID;
    if (!id) throw new SheetsError("GOOGLE_SHEETS_ID is not set.", 500);
    return new GoogleSheets(id, serviceAccountTokenSource(env), { setLocale: env.SYNC_SHEET_LOCALE !== "off" });
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const f = this.opts.fetch ?? fetch;
    const delay = this.opts.retryDelayMs ?? 1000;
    for (let attempt = 0; ; attempt++) {
      const res = await f(`${API}/${encodeURIComponent(this.spreadsheetId)}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, delay * 2 ** attempt));
        continue;
      }
      const err = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
      const msg = (err.error?.message ?? res.statusText).slice(0, 200);
      throw new SheetsError(`Google Sheets ${method} failed (${res.status} ${err.error?.status ?? ""}): ${msg}`, res.status, err.error?.status);
    }
  }

  async read(tabs: string[]): Promise<RealSnapshot> {
    const meta = await this.call<{
      properties: { locale?: string; timeZone?: string };
      sheets: { properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
    }>("GET", `?fields=${encodeURIComponent("properties(locale,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))")}`);
    this.locale = meta.properties.locale;
    this.timeZone = meta.properties.timeZone;
    this.meta.clear();
    for (const s of meta.sheets) {
      this.meta.set(s.properties.title, {
        sheetId: s.properties.sheetId,
        rowCount: s.properties.gridProperties?.rowCount ?? 1000,
        columnCount: s.properties.gridProperties?.columnCount ?? 26,
      });
    }
    const present = tabs.filter((t) => this.meta.has(t));
    const snapshot: RealSnapshot = { tabs: {}, locale: this.locale, timeZone: this.timeZone };
    if (present.length === 0) return snapshot;
    const get = (render: "UNFORMATTED_VALUE" | "FORMULA") => {
      const params = new URLSearchParams({ valueRenderOption: render, dateTimeRenderOption: "SERIAL_NUMBER", majorDimension: "ROWS" });
      for (const t of present) params.append("ranges", quoteTab(t));
      return this.call<{ valueRanges: { values?: unknown[][] }[] }>("GET", `/values:batchGet?${params}`);
    };
    const [vals, formulas] = await Promise.all([get("UNFORMATTED_VALUE"), get("FORMULA")]);
    present.forEach((title, i) => {
      const m = this.meta.get(title)!;
      const tab: RealTab = {
        title,
        sheetId: m.sheetId,
        values: vals.valueRanges[i]?.values ?? [],
        formulas: formulas.valueRanges[i]?.values ?? [],
        rowCount: m.rowCount,
        columnCount: m.columnCount,
      };
      snapshot.tabs[title] = tab;
    });
    return snapshot;
  }

  async apply(ops: RealOps, ids: Map<number, number | string>, opts: { skipTables?: Set<string> } = {}): Promise<void> {
    const keep = <T extends { table: string }>(xs: T[]) => xs.filter((x) => !opts.skipTables?.has(x.table));
    const used = new Set([...this.meta.values()].map((m) => m.sheetId));
    const newId = () => {
      let id: number;
      do id = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
      while (used.has(id));
      used.add(id);
      return id;
    };
    const sheetIdOf = new Map<string, number>([...this.meta].map(([t, m]) => [t, m.sheetId]));

    // 1. setup
    const setup: unknown[] = [];
    // TODAY() in the workbook must be the Jakarta date, and typed dates must parse as D/M/Y.
    const localeRequest = { updateSpreadsheetProperties: { properties: { locale: TARGET_LOCALE, timeZone: TARGET_TZ }, fields: "locale,timeZone" } };
    if (this.opts.setLocale !== false && needsSheetSetup(this.timeZone)) setup.push(localeRequest);
    for (const t of keep(ops.createTabs)) {
      let sheetId = sheetIdOf.get(t.tab);
      if (!t.exists || sheetId === undefined) {
        sheetId = newId();
        sheetIdOf.set(t.tab, sheetId);
        setup.push({
          addSheet: {
            properties: {
              sheetId,
              title: t.tab,
              gridProperties: { rowCount: Math.max(1000, t.minRows), columnCount: Math.max(26, t.header.length), frozenRowCount: 1 },
            },
          },
        });
      }
      setup.push(...engineTabLayout(t.spec, t.header, sheetId));
    }
    for (const h of keep(ops.headerCells)) {
      const sheetId = sheetIdOf.get(h.tab)!;
      if (h.col > 0) {
        // Same look as the header cell to its left.
        setup.push({
          copyPaste: {
            source: { sheetId, startRowIndex: h.row - 1, endRowIndex: h.row, startColumnIndex: h.col - 1, endColumnIndex: h.col },
            destination: { sheetId, startRowIndex: h.row - 1, endRowIndex: h.row, startColumnIndex: h.col, endColumnIndex: h.col + 1 },
            pasteType: "PASTE_FORMAT",
          },
        });
      }
      setup.push({
        updateCells: {
          range: { sheetId, startRowIndex: h.row - 1, endRowIndex: h.row, startColumnIndex: h.col, endColumnIndex: h.col + 1 },
          rows: [{ values: [{ userEnteredValue: { stringValue: h.text } }] }],
          fields: "userEnteredValue",
        },
      });
      if (h.hide) {
        setup.push({
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: h.col, endIndex: h.col + 1 },
            properties: { hiddenByUser: true },
            fields: "hiddenByUser",
          },
        });
      }
    }
    for (const g of keep(ops.grow)) {
      const m = this.meta.get(g.tab);
      if (m && g.rowCount > m.rowCount) {
        setup.push({ updateSheetProperties: { properties: { sheetId: m.sheetId, gridProperties: { rowCount: g.rowCount } }, fields: "gridProperties.rowCount" } });
      }
    }
    if (setup.length) {
      try {
        await this.call("POST", ":batchUpdate", { requests: setup });
      } catch (e) {
        // A locale Google refuses must not block the sync: set the time zone alone and carry on.
        if (!(e instanceof SheetsError) || e.status !== 400 || !/locale/i.test(e.message) || setup[0] !== localeRequest) throw e;
        console.warn(`Sheets refused locale ${TARGET_LOCALE}; setting the time zone only.`);
        setup[0] = { updateSpreadsheetProperties: { properties: { timeZone: TARGET_TZ }, fields: "timeZone" } };
        await this.call("POST", ":batchUpdate", { requests: setup });
      }
    }

    // 2. values
    const data: { range: string; values: unknown[][] }[] = [];
    for (const w of keep(ops.writes)) {
      let value = w.value;
      if (w.ref !== undefined) {
        const id = ids.get(w.ref);
        if (id === undefined) continue;
        // Identity ids may arrive as numeric strings; text codes (pd_staff, e.g. "SUB-03") stay text.
        value = typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id;
      }
      data.push({ range: cellRange(w.tab, w.row, w.col), values: [[value]] });
    }
    for (let i = 0; i < data.length; i += 1000) {
      await this.call("POST", "/values:batchUpdate", { valueInputOption: "RAW", data: data.slice(i, i + 1000) });
    }

    // 3. formula copies, notes, then engine-tab row deletes bottom-up
    const structural: unknown[] = [];
    for (const f of keep(ops.formulaCopies)) {
      const sheetId = sheetIdOf.get(f.tab)!;
      for (const c of f.cols) {
        structural.push({
          copyPaste: {
            source: { sheetId, startRowIndex: f.fromRow - 1, endRowIndex: f.fromRow, startColumnIndex: c, endColumnIndex: c + 1 },
            destination: { sheetId, startRowIndex: f.toRow - 1, endRowIndex: f.toRow, startColumnIndex: c, endColumnIndex: c + 1 },
            pasteType: "PASTE_FORMULA",
          },
        });
      }
    }
    for (const n of keep(ops.notes)) {
      const sheetId = sheetIdOf.get(n.tab)!;
      structural.push({
        updateCells: {
          range: { sheetId, startRowIndex: n.row - 1, endRowIndex: n.row, startColumnIndex: n.col, endColumnIndex: n.col + 1 },
          rows: [{ values: [{ note: n.text }] }],
          fields: "note",
        },
      });
    }
    for (const d of keep(ops.deleteRows)) {
      const sheetId = sheetIdOf.get(d.tab)!;
      for (const [start, end] of contiguousDesc(d.rows)) {
        structural.push({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: start - 1, endIndex: end } } });
      }
    }
    if (structural.length) await this.call("POST", ":batchUpdate", { requests: structural });

    // 4. appends on the engine-owned tab
    for (const a of keep(ops.appends)) {
      const params = new URLSearchParams({ valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" });
      await this.call("POST", `/values/${encodeURIComponent(`${quoteTab(a.tab)}!A1`)}:append?${params}`, { majorDimension: "ROWS", values: a.rows });
    }
  }
}

/** Rows (1-based, descending) -> [start, end] runs, descending, for deleteDimension. */
export function contiguousDesc(rows: number[]): [number, number][] {
  const sorted = [...new Set(rows)].sort((a, b) => b - a);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last[0] === r + 1) last[0] = r;
    else out.push([r, r]);
  }
  return out;
}

/** Engine-owned tab: header row (bold, frozen, warning-only protection) and dropdowns for enums. */
function engineTabLayout(spec: TableSpec, header: string[], sheetId: number): unknown[] {
  const reqs: unknown[] = [
    {
      updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: header.length },
        rows: [{ values: header.map((h) => ({ userEnteredValue: { stringValue: h }, userEnteredFormat: { textFormat: { bold: true } } })) }],
        fields: "userEnteredValue,userEnteredFormat.textFormat",
      },
    },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    {
      addProtectedRange: {
        protectedRange: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, description: "JOUMPA sync: header. Jangan ubah nama kolom.", warningOnly: true },
      },
    },
  ];
  spec.columns.forEach((c) => {
    const col = header.indexOf(c.header);
    if (col < 0 || c.type.kind !== "enum") return;
    reqs.push({
      setDataValidation: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
        rule: { condition: { type: "ONE_OF_LIST", values: c.type.values.map((v) => ({ userEnteredValue: v })) }, strict: false, showCustomUi: true },
      },
    });
  });
  return reqs;
}
