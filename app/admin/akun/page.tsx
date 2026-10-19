import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader, PageLoading } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ErrorState } from "@/components/ui/States";
import { ReloadButton } from "@/components/ui/ReloadButton";
import { AccountsManager } from "@/components/admin/AccountsManager";
import type { AccountRow } from "@/components/admin/account-view";
import { branchOptions, isAccountStatus } from "@/lib/accounts/rules";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Akun Cabang" };

const TITLE = "Akun Cabang";

export default function AkunPage() {
  return (
    <Suspense fallback={<PageLoading title={TITLE} label="Memuat daftar akun" />}>
      <AccountsData />
    </Suspense>
  );
}

async function AccountsData() {
  await requireAdmin();
  const supabase = await createClient();
  const [accountsResult, stationsResult, ownersResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, branch_code, status, created_at, decided_at")
      .order("created_at", { ascending: false }),
    supabase.from("stations").select("code").order("sort").order("code"),
    supabase.from("admins").select("user_id"),
  ]);

  if (accountsResult.error || stationsResult.error || ownersResult.error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={TITLE} />
        <Panel>
          <ErrorState
            title="Daftar akun tidak bisa dimuat"
            cause="Server tidak menjawab."
            action={<ReloadButton>Coba lagi</ReloadButton>}
          />
        </Panel>
      </div>
    );
  }

  // An owner who also has a profile row (every sign-up gets one) is not a branch account to approve.
  const owners = new Set((ownersResult.data ?? []).map((row) => row.user_id));
  const accounts: AccountRow[] = (accountsResult.data ?? []).flatMap((row) =>
    isAccountStatus(row.status) && !owners.has(row.id)
      ? [
          {
            id: row.id,
            email: row.email,
            fullName: row.full_name,
            branchCode: row.branch_code,
            status: row.status,
            createdAt: row.created_at,
            decidedAt: row.decided_at,
          },
        ]
      : [],
  );

  return (
    <AccountsManager
      title={TITLE}
      accounts={accounts}
      branches={branchOptions((stationsResult.data ?? []).map((row) => row.code))}
    />
  );
}
