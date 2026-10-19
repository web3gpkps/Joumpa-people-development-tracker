/**
 * Read-only connectivity probe for the real Google Sheet.
 *
 *   bun lib/sync/scripts/probe-sheet.ts
 *
 * Uses read-only OAuth scopes, so it cannot modify the sheet even by mistake. Prints tab names,
 * row counts and whether the service account may edit. Never prints cell contents or credentials.
 */
import { JWT } from "google-auth-library";
import { localServiceAccount as credentials } from "./local-env";

async function main() {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) throw new Error("GOOGLE_SHEETS_ID not set");
  const sa = credentials();
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
  });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("no access token");
  const h = { Authorization: `Bearer ${token}` };

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
      `?fields=properties(title,locale,timeZone),sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount,frozenRowCount)),protectedRanges(protectedRangeId))`,
    { headers: h },
  );
  console.log("sheets.get status:", metaRes.status);
  if (!metaRes.ok) {
    const err = (await metaRes.json().catch(() => ({}))) as { error?: { status?: string } };
    console.log("error status:", err.error?.status ?? "unknown");
    return;
  }
  const meta = (await metaRes.json()) as {
    properties: { title: string; locale: string; timeZone: string };
    sheets: Array<{
      properties: { title: string; hidden?: boolean; gridProperties: { rowCount: number; columnCount: number; frozenRowCount?: number } };
      protectedRanges?: unknown[];
    }>;
  };
  console.log("title:", meta.properties.title, "| locale:", meta.properties.locale, "| tz:", meta.properties.timeZone);

  const titles = meta.sheets.map((s) => s.properties.title);
  const q = (t: string) => `'${t.replace(/'/g, "''")}'`;
  const params = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE", majorDimension: "ROWS" });
  for (const t of titles) params.append("ranges", q(t));
  const valsRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${params}`,
    { headers: h },
  );
  const vals = valsRes.ok
    ? ((await valsRes.json()) as { valueRanges: Array<{ values?: unknown[][] }> })
    : { valueRanges: [] };
  meta.sheets.forEach((s, i) => {
    const rows = vals.valueRanges[i]?.values ?? [];
    const nonEmpty = rows.filter((r) => r.some((c) => c !== "" && c != null)).length;
    const widest = rows.reduce((m, r) => Math.max(m, r.length), 0);
    console.log(
      `tab "${s.properties.title}": grid ${s.properties.gridProperties.rowCount}x${s.properties.gridProperties.columnCount}, ` +
        `non-empty rows ${nonEmpty}, used cols ${widest}, frozen ${s.properties.gridProperties.frozenRowCount ?? 0}, ` +
        `hidden ${!!s.properties.hidden}, protected ranges ${s.protectedRanges?.length ?? 0}`,
    );
  });

  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sheetId)}?fields=capabilities(canEdit,canComment)&supportsAllDrives=true`,
    { headers: h },
  );
  if (driveRes.ok) {
    const d = (await driveRes.json()) as { capabilities?: { canEdit?: boolean; canComment?: boolean } };
    console.log("drive capabilities: canEdit =", d.capabilities?.canEdit, "| canComment =", d.capabilities?.canComment);
  } else {
    const err = (await driveRes.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
    const reason = err.error?.message?.includes("has not been used") ? "Drive API not enabled in the GCP project" : err.error?.status;
    console.log("drive capabilities: unavailable (", driveRes.status, reason, ")");
  }
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.constructor.name + ": " + e.message : "unknown");
  process.exit(1);
});
