import { periodLabel } from "@/lib/pd-rules";
import { activeFirst, activeReportGroups, firstParam, hrefs, reportGroups, type ScreenProps } from "@/lib/workspace";
import { todayInJakarta } from "@/components/shell/programme-calendar";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { TableSkeleton } from "@/components/ui/States";
import { Toolbar } from "@/components/ui/Toolbar";
import { UrlSelect } from "@/components/ui/UrlSelect";
import { AddReportButton } from "./AddReportButton";
import { MonthlyReportSheet } from "./MonthlyReportSheet";
import { PeriodSummary } from "./PeriodSummary";
import {
  ALL,
  applyFilters,
  groupsWithReports,
  monthValue,
  parseFilters,
  periodSummaries,
  periodsWithReports,
  toRows,
  yearOptions,
} from "./monthly-view";

const TITLE = "Laporan Bulanan";
/** One meta line: when reports are due and the targets they are measured against. */
const SUBTITLE = "Tiap tanggal 5 · target ≥ 90% staf Sesuai · keluhan direspons ≤ 1×24 jam · kepuasan ≥ 4,25 (KNO, BPN)";

/** Suspense fallback: the banner right away, then the summary and the sheet as skeletons. */
export function LaporanBulananLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} meta={SUBTITLE} />
      <TableSkeleton label="Memuat ringkasan per periode" rows={3} columns={6} />
      <TableSkeleton label="Memuat laporan bulanan" rows={8} columns={9} />
    </div>
  );
}

/**
 * Laporan Bulanan for KPS and the owner: one report per Cabang per month, due on the 5th. The
 * summary per period answers "who has reported, on time, at target"; the sheet below is where
 * the reports are entered. Filters (?cabang=, ?periode=2026-10) live in the URL.
 */
export function LaporanBulananScreen({ access, ws, searchParams }: ScreenProps) {
  const today = todayInJakarta();
  const links = hrefs(access);
  const groups = reportGroups(ws);
  const all = toRows(ws, groups);
  const filters = parseFilters(all, firstParam(searchParams.cabang), firstParam(searchParams.periode));
  const rows = applyFilters(all, filters);
  const summaries = periodSummaries(rows, today);

  const cabangValue = filters.group ?? ALL;
  const periodeValue = filters.period ? monthValue(filters.period) : ALL;
  const query = (cabang: string, periode: string) =>
    links.to("laporanBulanan", { cabang: cabang === ALL ? null : cabang, periode: periode === ALL ? null : periode });

  const cabangOptions = [ALL, ...groupsWithReports(all, groups)].map((g) => ({
    value: g,
    label: g === ALL ? "Semua cabang" : g,
    href: query(g, periodeValue),
  }));
  const periodeOptions = [ALL, ...periodsWithReports(all).map(monthValue)].map((m) => ({
    value: m,
    label: m === ALL ? "Semua periode" : periodLabel(`${m}-01`),
    href: query(cabangValue, m),
  }));

  const scopeText = [filters.group ?? "semua cabang", filters.period ? periodLabel(filters.period) : "semua periode"].join(", ");
  const filtered = filters.group !== null || filters.period !== null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={TITLE}
        meta={SUBTITLE}
        actions={
          <AddReportButton
            accessKey={access.key}
            groups={activeFirst(activeReportGroups(ws), groups)}
            existing={all.map((r) => r.key)}
            years={yearOptions(today, all)}
            today={today}
            listHref={links.laporanBulanan}
            filters={filters}
          />
        }
      />

      {all.length > 0 ? (
        <Toolbar label="Filter laporan bulanan" end={<span className="tabular-nums">{rows.length} laporan</span>}>
          <UrlSelect label="Cabang" options={cabangOptions} current={cabangValue} width="w-full sm:w-48" className="min-w-0 flex-1 sm:flex-none" />
          <UrlSelect label="Periode" options={periodeOptions} current={periodeValue} width="w-full sm:w-44" className="min-w-0 flex-1 sm:flex-none" />
        </Toolbar>
      ) : null}

      {summaries.length > 0 ? (
        <Panel id="ringkasan-periode" title="Ringkasan per periode" padding="flush">
          <PeriodSummary rows={summaries} />
        </Panel>
      ) : null}

      <section aria-labelledby="laporan-cabang-title" className="flex flex-col gap-3">
        <h2 id="laporan-cabang-title" className="text-lg font-semibold text-ink">
          Laporan per cabang
        </h2>
        <MonthlyReportSheet
          accessKey={access.key}
          rows={rows}
          today={today}
          caption={`Laporan bulanan, ${scopeText}`}
          empty={
            filtered
              ? { title: "Tidak ada laporan untuk filter ini", body: "Pilih cabang atau periode lain, atau tambahkan laporannya." }
              : {
                  title: "Belum ada laporan bulanan",
                  body: "Tambahkan laporan per cabang setiap bulan. Laporan jatuh tempo tanggal 5 bulan berikutnya.",
                }
          }
        />
      </section>
    </div>
  );
}
