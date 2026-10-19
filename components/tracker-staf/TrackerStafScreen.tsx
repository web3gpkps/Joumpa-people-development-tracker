import { FLAGS } from "@/lib/pd-rules";
import {
  firstParam,
  hrefs,
  parseStation,
  reportGroups,
  sortedStaff,
  stationCodes,
  type ScreenProps,
  activeFirst,
  activeReportGroups,
  activeStationCodes,
} from "@/lib/workspace";
import { todayInJakarta } from "@/components/shell/programme-calendar";
import { PageHeader, PageLoading } from "@/components/ui/PageHeader";
import { RememberView } from "@/components/ui/RememberView";
import { rememberScope } from "@/components/ui/remember";
import { StationSelect } from "@/components/ui/StationSelect";
import { UrlSelect } from "@/components/ui/UrlSelect";
import { ALL_STATIONS, type UrlOption } from "@/components/ui/url-options";
import { AddStaffButton } from "./AddStaffButton";
import { TrackerStafView } from "./TrackerStafView";
import { TrackerSummary, type Tally } from "./TrackerSummary";
import { NO_PROPOSAL, filterRows, parseFilters, scopeRows, slug, summarize, toRows, type Filters } from "./rows";

const TITLE = "Tracker Staf";
const ALL = "semua";

export function TrackerStafLoading() {
  return <PageLoading title={TITLE} label="Memuat tracker staf" />;
}

/**
 * Tracker Staf (KPS and owner; routing sends everyone else away): one row per person with the
 * follow-up actions, the re-assessment and the final decision. Summary and filters (Cabang,
 * Stasiun, Usulan, Flag) come from the URL; the grid and the dialogs edit and save per row.
 */
export function TrackerStafScreen({ access, ws, searchParams: sp }: ScreenProps) {
  const today = todayInJakarta();
  const links = hrefs(access);
  const stations = stationCodes(ws);
  const groups = reportGroups(ws);
  // Filters list the Cabang and stations that have staff; editors list those first, then the rest.
  const activeGroups = activeReportGroups(ws);
  const activeStations = activeStationCodes(ws);
  const stationOrder = activeFirst(activeStations, stations);
  const groupOf: Record<string, string> = Object.fromEntries(ws.stations.map((s) => [s.code, s.reportGroup]));

  const filters = parseFilters(sp, { groups, groupOf, station: parseStation(ws, sp.stasiun) });
  const allRows = toRows(sortedStaff(ws), ws);
  const inScope = scopeRows(allRows, filters);
  const rows = filterRows(allRows, filters, today);
  const summary = summarize(inScope, today);

  const hrefFor = (f: Filters) =>
    links.to("trackerStaf", {
      cabang: f.station ? null : f.group ? slug(f.group) : null,
      stasiun: f.station,
      usulan: f.proposal ? (f.proposal === NO_PROPOSAL ? NO_PROPOSAL : slug(f.proposal)) : null,
      flag: f.flag ? slug(f.flag) : null,
    });

  const scopeName = filters.station
    ? `Stasiun ${filters.station}`
    : filters.group
      ? `Cabang ${filters.group}`
      : ws.isKps
        ? "semua cabang"
        : ws.scopeLabel;
  const flagCount = (flag: string) => summary.flags.find((f) => f.flag === flag)?.count ?? 0;

  // Filter selects. A station decides its own Cabang, so picking one drops ?cabang=.
  const countIn = (group: string | null) => allRows.filter((r) => !group || r.reportGroup === group).length;
  const groupOptions: UrlOption[] = [null, ...activeGroups].map((g) => ({
    value: g ?? ALL,
    label: `${g ?? "Semua cabang"} (${countIn(g)})`,
    href: hrefFor({ ...filters, group: g, station: null }),
  }));
  const stationChoices = activeStations.filter((code) => !filters.group || groupOf[code] === filters.group);
  const stationOptions: UrlOption[] = [null, ...stationChoices].map((code) => ({
    value: code ?? ALL_STATIONS,
    label: `${code ?? "Semua stasiun"} (${code ? allRows.filter((r) => r.station === code).length : countIn(filters.group)})`,
    href: hrefFor({ ...filters, station: code }),
  }));
  const proposalOptions: UrlOption[] = [
    { value: ALL, label: `Semua usulan (${summary.total})`, href: hrefFor({ ...filters, proposal: null }) },
    ...summary.proposals.map((p) => ({
      value: p.value,
      label: `${p.label} (${p.count})`,
      href: hrefFor({ ...filters, proposal: p.value === NO_PROPOSAL ? NO_PROPOSAL : p.label }),
    })),
  ];
  const flagOptions: UrlOption[] = [
    { value: ALL, label: `Semua flag (${summary.total})`, href: hrefFor({ ...filters, flag: null }) },
    ...FLAGS.map((flag) => ({ value: slug(flag), label: `${flag} (${flagCount(flag)})`, href: hrefFor({ ...filters, flag }) })),
  ];
  const proposalValue = filters.proposal ? (filters.proposal === NO_PROPOSAL ? NO_PROPOSAL : slug(filters.proposal)) : ALL;

  const filterSelects = (
    <>
      {ws.isKps ? (
        <>
          <UrlSelect label="Cabang" options={groupOptions} current={filters.group ?? ALL} width="w-full sm:w-44" />
          <StationSelect options={stationOptions} current={filters.station ?? ALL_STATIONS} />
        </>
      ) : null}
      <UrlSelect label="Usulan" options={proposalOptions} current={proposalValue} width="w-full sm:w-52" />
      <UrlSelect label="Flag" options={flagOptions} current={filters.flag ? slug(filters.flag) : ALL} width="w-full sm:w-52" />
    </>
  );

  // Summary tallies: each one filters the table; the active one clears its filter.
  const proposalTallies: Tally[] = summary.proposals.map((p) => {
    const value = p.value === NO_PROPOSAL ? NO_PROPOSAL : p.label;
    const active = filters.proposal === value;
    return { label: p.label, count: p.count, active, href: hrefFor({ ...filters, proposal: active ? null : value }) };
  });
  const flagTallies: Tally[] = summary.flags.map(({ flag, count }) => {
    const active = filters.flag === flag;
    return {
      label: flag,
      count,
      active,
      href: hrefFor({ ...filters, flag: active ? null : flag }),
      tone: flag === "Terlambat" ? "critical" : flag === "Jatuh tempo ≤ 7 hari" ? "warning" : undefined,
    };
  });

  const filtered = Boolean(filters.proposal || filters.flag);
  const emptyTitle =
    ws.staff.length === 0
      ? "Belum ada staf di tracker"
      : filtered
        ? `Tidak ada staf dengan filter ini di ${scopeName}`
        : `Belum ada staf di ${scopeName}`;
  const emptyHint = filtered
    ? "Pilih Semua usulan dan Semua flag untuk melihat seluruh daftar."
    : "Tambahkan lewat Tambah staf.";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={TITLE}
        meta={`${scopeName} · ${summary.total} staf`}
        actions={
          <AddStaffButton accessKey={access.key} stations={stationOrder} groupOf={groupOf} defaultStation={filters.station} />
        }
      >
        {ws.isKps ? (
          <RememberView scope={rememberScope(access, ws)} allowed={{ stasiun: stations }} shown={{ stasiun: filters.station }} />
        ) : null}
      </PageHeader>

      <TrackerSummary summary={summary} proposals={proposalTallies} flags={flagTallies} />

      <TrackerStafView
        accessKey={access.key}
        caption={`Tracker tindak lanjut per staf, ${scopeName}`}
        rows={rows}
        today={today}
        stations={stationOrder}
        groupOf={groupOf}
        penggantianHref={links.penggantian}
        filters={filterSelects}
        emptyTitle={emptyTitle}
        emptyHint={emptyHint}
        focusCode={firstParam(sp.staf)?.toUpperCase() ?? null}
      />
    </div>
  );
}
