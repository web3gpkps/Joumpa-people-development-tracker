import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/supabase/auth";
import { OwnerShell, OwnerShellLoading } from "@/components/shell/OwnerShell";
import { GateUnavailableScreen, NotAdminScreen } from "@/components/shell/AccessScreens";

/**
 * Owner area gate + shell. It only decides what the layout shows: layouts do not re-run on
 * client navigation, so pages and Server Actions call requireAdmin() too, and RLS guards the tables.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<OwnerShellLoading />}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}

async function AdminGate({ children }: { children: ReactNode }) {
  const session = await getAdminSession();

  if (session.status === "signed-out") redirect("/login");
  if (session.status === "unavailable") {
    return <GateUnavailableScreen reason={session.reason} />;
  }
  if (session.status === "not-admin") return <NotAdminScreen email={session.email} />;

  return <OwnerShell email={session.email}>{children}</OwnerShell>;
}
