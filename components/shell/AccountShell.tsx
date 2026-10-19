import type { ReactNode } from "react";
import type { Workspace } from "@/lib/workspace";
import { ACCOUNT_ACCESS, hrefs, navSections } from "@/lib/workspace/access";
import { ShellFrame, ShellIdentity, ShellLoading, WeekLine } from "./ShellFrame";
import { ShellSignOut } from "./SignOutButton";
import { BRANCH_HOME, branchAccountNavigation, isBranchScope } from "./branch-scope";
import { bmiScheduleLine } from "./programme-calendar";

type AccountShellProps = {
  workspace: Workspace;
  /** The signed-in account's name, or its e-mail when it has no name. */
  accountName: string;
  /** Today in Asia/Jakarta, from todayInJakarta() at request time. */
  today: string;
  children: ReactNode;
};

/**
 * Chrome of the branch area (/cabang), for a signed-in account approved by the owner. The scope
 * ("Stasiun SUB" or "KPS · semua stasiun") comes from the account's branch in the database, never
 * from the URL. A single-station account sees Rencana Aksi and Cek BMI ("BMI Monitoring Tracker");
 * KPS accounts get every page. Footer: the account and "Keluar".
 */
export function AccountShell({ workspace, accountName, today, children }: AccountShellProps) {
  const branchOnly = isBranchScope(ACCOUNT_ACCESS, workspace);
  const sections = navSections(ACCOUNT_ACCESS, { branchOnly });
  return (
    <ShellFrame
      sections={branchOnly ? branchAccountNavigation(sections) : sections}
      homeHref={branchOnly ? hrefs(ACCOUNT_ACCESS)[BRANCH_HOME] : ACCOUNT_ACCESS.basePath}
      scopeLabel={workspace.scopeLabel}
      scopeShort={workspace.scope}
      weekLine={workspace.schedule ? <WeekLine>{bmiScheduleLine(workspace.schedule, today)}</WeekLine> : undefined}
      footer={<ShellIdentity icon="user" text={accountName} action={<ShellSignOut />} />}
    >
      {children}
    </ShellFrame>
  );
}

export function AccountShellLoading() {
  return <ShellLoading scopeLabel="Membuka halaman" />;
}
