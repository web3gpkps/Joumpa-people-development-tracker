import type { ReactNode } from "react";
import type { Workspace } from "@/lib/workspace";
import { hrefs, navSections, type WorkspaceAccess } from "@/lib/workspace/access";
import { ShellFrame, ShellIdentity, ShellLoading, WeekLine } from "./ShellFrame";
import { bmiScheduleLine } from "./programme-calendar";
import { BRANCH_HOME, isBranchScope } from "./branch-scope";

type WorkspaceShellProps = {
  access: WorkspaceAccess;
  workspace: Workspace;
  /** Today in Asia/Jakarta, from todayInJakarta() at request time. */
  today: string;
  children: ReactNode;
};

/**
 * Station link chrome (/s/<token>, no account). The scope ("Stasiun SUB" / "KPS · semua
 * stasiun") and the programme week sit under the logo; the link's label is the footer.
 * A station link has Rencana Aksi and Cek BMI only; a KPS link gets every page.
 */
export function WorkspaceShell({ access, workspace, today, children }: WorkspaceShellProps) {
  const branchOnly = isBranchScope(access, workspace);
  return (
    <ShellFrame
      sections={navSections(access, { branchOnly })}
      homeHref={branchOnly ? hrefs(access)[BRANCH_HOME] : access.basePath}
      scopeLabel={workspace.scopeLabel}
      scopeShort={workspace.scope}
      weekLine={workspace.schedule ? <WeekLine>{bmiScheduleLine(workspace.schedule, today)}</WeekLine> : undefined}
      footer={workspace.label ? <ShellIdentity icon="link" text={`Tautan: ${workspace.label}`} /> : undefined}
    >
      {children}
    </ShellFrame>
  );
}

export function WorkspaceShellLoading() {
  return <ShellLoading scopeLabel="Membuka halaman" />;
}
