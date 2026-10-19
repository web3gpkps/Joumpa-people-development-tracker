import Link from "next/link";
import { diffDays, formatTanggal } from "@/lib/dates";
import { relativeDays } from "@/lib/format";
import { replacementNotRegistered } from "@/lib/pd-rules";
import {
  groupOfStation,
  hrefs,
  lastChangedLabel,
  reportGroups,
  sortedStaff,
  type ScreenProps,
  activeReportGroups,
} from "@/lib/workspace";
import { ButtonLink } from "@/components/ui/Button";
import { MetricCards, type Metric } from "@/components/ui/MetricCards";
import { PageHeader, PageLoading } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Toolbar } from "@/components/ui/Toolbar";
import { UrlSelect } from "@/components/ui/UrlSelect";
import { todayInJakarta } from "@/components/shell/programme-calendar";
import {
  CATEGORY_FILTERS,
  DEFAULT_TRAINING_DUE,
  DEFAULT_WITHDRAW_DUE,
  FLAG_FILTERS,
  PASS_RULE,
  filterQuery,
  filterRows,
  parseFilters,
  scopeRows,
  summarize,
  toViews,
  type Filters,
  type StaffOption,
} from "./model";
import {
  AddReplacementButton,
  PageSaveStatus,
  ReplacementPageStatus,
  STATUS_HINT,
  STRONG_REMINDER_NOTE,
  type ReplacementCtx,
} from "./ReplacementDialogs";
import { ReplacementGrid } from "./ReplacementGrid";
import { SearchField } from "./SearchField";

const TITLE = "Penggantian SDM";
/** One meta line: the two deadlines and the pass mark. */
const SUBTITLE =
  `Tarik paling lambat ${formatTanggal(DEFAULT_WITHDRAW_DUE)} · pengganti lulus training (${PASS_RULE}) ` +
  `paling lambat ${formatTanggal(DEFAULT_TRAINING_DUE)}`;
const ALL = "semua";

export function PenggantianLoading() {
  return <PageLoading title={TITLE} label="Memuat daftar penggantian SDM" />;
}

/**
 * Penggantian SDM (KPS and owner): summary cards, filters in the URL, a reminder for replacements
 * not yet in Tracker Staf, then the entry grid (cards on phones). Server component.
 */
export function PenggantianScreen({ access, ws, searchParams }: ScreenProps) {
  if (!ws.isKps) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={TITLE} meta={ws.scopeLabel} />
        <Panel>
          <ErrorState
            title="Halaman ini khusus KPS"
            cause="Daftar penggantian SDM hanya bisa dibuka lewat akses KPS."
            action="Pilih halaman lain dari menu."
          />
        </Panel>
      </div>
    );
  }

  const today = todayInJakarta();
  const links = hrefs(access);
  const groups = reportGroups(ws);
  const filters = parseFilters(searchParams, groups);
  const all = toViews(ws.replacements, (row) => lastChangedLabel(row, ws));
  const scoped = scopeRows(all, filters);
  const rows = filterRows(all, filters, today, ws.staff);
  const sum = summarize(scoped, today, ws.staff);
  const missing = scoped.filter((r) => replacementNotRegistered(r, ws.staff));
  const strongReminders = all.filter((r) => r.category === "Strong reminder");

  const staff: StaffOption[] = sortedStaff(ws).map((s) => ({
    code: s.code,
    name: s.name,
    station: s.station,
    reportGroup: s.reportGroup ?? groupOfStation(ws.stations, s.station),
  }));
  const ctx: ReplacementCtx = {
    accessKey: access.key,
    today,
    staff,
    listedCodes: all.map((r) => r.staffCode).filter((c): c is string => !!c),
    trackerStafHref: links.trackerStaf,
  };

  const hrefWith = (change: Partial<Filters>) => links.to("penggantian", filterQuery({ ...filters, ...change }));
  const filtered = Boolean(filters.cabang || filters.kategori || filters.flag || filters.cari);
  const categoryLabel = CATEGORY_FILTERS.find((c) => c.value === filters.kategori)?.label;
  const scopeName = [filters.cabang ? `Cabang ${filters.cabang}` : "semua cabang", categoryLabel].filter(Boolean).join(", ");

  const metrics: Metric[] = [
    {
      label: "Penarikan selesai",
      value: `${sum.withdrawn}/${sum.total}`,
      foot: `Batas ${formatTanggal(DEFAULT_WITHDRAW_DUE)} · ${relativeDays(diffDays(DEFAULT_WITHDRAW_DUE, today))}`,
      progress: sum.total ? (sum.withdrawn / sum.total) * 100 : 0,
      tone: sum.total > 0 && sum.withdrawn === sum.total ? "good" : undefined,
    },
    {
      label: "Pengganti lulus training",
      value: sum.passed,
      foot: `dari ${sum.withReplacement} pengganti · target ${formatTanggal(DEFAULT_TRAINING_DUE)}`,
      tone: sum.withReplacement > 0 && sum.passed === sum.withReplacement ? "good" : undefined,
    },
    {
      label: "Flag perlu perhatian",
      value: sum.late + sum.dueSoon,
      foot: `${sum.late} terlambat · ${sum.dueSoon} jatuh tempo ≤ 7 hari`,
      tone: sum.late > 0 ? "critical" : sum.dueSoon > 0 ? "warning" : undefined,
    },
    {
      label: "Menunggu persetujuan Direksi",
      value: sum.approvalPending,
      foot: `dari ${sum.total} usulan`,
      tone: sum.approvalPending > 0 ? "warning" : undefined,
    },
  ];

  return (
    <ReplacementPageStatus>
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader title={TITLE} meta={SUBTITLE} actions={<AddReplacementButton ctx={ctx} />} />

        <MetricCards items={metrics} label={`Ringkasan penggantian, ${scopeName}`} />

        <Toolbar label="Filter penggantian">
          <UrlSelect
            label="Cabang"
            width="w-full sm:w-44"
            className="min-w-0 grow basis-[calc(50%-0.375rem)] sm:grow-0 sm:basis-auto"
            current={filters.cabang ?? ALL}
            options={[null, ...activeReportGroups(ws)].map((g) => ({
              value: g ?? ALL,
              label: `${g ?? "Semua cabang"} (${g ? all.filter((r) => r.reportGroup === g).length : all.length})`,
              href: hrefWith({ cabang: g }),
            }))}
          />
          <UrlSelect
            label="Kategori"
            width="w-full sm:w-44"
            className="min-w-0 grow basis-[calc(50%-0.375rem)] sm:grow-0 sm:basis-auto"
            current={filters.kategori ?? ALL}
            options={[
              { value: ALL, label: "Semua kategori", href: hrefWith({ kategori: null }) },
              ...CATEGORY_FILTERS.map((c) => ({ value: c.value, label: c.label, href: hrefWith({ kategori: c.value }) })),
            ]}
          />
          <UrlSelect
            label="Flag"
            width="w-full sm:w-56"
            className="min-w-0 grow basis-[calc(50%-0.375rem)] sm:grow-0 sm:basis-auto"
            current={filters.flag ?? ALL}
            options={[
              { value: ALL, label: "Semua flag", href: hrefWith({ flag: null }) },
              ...FLAG_FILTERS.map((f) => ({ value: f.value, label: f.label, href: hrefWith({ flag: f.value }) })),
            ]}
          />
          <SearchField
            path={links.penggantian}
            query={{ cabang: filters.cabang, kategori: filters.kategori, flag: filters.flag }}
            current={filters.cari}
          />
          {filtered ? (
            <Link
              href={links.penggantian}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline underline-offset-2 hover:text-brand lg:min-h-10"
            >
              Hapus filter
            </Link>
          ) : null}
        </Toolbar>

        {missing.length > 0 ? (
          <section
            aria-labelledby="pengganti-belum-terdaftar"
            className="flex flex-col gap-3 rounded-panel border border-line bg-warning-tint p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <h2 id="pengganti-belum-terdaftar" className="text-sm font-semibold text-warning">
                Pengganti belum terdaftar di Tracker Staf ({missing.length})
              </h2>
              <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink">
                {missing.slice(0, 5).map((r) => (
                  <li key={r.id} className="[overflow-wrap:anywhere]">
                    <span className="font-semibold">{r.replacementName}</span>
                    <span className="text-ink-muted">
                      {" "}
                      menggantikan {r.name}
                      {r.reportGroup ? ` (${r.reportGroup})` : ""}
                    </span>
                  </li>
                ))}
                {missing.length > 5 ? <li className="text-ink-muted">dan {missing.length - 5} lainnya</li> : null}
              </ul>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {filters.flag !== "belum-terdaftar" ? (
                <ButtonLink href={hrefWith({ flag: "belum-terdaftar" })} size="sm" variant="secondary">
                  Tampilkan barisnya
                </ButtonLink>
              ) : null}
              <ButtonLink href={links.trackerStaf} size="sm" variant="primary">
                Buka Tracker Staf
              </ButtonLink>
            </div>
          </section>
        ) : null}

        {all.length === 0 ? (
          <Panel>
            <EmptyState title="Belum ada usulan penggantian" action={<AddReplacementButton ctx={ctx} />}>
              Tambahkan SDM yang diusulkan diganti atau mendapat strong reminder.
            </EmptyState>
          </Panel>
        ) : rows.length === 0 ? (
          <Panel>
            <EmptyState
              title="Tidak ada usulan yang cocok dengan filter ini"
              action={
                <ButtonLink href={links.penggantian} variant="secondary">
                  Hapus filter
                </ButtonLink>
              }
            >
              {filters.cari ? <>Pencarian &ldquo;{filters.cari}&rdquo; di {scopeName}.</> : <>Filter: {scopeName}.</>}
            </EmptyState>
          </Panel>
        ) : (
          // Phones get cards, so the panel surface starts at grid width (no card inside a card).
          <section
            aria-label="Daftar penggantian"
            className="flex min-w-0 flex-col gap-4 grid:rounded-panel grid:border grid:border-line grid:bg-surface grid:p-4 grid:shadow-card"
          >
            <ReplacementGrid
              caption={`Penggantian SDM, ${scopeName}`}
              rows={rows}
              ctx={ctx}
              summary={filtered ? `${rows.length} dari ${all.length} usulan` : `${all.length} usulan`}
              actions={<PageSaveStatus />}
            />
            <ul className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-ink-muted">
              <li>
                <span className="font-semibold text-ink">Status penarikan:</span> {STATUS_HINT}
              </li>
              {strongReminders.length > 0 ? (
                <li>
                  <span className="font-semibold text-ink">
                    Strong reminder ({strongReminders.map((r) => (r.reportGroup ? `${r.name}, ${r.reportGroup}` : r.name)).join("; ")}):
                  </span>{" "}
                  {STRONG_REMINDER_NOTE}
                </li>
              ) : null}
            </ul>
          </section>
        )}
      </div>
    </ReplacementPageStatus>
  );
}
