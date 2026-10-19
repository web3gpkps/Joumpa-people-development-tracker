import { formatTanggal } from "@/lib/dates";
import { areaProgress, dashboardKpis, groupProgress, groupTotal } from "@/lib/pd-rules";
import { hrefs, type ScreenProps } from "@/lib/workspace";
import { todayInJakarta } from "@/components/shell/programme-calendar";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, TableSkeleton } from "@/components/ui/States";
import { AreaProgressTable } from "./AreaProgressTable";
import { GroupProgressTable } from "./GroupProgressTable";
import { KeyTimeline } from "./KeyTimeline";
import { KpiGrid, KpiGridSkeleton } from "./KpiGrid";
import { dashboardInput, kpiCards, timelineRows } from "./dashboard-view";

const TITLE = "Beranda";

/** Suspense fallback: the banner right away, six empty cards and skeleton tables. */
export function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} />
      <KpiGridSkeleton />
      <TableSkeleton label="Memuat progres per cabang" rows={6} columns={8} />
      <TableSkeleton label="Memuat progres rencana aksi" rows={6} columns={6} />
    </div>
  );
}

/**
 * Beranda for KPS and the owner (a single-station scope is redirected before it gets here): the
 * workbook Dashboard. KPI row, progress per Cabang, Rencana Aksi per area and the key dates, all
 * computed by lib/pd-rules from the workspace as of today (Asia/Jakarta).
 */
export function DashboardScreen({ access, ws }: ScreenProps) {
  const today = todayInJakarta();
  const links = hrefs(access);
  const input = dashboardInput(ws);
  const kpis = dashboardKpis(input, today);
  const groups = groupProgress(input, today);
  const total = groupTotal(groups);
  const areas = areaProgress(input, today);
  const timeline = timelineRows(today);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={TITLE}
        meta={
          <>
            Posisi per <time dateTime={today}>{formatTanggal(today)}</time>
            {` · ${input.groups.length} cabang · ${kpis.totalStaff} staf`}
          </>
        }
      />

      <KpiGrid items={kpiCards(kpis, input, today)} links={links} />

      <Panel id="progres-cabang" title="Progres per cabang" padding="flush">
        {groups.length === 0 ? (
          <EmptyState
            className="px-4"
            title="Belum ada data cabang"
            action={
              <ButtonLink href={links.trackerStaf} size="sm">
                Buka Tracker Staf
              </ButtonLink>
            }
          >
            Angka per cabang muncul setelah staf, usulan penggantian atau rencana aksi diisi.
          </EmptyState>
        ) : (
          <>
            <GroupProgressTable rows={groups} total={total} links={links} />
            <p className="max-w-prose border-t border-line px-4 py-3 text-xs text-ink-muted">
              Staf tuntas: tindakan utama dan tambahan sudah selesai atau batal. Terlambat: tindakan staf, penggantian
              dan rencana aksi yang lewat batas waktu (cek BMI dipantau di halaman Cek BMI).
            </p>
          </>
        )}
      </Panel>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel
          id="progres-area"
          title="Progres rencana aksi per area"
          padding="flush"
          actions={
            <ButtonLink href={links.rencanaAksi} size="sm" variant="ghost">
              Buka Rencana Aksi
            </ButtonLink>
          }
        >
          {areas.length === 0 ? (
            <EmptyState className="px-4" title="Belum ada area rencana aksi">
              Daftar area diatur oleh pengelola aplikasi.
            </EmptyState>
          ) : (
            <AreaProgressTable rows={areas} />
          )}
        </Panel>

        <Panel id="linimasa" title="Linimasa kunci" padding="flush" className="self-start">
          <KeyTimeline rows={timeline} today={today} />
        </Panel>
      </div>
    </div>
  );
}
