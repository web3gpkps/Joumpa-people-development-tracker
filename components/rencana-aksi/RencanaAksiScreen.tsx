/*
 * Rencana Aksi: the tab "Rencana Aksi" of the workbook, per Cabang. Every scope works on its own
 * Cabang (SQL scopes ws.actionPlans): a station link or account sees and edits its Cabang's rows,
 * KPS and the owner every Cabang with a Cabang filter; the owner also gets the archived rows.
 */
import { ButtonLink } from "@/components/ui/Button";
import { MetricCards, type Metric } from "@/components/ui/MetricCards";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, TableSkeleton } from "@/components/ui/States";
import { Toolbar } from "@/components/ui/Toolbar";
import { UrlSelect } from "@/components/ui/UrlSelect";
import type { UrlOption } from "@/components/ui/url-options";
import { todayInJakarta } from "@/components/shell/programme-calendar";
import { FLAGS, STATUSES } from "@/lib/pd-rules";
import { activeFirst, activeReportGroups, groupOfStation, hrefs, reportGroups, type ScreenProps } from "@/lib/workspace";
import { AddPlanButton } from "./AddPlanButton";
import { ArchivedPlans } from "./ArchivedPlans";
import { PlanBoard } from "./PlanBoard";
import type { PlanFormContext } from "./PlanFormDialog";
import { PlanSearch } from "./PlanSearch";
import {
  ALL,
  activeFilterCount,
  filterPlans,
  filterQuery,
  parseFilters,
  percentLabel,
  sortPlans,
  summarize,
  toPlanView,
  type PlanFilters,
} from "./plan-view";

const TITLE = "Rencana Aksi";
const SOURCE = "Rekomendasi konsolidasi Okt–Des 2026";

/** Suspense fallback: the banner right away, then four empty cards and skeleton rows. */
export function RencanaAksiLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} meta={SOURCE} />
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-30 rounded-panel border border-line bg-surface shadow-card" />
        ))}
      </div>
      <TableSkeleton label="Memuat rencana aksi" columns={6} />
    </div>
  );
}

/**
 * Header, four counts for the Cabang in view, filters in the URL (Cabang for KPS, Area,
 * Flag / status, search), then the list: an editable grid on desktop, cards on phones.
 */
export function RencanaAksiScreen({ access, ws, searchParams }: ScreenProps) {
  const today = todayInJakarta();
  const links = hrefs(access);
  const areas = ws.areas.map((a) => a.name);

  const ownGroup = ws.isKps ? null : (groupOfStation(ws.stations, ws.scope) ?? reportGroups(ws)[0] ?? null);
  // Cabang order from the stations; a group only present in the rows goes last.
  const groups = [...reportGroups(ws)];
  for (const p of ws.actionPlans) if (!groups.includes(p.reportGroup)) groups.push(p.reportGroup);
  // Filters list the Cabang that hold data; the add dialog lists those first, then every other.
  const activeGroups = activeReportGroups(ws);

  const filters = parseFilters(searchParams, { isKps: ws.isKps, groups, areas });
  const views = sortPlans(
    ws.actionPlans.map((p) => toPlanView(p, today, ws)),
    areas,
    groups,
  );
  const inGroup = (p: { reportGroup: string }) => !filters.cabang || p.reportGroup === filters.cabang;
  const active = views.filter((p) => !p.archivedAt && inGroup(p));
  const archived = views.filter((p) => p.archivedAt && inGroup(p));
  const shown = filterPlans(active, filters);
  const summary = summarize(active);

  const groupName = filters.cabang ?? ownGroup;
  const scopeName = groupName ? `Cabang ${groupName}` : "semua cabang";
  const ctx: PlanFormContext = { accessKey: access.key, areas, groups: activeFirst(activeGroups, groups), isKps: ws.isKps, ownGroup, today };
  const addButton = <AddPlanButton {...ctx} defaultGroup={filters.cabang} />;

  // ── filters ─────────────────────────────────────────────────────────────────────────
  const href = (change: Partial<Record<keyof PlanFilters, string | null>>) =>
    links.to("rencanaAksi", filterQuery(filters, change));
  const cabangOptions: UrlOption[] = [
    { value: ALL, label: "Semua cabang", href: href({ cabang: null }) },
    ...activeGroups.map((g) => ({ value: g, label: g, href: href({ cabang: g }) })),
  ];
  const areaOptions: UrlOption[] = [
    { value: ALL, label: "Semua area", href: href({ area: null }) },
    ...areas.map((a) => ({ value: a, label: a, href: href({ area: a }) })),
  ];
  const stateOptions: UrlOption[] = [
    { value: ALL, label: "Semua", href: href({ flag: null, status: null }) },
    ...FLAGS.map((f) => ({
      value: `flag:${f}`,
      label: f === "Selesai" ? "Selesai atau batal" : f,
      href: href({ flag: f, status: null }),
    })),
    ...STATUSES.map((s) => ({ value: `status:${s}`, label: `Status ${s}`, href: href({ flag: null, status: s }) })),
  ];
  const stateValue = filters.flag ? `flag:${filters.flag}` : filters.status ? `status:${filters.status}` : ALL;
  const narrowed = activeFilterCount(filters) > 0;
  const clearHref = links.to("rencanaAksi", { cabang: filters.cabang });

  const metrics: Metric[] = [
    {
      label: "Rata-rata progres",
      value: percentLabel(summary.avgProgress),
      foot: `${summary.total} rencana aksi · ${summary.byFlag["On track"]} on track`,
      progress: summary.avgProgress ?? 0,
    },
    {
      label: "Terlambat",
      value: summary.byFlag.Terlambat,
      foot: "Lewat batas waktu, belum selesai",
      tone: summary.byFlag.Terlambat > 0 ? "critical" : undefined,
    },
    {
      label: "Jatuh tempo ≤ 7 hari",
      value: summary.dueSoon,
      foot: "Batas waktu dalam 7 hari ke depan",
      tone: summary.dueSoon > 0 ? "warning" : undefined,
    },
    {
      label: "Selesai",
      value: summary.byFlag.Selesai,
      foot: `${percentLabel(summary.total ? Math.round((summary.byFlag.Selesai / summary.total) * 100) : null)} dari semua rencana aksi`,
      tone: summary.byFlag.Selesai > 0 ? "good" : undefined,
    },
  ];

  const filteredEmpty = (
    <EmptyState
      title="Tidak ada rencana aksi yang cocok"
      action={
        <ButtonLink href={clearHref} size="sm">
          Hapus filter
        </ButtonLink>
      }
    >
      Ubah filter atau kata pencarian untuk melihat baris lain di {scopeName}.
    </EmptyState>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} meta={`${ws.scopeLabel} · ${SOURCE}`} actions={active.length > 0 ? addButton : undefined} />

      {active.length === 0 ? (
        <Panel>
          <EmptyState
            title={groupName ? `Belum ada rencana aksi untuk Cabang ${groupName}` : "Belum ada rencana aksi di cabang mana pun"}
            action={
              <>
                {addButton}
                {ws.isKps && filters.cabang ? (
                  <ButtonLink href={links.rencanaAksi} variant="ghost">
                    Lihat semua cabang
                  </ButtonLink>
                ) : null}
              </>
            }
          >
            {ws.isKps
              ? "Masukkan tindakan dari rekomendasi konsolidasi per cabang. Stasiun di cabang itu langsung melihat dan memperbaruinya."
              : "Tindakan dari rekomendasi konsolidasi untuk cabang ini belum dimasukkan. Tambahkan yang pertama; KPS ikut melihatnya."}
          </EmptyState>
        </Panel>
      ) : (
        <>
          <MetricCards label={`Ringkasan rencana aksi, ${scopeName}`} items={metrics} />

          <Toolbar
            label="Filter rencana aksi"
            end={
              <>
                <span className="tabular">
                  {narrowed ? `${shown.length} dari ${active.length} rencana aksi` : `${active.length} rencana aksi`}
                </span>
                {narrowed ? (
                  <ButtonLink href={clearHref} variant="ghost" size="sm">
                    Hapus filter
                  </ButtonLink>
                ) : null}
              </>
            }
          >
            <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:flex-wrap sm:items-end">
              {ws.isKps ? (
                <UrlSelect label="Cabang" options={cabangOptions} current={filters.cabang ?? ALL} width="w-full sm:w-40" />
              ) : null}
              <UrlSelect label="Area" options={areaOptions} current={filters.area ?? ALL} width="w-full sm:w-48" />
              <UrlSelect
                label="Flag / status"
                options={stateOptions}
                current={stateValue}
                width="w-full sm:w-52"
                className={ws.isKps ? "col-span-2 sm:col-span-1" : undefined}
              />
            </div>
            <div className="w-full sm:w-auto">
              <PlanSearch basePath={links.rencanaAksi} query={filterQuery(filters, { q: null })} current={filters.q} />
            </div>
          </Toolbar>

          <PlanBoard
            {...ctx}
            plans={shown}
            caption={`Rencana aksi, ${scopeName}`}
            showGroup={ws.isKps && !filters.cabang}
            emptyState={filteredEmpty}
          />
        </>
      )}

      {ws.isOwner ? <ArchivedPlans accessKey={access.key} plans={archived} /> : null}
    </div>
  );
}
