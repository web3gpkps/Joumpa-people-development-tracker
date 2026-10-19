/*
 * DATA RULE. Cek BMI shows only what the Google Sheet tab "Cek BMI 2 Mingguan" holds: the staff
 * identity columns (ID SDM, Nama, Stasiun, L/P, plus NIPP for a branch account) and the
 * Catatan / Program Penyesuaian BB, plus bmi_checks, the schedule settings and the station list. This screen and everything under components/bmi must not read the weekly scores,
 * remedials, replacements, action items, weekly reports or the baseline scores from the workspace.
 * components/bmi/data-source.test.ts fails when a file here names one of those fields.
 */
import { bmiCheckLabels } from "@/lib/bmi-periods";
import { bmiCheckDate } from "@/lib/rules";
import {
  changedVia,
  firstParam,
  hrefs,
  parseStation,
  ruleSettings,
  shortDateTime,
  sortedStaff,
  stationCodes,
  type ScreenProps,
  type Workspace,
  activeStationCodes,
} from "@/lib/workspace";
import { Panel } from "@/components/ui/Panel";
import { ErrorState, TableSkeleton } from "@/components/ui/States";
import { ALL_STATIONS } from "@/components/ui/url-options";
import { RememberView } from "@/components/ui/RememberView";
import { rememberScope } from "@/components/ui/remember";
import { todayInJakarta } from "@/components/shell/programme-calendar";
import { BRANCH_BMI_MENU_LABEL, bmiPeriodView, isBranchAccount } from "@/components/shell/branch-scope";
import { BmiHero } from "./BmiHero";
import { BmiMetricsSkeleton } from "./BmiMetrics";
import { BmiTracker } from "./BmiTracker";
import { defaultPeriod } from "./summary";
import type { BmiStoredCheck, BmiTrackerRow } from "./tracker-model";

/** "tautan ini, 8 Okt 07.55" (the profile panel says "Terakhir diubah lewat"). */
function changedWhen(row: { updatedByLink?: string | null; updatedAt?: string | null }, ws: Workspace): string {
  const when = shortDateTime(row.updatedAt);
  return `${changedVia(row, ws)}${when ? `, ${when}` : ""}`;
}

/** Suspense fallback: the banner, four empty cards and a skeleton sheet. */
/** Tracker Staf "Keputusan akhir" as the BMI screens' assignment chip: shown once someone left the service. */
function assignmentOf(finalDecision: string | null | undefined): string {
  return finalDecision === "Diganti" || finalDecision === "Ditarik dari JOUMPA" ? finalDecision : "Aktif";
}

export function BmiLoading() {
  return (
    <div className="bmi-tracker flex flex-col gap-4">
      <BmiHero />
      <BmiMetricsSkeleton />
      <TableSkeleton label="Memuat cek BMI" columns={8} />
    </div>
  );
}

/**
 * Cek BMI for every access (station link, branch account, owner): the server shapes the rows
 * and the scope, BmiTracker draws and edits them. Station links and accounts see their own
 * station; KPS and the owner get a station filter.
 */
export function BmiScreen({ access, ws, searchParams: query }: ScreenProps) {
  const today = todayInJakarta();
  // A branch account (not KPS, not the owner) sees the employee number instead of the ID SDM.
  const branchView = isBranchAccount(access, ws);
  // Without the schedule the BMI periods cannot be placed on dates.
  const settings = ws.schedule ? ruleSettings(ws.settings) : null;

  if (!settings) {
    return (
      <div className="bmi-tracker flex flex-col gap-4">
        <BmiHero />
        <Panel>
          <ErrorState
            title="Jadwal cek BMI belum diatur"
            cause="Tanggal cek pertama, jarak antar cek, atau jumlah cek belum diisi di Parameter."
            action="Minta pemilik aplikasi melengkapi Parameter, lalu muat ulang halaman ini."
          />
        </Panel>
      </div>
    );
  }

  const links = hrefs(access);
  const stationFilter = parseStation(ws, query.stasiun);
  const stations = stationCodes(ws);
  // The station filter lists stations with staff (the database holds 35, the programme a few).
  const filterStations = activeStationCodes(ws);
  const periodView = bmiPeriodView(firstParam(query.semua));

  const requestedPeriod = Number(firstParam(query.periode));
  const initialPeriod =
    Number.isInteger(requestedPeriod) && requestedPeriod >= 1 && requestedPeriod <= settings.bmiPeriods
      ? requestedPeriod
      : defaultPeriod(settings, today);
  const currentPeriod = bmiCheckDate(1, settings) <= today ? defaultPeriod(settings, today) : null;
  const plannedDates = Array.from({ length: settings.bmiPeriods }, (_, i) => bmiCheckDate(i + 1, settings));
  // "BMI Cek ke-3 (Periode 9-22 Nov 2026)" for every period, built once on the server.
  const labels = bmiCheckLabels(settings);

  const checksByStaff = new Map<string, Workspace["bmiChecks"]>();
  for (const c of ws.bmiChecks) {
    const list = checksByStaff.get(c.staffCode);
    if (list) list.push(c);
    else checksByStaff.set(c.staffCode, [c]);
  }

  const rows: BmiTrackerRow[] = sortedStaff(ws)
    .filter((st) => !stationFilter || st.station === stationFilter)
    .map((st) => {
      const checks: Array<BmiStoredCheck | null> = Array.from({ length: settings.bmiPeriods }, () => null);
      let latest: Workspace["bmiChecks"][number] | null = null;
      for (const c of checksByStaff.get(st.code) ?? []) {
        if (!latest || (c.updatedAt ?? "") > (latest.updatedAt ?? "")) latest = c;
        if (c.period >= 1 && c.period <= settings.bmiPeriods && c.heightCm !== null && c.weightKg !== null) {
          checks[c.period - 1] = {
            date: c.checkDate ?? null,
            heightCm: Number(c.heightCm),
            weightKg: Number(c.weightKg),
          };
        }
      }
      return {
        code: st.code,
        // A branch account sees the NIPP (No Pegawai) where the ID SDM would be.
        ...(branchView ? { displayId: st.nipp ?? "" } : {}),
        employeeNo: st.nipp ?? null,
        name: st.name ?? st.code,
        station: st.station,
        gender: st.gender,
        fitnessNote: st.bmiNote,
        assignmentStatus: assignmentOf(st.finalDecision),
        changed: latest ? changedWhen(latest, ws) : null,
        checks,
      };
    });

  const stationName = stationFilter ? `Stasiun ${stationFilter}` : ws.isKps ? "Semua stasiun" : `Stasiun ${ws.scope}`;
  const stationOptions = ws.isKps
    ? [null, ...filterStations].map((code) => ({
        value: code ?? ALL_STATIONS,
        label: code ?? "Semua stasiun",
        href: links.to("bmi", { stasiun: code ?? ALL_STATIONS, semua: periodView.query(periodView.allSlots) }),
      }))
    : null;

  return (
    <>
      <RememberView
        scope={rememberScope(access, ws)}
        allowed={ws.isKps ? { stasiun: stations } : {}}
        shown={{ stasiun: stationFilter }}
      />
      <BmiTracker
        accessKey={access.key}
        rows={rows}
        settings={settings}
        plannedDates={plannedDates}
        labels={labels}
        today={today}
        initialPeriod={initialPeriod}
        currentPeriod={currentPeriod}
        initialAllPeriods={periodView.allSlots}
        scope={{
          chip: stationName,
          foot: ws.isKps && !stationFilter ? "Petugas di semua stasiun" : `Petugas di ${stationName}`,
          code: stationFilter ?? (ws.isKps ? "KPS" : ws.scope),
        }}
        stationSelect={stationOptions ? { options: stationOptions, current: stationFilter ?? ALL_STATIONS } : null}
        addStations={ws.isKps ? stations : null}
        ownStation={ws.isKps ? "" : ws.scope}
        stationFilter={stationFilter ?? ""}
        title={branchView ? BRANCH_BMI_MENU_LABEL : "Cek BMI"}
        idLabel={branchView ? "No Pegawai" : "ID SDM"}
        searchHint={branchView ? "Nama atau No Pegawai" : "Nama atau ID SDM"}
        jumpLabel={branchView ? "Lihat Cek BMI" : "Lihat Cek"}
      />
    </>
  );
}
