/** Share-link scopes and the shapes the Tautan Akses screen passes around. */

export const KPS_SCOPE = "KPS";

/** A station as the Tautan Akses screen needs it (public.stations, in display order). */
export type ScopeStation = { code: string; reportGroup: string };

/** The dialog's Lingkup options: KPS first, then every station in public.stations. */
export function linkScopes(stations: readonly ScopeStation[]): string[] {
  return [KPS_SCOPE, ...stations.map((s) => s.code)];
}

/** What a scope opens, as short field help. A station sharing a report (CGK & HLP) says so. */
export function scopeDescription(scope: string, stations: readonly ScopeStation[] = []): string {
  if (scope === KPS_SCOPE) return "Semua stasiun, termasuk Catatan KPS";
  const group = stations.find((s) => s.code === scope)?.reportGroup;
  if (group && group !== scope) return `Data stasiun ${scope}, tindak lanjut laporan ${group}`;
  return `Data stasiun ${scope} saja`;
}

export function scopeName(scope: string): string {
  return scope === KPS_SCOPE ? "KPS" : `Stasiun ${scope}`;
}

export type LinkRow = {
  id: string;
  scope: string;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  /** Full URL for active links (the owner can copy it again); null once revoked. */
  url: string | null;
  /** Labels starting with "QA test" mark temporary links made for testing. */
  isQa: boolean;
};

export type NewLink = { scope: string; label: string | null; url: string };

export type LinkActionResult =
  | { ok: true; link?: NewLink; message: string }
  | { ok: false; message: string; fieldErrors?: { scope?: string; label?: string } };
