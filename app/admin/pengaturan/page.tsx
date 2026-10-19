import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader, PageLoading } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ReloadButton } from "@/components/ui/ReloadButton";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { AreasManager } from "@/components/admin/AreasManager";
import { SETTING_FIELDS, toFormValue, type SettingsValues } from "@/components/admin/settings-schema";
import { formatWaktu } from "@/components/admin/format";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Parameter" };

const TITLE = "Parameter";

export default function PengaturanPage() {
  return (
    <Suspense fallback={<PageLoading title={TITLE} label="Memuat parameter" />}>
      <SettingsData />
    </Suspense>
  );
}

async function SettingsData() {
  await requireAdmin();
  const supabase = await createClient();
  const [settingsResult, missingResult, totalResult, areasResult, plansResult] = await Promise.all([
    supabase.from("pd_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("pd_staff").select("code", { count: "exact", head: true }).is("gender", null),
    supabase.from("pd_staff").select("code", { count: "exact", head: true }),
    supabase.from("pd_areas").select("name, sort").order("sort").order("name"),
    supabase.from("pd_action_plans").select("area"),
  ]);

  if (settingsResult.error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={TITLE} />
        <Panel>
          <ErrorState title="Parameter tidak bisa dimuat" cause="Server tidak menjawab." action={<ReloadButton>Coba lagi</ReloadButton>} />
        </Panel>
      </div>
    );
  }
  const row = settingsResult.data;
  if (!row) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={TITLE} />
        <Panel>
          <EmptyState title="Parameter belum tersedia">Hubungi pengelola aplikasi.</EmptyState>
        </Panel>
      </div>
    );
  }

  const initial = Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, toFormValue(row[f.key])])) as SettingsValues;
  const genderMissing =
    missingResult.error || totalResult.error || missingResult.count === null || totalResult.count === null
      ? null
      : { missing: missingResult.count, total: totalResult.count };
  const changed = formatWaktu(row.updated_at);
  const used = new Map<string, number>();
  for (const plan of plansResult.data ?? []) used.set(plan.area, (used.get(plan.area) ?? 0) + 1);
  const areas = (areasResult.data ?? []).map((a) => ({ name: a.name, rows: used.get(a.name) ?? 0 }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} meta={changed ? `Diubah ${changed} WIB` : undefined} />
      <SettingsForm initial={initial} genderMissing={genderMissing} />
      {areasResult.error ? (
        <Panel title="Area Rencana Aksi">
          <ErrorState title="Daftar area tidak bisa dimuat" cause="Server tidak menjawab." action={<ReloadButton>Coba lagi</ReloadButton>} />
        </Panel>
      ) : (
        <AreasManager areas={areas} />
      )}
    </div>
  );
}
