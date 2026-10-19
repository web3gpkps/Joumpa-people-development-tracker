import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAccountSession, loginNoticeFor } from "@/lib/supabase/account";
import { getWorkspaceFor, ACCOUNT_ACCESS } from "@/lib/workspace";
import { todayInJakarta } from "@/components/shell/programme-calendar";
import { AccountShell, AccountShellLoading } from "@/components/shell/AccountShell";
import { BranchUnknownScreen, GateUnavailableScreen, WorkspaceUnavailableScreen } from "@/components/shell/AccessScreens";

/**
 * Branch area gate + shell. It only decides what the layout shows: layouts do not re-run on client
 * navigation, so every page and Server Action calls requireActiveAccount() too, and the database
 * scopes every share_* call to the account's branch.
 */
export default function BranchLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AccountShellLoading />}>
      <BranchGate>{children}</BranchGate>
    </Suspense>
  );
}

async function BranchGate({ children }: { children: ReactNode }) {
  const session = await getAccountSession();

  if (session.status === "signed-out") redirect("/login");
  if (session.status === "unavailable") return <GateUnavailableScreen reason={session.reason} />;
  if (session.status !== "active") redirect(`/login?notice=${loginNoticeFor(session)}`);

  const result = await getWorkspaceFor(ACCOUNT_ACCESS);
  if (!result.ok && result.reason === "invalid-link") return <BranchUnknownScreen />;
  if (!result.ok) return <WorkspaceUnavailableScreen />;

  return (
    <AccountShell
      workspace={result.workspace}
      accountName={session.profile.fullName || session.profile.email}
      today={todayInJakarta()}
    >
      {children}
    </AccountShell>
  );
}
