import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import {
  ACCOUNT_ACCESS,
  OWNER_ACCESS,
  hrefs,
  linkAccess,
  requireWorkspaceFor,
  type ScreenProps,
  type SearchParams,
  type SheetKey,
} from "@/lib/workspace";
import { BRANCH_HOME, branchMayOpen, isBranchScope } from "./branch-scope";

/** A workbook screen: components/<feature>/<Feature>Screen.tsx. */
export type WorkbookScreen = (props: ScreenProps) => ReactNode | Promise<ReactNode>;

/*
 * Thin route files render one of these inside <Suspense> (they await params, searchParams
 * and the workspace, which is request data under cacheComponents):
 *
 *   // app/s/[token]/bmi/page.tsx
 *   export default function Page({ params, searchParams }: PageProps<"/s/[token]/bmi">) {
 *     return (
 *       <Suspense fallback={<BmiLoading />}>
 *         <LinkScreenRoute params={params} searchParams={searchParams} sheet="bmi" screen={BmiScreen} />
 *       </Suspense>
 *     );
 *   }
 *
 *   // app/admin/bmi/page.tsx
 *   export default function Page({ searchParams }: PageProps<"/admin/bmi">) {
 *     return (
 *       <Suspense fallback={<BmiLoading />}>
 *         <OwnerScreenRoute searchParams={searchParams} screen={BmiScreen} />
 *       </Suspense>
 *     );
 *   }
 */

/**
 * Station-link route: access from the token, workspace from pd_share_open(token). A single-station
 * link opens Rencana Aksi and Cek BMI only; any other screen sends it to Rencana Aksi, even when its
 * address is typed in. KPS links open every page.
 */
export async function LinkScreenRoute({
  params,
  searchParams,
  sheet,
  screen: Screen,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParams>;
  sheet: SheetKey;
  screen: WorkbookScreen;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const access = linkAccess(token);
  const ws = await requireWorkspaceFor(access);
  if (isBranchScope(access, ws) && !branchMayOpen(sheet)) redirect(hrefs(access)[BRANCH_HOME]);
  return <Screen access={access} ws={ws} searchParams={query} />;
}

/** Owner route: requireAdmin(), then pd_share_open('') with the session (scope KPS, label Pemilik). */
export async function OwnerScreenRoute({
  searchParams,
  screen: Screen,
}: {
  searchParams: Promise<SearchParams>;
  screen: WorkbookScreen;
}) {
  const query = await searchParams;
  const ws = await requireWorkspaceFor(OWNER_ACCESS);
  return <Screen access={OWNER_ACCESS} ws={ws} searchParams={query} />;
}

/**
 * Branch-account route: requireActiveAccount(), then pd_share_open('') with the session (scope = the
 * account's branch). A single-station account opens Rencana Aksi and Cek BMI only, like a station link.
 */
export async function AccountScreenRoute({
  searchParams,
  sheet,
  screen: Screen,
}: {
  searchParams: Promise<SearchParams>;
  sheet: SheetKey;
  screen: WorkbookScreen;
}) {
  const query = await searchParams;
  const ws = await requireWorkspaceFor(ACCOUNT_ACCESS);
  if (isBranchScope(ACCOUNT_ACCESS, ws) && !branchMayOpen(sheet)) redirect(hrefs(ACCOUNT_ACCESS)[BRANCH_HOME]);
  return <Screen access={ACCOUNT_ACCESS} ws={ws} searchParams={query} />;
}
