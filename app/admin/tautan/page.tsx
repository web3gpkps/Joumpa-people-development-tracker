import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageHeader, PageLoading } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ErrorState } from "@/components/ui/States";
import { ReloadButton } from "@/components/ui/ReloadButton";
import { LinksManager } from "@/components/admin/LinksManager";
import { KPS_SCOPE, type LinkRow, type ScopeStation } from "@/components/admin/link-types";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { linkAccess } from "@/lib/workspace/access";

export const metadata: Metadata = { title: "Tautan Akses" };

const TITLE = "Tautan Akses";

export default function TautanPage() {
  return (
    <Suspense fallback={<PageLoading title={TITLE} label="Memuat daftar tautan" />}>
      <LinksData />
    </Suspense>
  );
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

async function LinksData() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data, error }, stationResult] = await Promise.all([
    supabase
      .from("pd_share_links")
      .select("id, scope, label, created_at, revoked_at, last_used_at, token")
      .order("created_at", { ascending: false }),
    supabase.from("stations").select("code, report_group").order("sort").order("code"),
  ]);

  if (error || stationResult.error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={TITLE} />
        <Panel>
          <ErrorState
            title="Daftar tautan tidak bisa dimuat"
            cause="Server tidak menjawab."
            action={<ReloadButton>Coba lagi</ReloadButton>}
          />
        </Panel>
      </div>
    );
  }

  const base = await origin();
  const stations: ScopeStation[] = (stationResult.data ?? []).map((s) => ({ code: s.code, reportGroup: s.report_group }));
  // KPS first, then stations in their order; an unknown scope sorts last.
  const order = [KPS_SCOPE, ...stations.map((s) => s.code)];
  const rank = (scope: string) => {
    const i = order.indexOf(scope);
    return i < 0 ? order.length : i;
  };
  const links: LinkRow[] = (data ?? [])
    .map((row) => ({
      id: row.id,
      scope: row.scope,
      label: row.label,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      lastUsedAt: row.last_used_at,
      // Only working links carry their URL; a revoked token is never sent to the browser.
      url: row.revoked_at ? null : `${base}${linkAccess(row.token).basePath}`,
      isQa: /^qa test/i.test(row.label?.trim() ?? ""),
    }))
    .sort(
      (a, b) =>
        rank(a.scope) - rank(b.scope) ||
        Number(a.isQa) - Number(b.isQa) ||
        b.createdAt.localeCompare(a.createdAt),
    );

  return <LinksManager title={TITLE} links={links} stations={stations} />;
}
