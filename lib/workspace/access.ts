/*
 * Who is looking at a workspace, and where its pages live. Pure and client-safe: no
 * server-only import, so client components may build links with hrefs(access).
 *
 * Three kinds of access, one set of screens (docs/UX.md §1):
 *   link    : /s/<token>, no account; scope comes from the link (a station code, or KPS).
 *   account : /cabang, a signed-in branch account approved by the owner; scope comes from the
 *             account's branch (a station code, or KPS) in SQL, label = the account's name.
 *   owner   : /admin, the signed-in owner; scope "KPS" with label "Pemilik" in SQL.
 *
 * Server code turns an access into data with getWorkspaceFor(access) and, in Server
 * Actions, turns the serialisable accessKey back into a client with resolveAccess(key)
 * (both in lib/workspace/index.ts, server only).
 */

export type WorkspaceAccess =
  | {
      kind: "link";
      /** The link token (48 hex). A bearer credential: never log it or put it in a cache key. */
      token: string;
      /** Pass this to Server Actions (here: the token itself). */
      key: string;
      basePath: string;
    }
  | {
      kind: "account";
      key: typeof ACCOUNT_ACCESS_KEY;
      basePath: "/cabang";
    }
  | {
      kind: "owner";
      key: typeof OWNER_ACCESS_KEY;
      basePath: "/admin";
    };

/** The accessKey a Server Action receives for the owner. Never a valid token (not 48 hex). */
export const OWNER_ACCESS_KEY = "owner";

/** The accessKey a Server Action receives for a signed-in branch account. Never a valid token. */
export const ACCOUNT_ACCESS_KEY = "account";

export function linkAccess(token: string): WorkspaceAccess {
  return { kind: "link", token, key: token, basePath: `/s/${token}` };
}

export const ACCOUNT_ACCESS: WorkspaceAccess = {
  kind: "account",
  key: ACCOUNT_ACCESS_KEY,
  basePath: "/cabang",
};

export const OWNER_ACCESS: WorkspaceAccess = {
  kind: "owner",
  key: OWNER_ACCESS_KEY,
  basePath: "/admin",
};

/** Navigation groups, in order (DESIGN.md Shell and navigation). */
export const NAV_GROUPS = [
  { key: "pantau", label: "Pantau" },
  { key: "input", label: "Tindak lanjut" },
  { key: "data", label: "Data SDM" },
  { key: "pengelolaan", label: "Pengelolaan" },
] as const;

export type NavGroupKey = (typeof NAV_GROUPS)[number]["key"];

type SheetDef = {
  key: string;
  /** Nav label and page title. */
  label: string;
  /** Shorter label for the phone bottom bar, when it differs. */
  shortLabel?: string;
  /** Path under basePath ("" is the index page). Route paths never change, only labels. */
  path: string;
  group: NavGroupKey;
  /** Reachable by a single-station scope (link or account). The rest is KPS and owner only. */
  branch?: boolean;
};

/**
 * The workspace pages, in nav order, with their path under basePath. A single-station scope
 * (a station link or branch account) gets the `branch` pages only: Rencana Aksi and Cek BMI.
 * Keys and paths are stable (links, redirects and remembered views depend on them).
 */
export const SHEETS = [
  { key: "dashboard", label: "Beranda", path: "", group: "pantau" },
  { key: "laporanBulanan", label: "Laporan Bulanan", shortLabel: "Laporan", path: "/laporan-bulanan", group: "pantau" },
  { key: "rencanaAksi", label: "Rencana Aksi", path: "/rencana-aksi", group: "input", branch: true },
  { key: "bmi", label: "Cek BMI", path: "/bmi", group: "input", branch: true },
  { key: "trackerStaf", label: "Tracker Staf", shortLabel: "Staf", path: "/tracker-staf", group: "data" },
  { key: "penggantian", label: "Penggantian SDM", shortLabel: "Penggantian", path: "/penggantian", group: "data" },
] as const satisfies readonly SheetDef[];

export type SheetKey = (typeof SHEETS)[number]["key"];

/** The pages a single-station scope may open; its home is the first one. */
export const BRANCH_SHEET_KEYS = (SHEETS as readonly SheetDef[]).filter((s) => s.branch).map((s) => s.key as SheetKey);

/** Owner-only pages (no station link ever reaches them), group "Pengelolaan". */
export const OWNER_PAGES = [
  { key: "tautan", label: "Tautan Akses", path: "/admin/tautan", group: "pengelolaan" },
  { key: "akun", label: "Akun Cabang", path: "/admin/akun", group: "pengelolaan" },
  { key: "pengaturan", label: "Parameter", path: "/admin/pengaturan", group: "pengelolaan" },
  { key: "sinkronisasi", label: "Sinkronisasi", path: "/admin/sinkronisasi", group: "pengelolaan" },
] as const;

/** Page title of a workspace sheet, e.g. sheetLabel("rencanaAksi") === "Rencana Aksi". */
export function sheetLabel(key: SheetKey): string {
  return SHEETS.find((s) => s.key === key)!.label;
}

/** One navigation link. Plain data, so server components can build it and pass it to the client shell. */
export type NavLink = {
  key: string;
  label: string;
  shortLabel: string;
  href: string;
  /** Active only on this exact path (index pages), not on its children. */
  exact: boolean;
};

export type NavSection = { key: NavGroupKey; label: string; items: NavLink[] };

/**
 * The navigation for an access, grouped (Pantau / Tindak lanjut / Data SDM / Pengelolaan).
 * `branchOnly` (a single-station link or account) keeps Rencana Aksi and Cek BMI only;
 * Pengelolaan is only for the owner. Empty groups are left out.
 */
export function navSections(
  access: Pick<WorkspaceAccess, "kind" | "basePath">,
  { branchOnly = false }: { branchOnly?: boolean } = {},
): NavSection[] {
  const owner = access.kind === "owner";
  const sections: NavSection[] = NAV_GROUPS.map((g) => ({ key: g.key, label: g.label, items: [] }));
  const add = (group: NavGroupKey, link: NavLink) => sections.find((s) => s.key === group)!.items.push(link);

  for (const sheet of SHEETS as readonly SheetDef[]) {
    if (branchOnly && !sheet.branch) continue;
    add(sheet.group, {
      key: sheet.key,
      label: sheet.label,
      shortLabel: sheet.shortLabel ?? sheet.label,
      href: `${access.basePath}${sheet.path}`,
      exact: sheet.path === "",
    });
  }
  if (owner) {
    for (const page of OWNER_PAGES) {
      add(page.group, { key: page.key, label: page.label, shortLabel: page.label, href: page.path, exact: false });
    }
  }
  return sections.filter((section) => section.items.length > 0);
}

/** The phone bottom bar destinations (DESIGN.md); "Menu" is added by the shell. Missing ones are skipped. */
export const BOTTOM_BAR_KEYS = ["dashboard", "rencanaAksi", "bmi"] as const satisfies readonly SheetKey[];

/** True when `item` is the page at `pathname` (index pages match exactly, others also match their children). */
export function isNavActive(pathname: string, item: Pick<NavLink, "href" | "exact">): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export type QueryValue = string | number | null | undefined | false;

/** "?cabang=DPS&stasiun=SUB" from a record; null, undefined, false and "" are left out. */
export function toQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === false || value === "") continue;
    sp.set(key, String(value));
  }
  const text = sp.toString();
  return text ? `?${text}` : "";
}

export type SheetLinks = Record<SheetKey, string> & {
  /** Sheet path plus query: links.to("bmi", { periode: 2, stasiun: "SUB" }). */
  to: (sheet: SheetKey, query?: Record<string, QueryValue>, hash?: string) => string;
};

/**
 * Every internal path for this access. Use it for all links and redirects inside a screen,
 * never a hard-coded "/s/${token}" or "/admin":
 *   const links = hrefs(access);
 *   <Link href={links.trackerStaf}> … <Link href={links.to("bmi", { stasiun: "SUB" })}>
 * The returned object holds only strings plus `to`; pass `links.bmi` (a string) to client
 * components, or call hrefs(access) inside them (access is serialisable).
 */
export function hrefs(access: Pick<WorkspaceAccess, "basePath">): SheetLinks {
  const base = access.basePath;
  const paths = Object.fromEntries(SHEETS.map((s) => [s.key, `${base}${s.path}`])) as Record<SheetKey, string>;
  return {
    ...paths,
    to(sheet, query, hash) {
      return `${paths[sheet]}${toQuery(query)}${hash ? `#${hash}` : ""}`;
    },
  };
}

/** Search params as Next passes them to a page, already awaited. */
export type SearchParams = Record<string, string | string[] | undefined>;
