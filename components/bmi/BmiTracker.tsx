"use client";

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { StationSelect } from "@/components/ui/StationSelect";
import type { UrlOption } from "@/components/ui/url-options";
import { bmiCheckName } from "@/lib/bmi-periods";
import { slotStatusLine, dueFirst } from "./summary";
import type { Settings } from "@/lib/rules";
import { saveBmiCheck, saveBmiProfile, type BmiActionResult } from "./actions";
import { addStaffFromBmi, editStaffFromBmi } from "./add-staff-action";
import type { AddBmiStaffInput, AddBmiStaffResult } from "./add-staff";
import type { EditBmiStaffInput } from "./edit-staff";
import { AddBmiStaffDialog } from "./AddBmiStaffDialog";
import type { BmiCardProps } from "./BmiCard";
import { BmiDetailPanel } from "./BmiDetailPanel";
import { BmiHero } from "./BmiHero";
import { BmiMetrics } from "./BmiMetrics";
import { BmiPhoneList } from "./BmiPhoneList";
import { BmiTable } from "./BmiTable";
import { scrollLeftFor } from "./period-window";
import { GEOMETRY } from "./table-columns";
import { useToast } from "./BmiToast";
import { bmiExportInput, downloadBmiXlsx, xlsxFilename } from "./xlsx-export";
import { EditCellDialog, type EditRequest, type SaveOutcome } from "./EditCellDialog";
import { EditStaffDialog, type StaffEditRequest } from "./EditStaffDialog";
import { serverCheckErrors } from "./entry";

import {
  CATEGORY_FILTERS,
  STATUS_FILTERS,
  applyEdit,
  filterViews,
  idOf,
  isCategoryFilter,
  isCheckedIn,
  isStatusFilter,
  summaryOf,
  trackerMetrics,
  type BmiRowView,
  type BmiTrackerRow,
  type CategoryFilter,
  type EditTarget,
  type RowEdit,
  type StatusFilter,
} from "./tracker-model";

/** Rows drawn per step: the sheet stays light however many people there are. */
const TABLE_PAGE = 100;
/** Phone cards are forms, so a step is smaller. */
const CARD_PAGE = 30;

/** The server actions the screen calls; a test or a preview may pass stand-ins. */
export type BmiTrackerActions = {
  saveCheck: typeof saveBmiCheck;
  saveProfile: typeof saveBmiProfile;
  addStaff: typeof addStaffFromBmi;
  editStaff: typeof editStaffFromBmi;
};

const REAL_ACTIONS: BmiTrackerActions = {
  saveCheck: saveBmiCheck,
  saveProfile: saveBmiProfile,
  addStaff: addStaffFromBmi,
  editStaff: editStaffFromBmi,
};

export type BmiTrackerProps = {
  /** access.key: a link token, "owner" or "account". Never shown. */
  accessKey: string;
  rows: BmiTrackerRow[];
  settings: Settings;
  /** Planned date of every period, in order (one per check in Parameter). */
  plannedDates: string[];
  /** "BMI Cek ke-3 (Periode 9-22 Nov 2026)" for every period, in order. */
  labels: string[];
  /** Today in Asia/Jakarta, from the server so the schedule does not depend on the browser clock. */
  today: string;
  initialPeriod: number;
  /** The period whose planned date is today, marked "sekarang" in the select; null before the first check. */
  currentPeriod: number | null;
  initialAllPeriods: boolean;
  scope: {
    /** Hero chip, e.g. "Stasiun CGK" or "Semua stasiun". */
    chip: string;
    /** Foot of the Total SDM card, e.g. "Petugas di Stasiun CGK". */
    foot: string;
    /** Station code or "KPS": the Excel file name. */
    code: string;
  };
  /** KPS and owner: the station filter (URL driven). null for a single-station access. */
  stationSelect: { options: UrlOption[]; current: string } | null;
  /** Add dialog: the stations an owner or KPS access may choose; null for a single-station access. */
  addStations: string[] | null;
  /** A single-station access's own station code, shown read-only in the add dialog. */
  ownStation: string;
  /** The station filter's value as a station code, "" for all stations. */
  stationFilter: string;
  /** Page title: "Cek BMI", or v1's "BMI Monitoring Tracker" for a branch account. */
  title: string;
  /** Header of the first identity column and of the Excel export: "ID SDM", or "No Pegawai" in a branch account's view. */
  idLabel: string;
  /** Placeholder of the search box. */
  searchHint: string;
  /** Label of the button that scrolls the table to the chosen check. */
  jumpLabel: string;
  actions?: BmiTrackerActions;
};

const PHONE_QUERY = "(max-width: 560px)";
function subscribePhone(onChange: () => void): () => void {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
/** true on a phone (up to 560px), false above, null before hydration. */
function usePhone(): boolean | null {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => null,
  );
}

const CONNECTION_LOST = "Koneksi ke server terputus. Muat ulang halaman lalu coba lagi.";

function outcomeOf(result: BmiActionResult): SaveOutcome {
  if (result.ok) return { ok: true };
  return { ok: false, message: result.error.message, errors: serverCheckErrors(result.error) };
}

function Control({ id, label, className, children }: { id: string; label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`bmi-control ${className ?? ""}`}>
      <label htmlFor={id} className="section-label">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Cek BMI: hero, four counts and the workspace (filters, legend, the sheet or, on a phone, one
 * card per person). The sheet's yellow cells open a dialog; a name opens the profile panel;
 * a save shows at once (useOptimistic) and the server's refresh then confirms it.
 */
export function BmiTracker({
  accessKey,
  rows: serverRows,
  settings,
  plannedDates,
  labels,
  today,
  initialPeriod,
  currentPeriod,
  initialAllPeriods,
  scope,
  stationSelect,
  addStations,
  ownStation,
  stationFilter,
  title,
  idLabel,
  searchHint,
  jumpLabel,
  actions = REAL_ACTIONS,
}: BmiTrackerProps) {
  const ids = useId();
  const [period, setPeriod] = useState(initialPeriod);
  const [viewAll, setViewAll] = useState(initialAllPeriods);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [paging, setPaging] = useState({ key: "", extra: 0 });
  const [profileCode, setProfileCode] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditRequest | null>(null);
  const [staffEdit, setStaffEdit] = useState<StaffEditRequest | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  const { toast, node: toastNode } = useToast();

  const [rows, applyOptimistic] = useOptimistic(serverRows, applyEdit);

  const views = useMemo<BmiRowView[]>(
    () => rows.map((row) => ({ row, summary: summaryOf(row, settings, today) })),
    [rows, settings, today],
  );

  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(
    () => filterViews(views, { query: deferredQuery, status, category, period }),
    [views, deferredQuery, status, category, period],
  );
  const metrics = useMemo(() => trackerMetrics(views, period), [views, period]);

  // Show more after "Tampilkan ... berikutnya"; any new filter starts from the first page again.
  const pageKey = `${deferredQuery}|${status}|${category}|${period}|${stationFilter}`;
  const extra = paging.key === pageKey ? paging.extra : 0;
  const pageSize = phone ? CARD_PAGE : TABLE_PAGE;
  const limit = pageSize + extra;
  const shown = filtered.slice(0, limit);
  const remaining = filtered.length - shown.length;

  const hasFilters = query !== "" || status !== "all" || category !== "all";

  // The chosen period's columns sit just right of the frozen ones, as in the sheet. The position is
  // arithmetic (every group has the same width), so it holds even when that group is not drawn yet.
  const viewAllRef = useRef(viewAll);
  const periodRef = useRef(period);
  useEffect(() => {
    viewAllRef.current = viewAll;
    periodRef.current = period;
  }, [viewAll, period]);
  const scrollToPeriod = useCallback((smooth: boolean, all?: boolean, chosen?: number) => {
    const wrap = scrollRef.current;
    if (!wrap) return;
    const index = (all ?? viewAllRef.current) ? (chosen ?? periodRef.current) - 1 : 0;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    wrap.scrollTo({ left: scrollLeftFor(index, GEOMETRY), behavior: smooth && !calm ? "smooth" : "auto" });
  }, []);

  // Open on the chosen period's columns, as the sheet does; the table is not there on a phone.
  useEffect(() => {
    if (phone === false) scrollToPeriod(false);
  }, [phone, scrollToPeriod]);

  function choosePeriod(next: number) {
    setPeriod(next);
    requestAnimationFrame(() => scrollToPeriod(true, undefined, next));
  }

  function chooseView(all: boolean) {
    setViewAll(all);
    requestAnimationFrame(() => scrollToPeriod(false, all));
  }

  /** Runs one save: the screen shows it at once and the server's refresh confirms it. */
  const run = useCallback(
    (edit: RowEdit, call: () => Promise<BmiActionResult>) =>
      new Promise<SaveOutcome>((resolve) => {
        startTransition(async () => {
          applyOptimistic(edit);
          let outcome: SaveOutcome;
          try {
            outcome = outcomeOf(await call());
          } catch {
            outcome = { ok: false, message: CONNECTION_LOST };
          }
          resolve(outcome);
        });
      }),
    [applyOptimistic],
  );

  const rowOf = (code: string) => rows.find((r) => r.code === code);

  const saveCheck = async (
    code: string,
    p: number,
    check: { checkDate: string | null; heightCm: number; weightKg: number },
  ): Promise<SaveOutcome> => {
    const outcome = await run(
      {
        type: "check",
        code,
        period: p,
        check: { date: check.checkDate, heightCm: check.heightCm, weightKg: check.weightKg },
      },
      () => actions.saveCheck(accessKey, { staffCode: code, period: p, ...check }),
    );
    if (outcome.ok) toast("Perubahan tersimpan");
    return outcome;
  };

  const deleteCheck = async (code: string, p: number): Promise<SaveOutcome> => {
    const outcome = await run({ type: "check", code, period: p, check: null }, () =>
      actions.saveCheck(accessKey, { staffCode: code, period: p, checkDate: null, heightCm: null, weightKg: null }),
    );
    if (outcome.ok) toast(`${bmiCheckName(p)} dihapus`);
    return outcome;
  };

  const saveProfile = async (
    code: string,
    patch: { fitnessNote: string | null },
  ): Promise<SaveOutcome> => {
    const row = rowOf(code);
    if (!row) return { ok: false, message: "SDM ini tidak ada lagi. Muat ulang halaman." };
    const note = patch.fitnessNote;
    const outcome = await run({ type: "profile", code, patch }, () =>
      actions.saveProfile(accessKey, {
        staffCode: code,
        gender: row.gender === "L" || row.gender === "P" ? row.gender : null,
        bmiNote: note,
      }),
    );
    if (outcome.ok) toast("Perubahan tersimpan");
    return outcome;
  };

  /** "Ubah profil": the new name, NIPP and L/P show at once, the server confirms them. */
  const saveStaffProfile = async (input: EditBmiStaffInput): Promise<SaveOutcome> => {
    const row = rowOf(input.code);
    if (!row) return { ok: false, message: "SDM ini tidak ada lagi. Muat ulang halaman." };
    const employeeNo = input.employeeNo.trim() === "" ? null : input.employeeNo.trim();
    const outcome = await run(
      {
        type: "profile",
        code: input.code,
        patch: {
          name: input.name.trim(),
          employeeNo,
          gender: input.gender,
          // A branch account's first column shows the employee number.
          ...(row.displayId !== undefined ? { displayId: employeeNo ?? "" } : {}),
        },
      },
      async (): Promise<BmiActionResult> => {
        const result = await actions.editStaff(accessKey, input);
        return result.ok ? { ok: true, deleted: false, savedAt: new Date().toISOString() } : result;
      },
    );
    if (outcome.ok) toast("Profil tersimpan");
    return outcome;
  };

  const addStaff = (input: AddBmiStaffInput): Promise<AddBmiStaffResult> => actions.addStaff(accessKey, input);

  // Every opening has its own number for good: a dialog remembers things per opening (the "Hapus cek?" step),
  // so a number that started again from 1 after a close would bring that step back by itself.
  const openings = useRef(0);
  const openEdit = useCallback((target: EditTarget) => setEdit({ n: ++openings.current, target }), []);
  const openProfile = useCallback((code: string) => setProfileCode(code), []);
  // "Edit Profil" in the profile panel: the panel closes and the form opens in its place.
  const openStaffEdit = useCallback((code: string) => {
    setProfileCode(null);
    setStaffEdit({ n: ++openings.current, code });
  }, []);

  // The workbook is what the screen shows now: these rows, counts, filters and period groups.
  async function exportXlsx() {
    if (exporting) return;
    setExporting(true);
    try {
      const input = bmiExportInput({
        views,
        filtered,
        metrics,
        settings,
        labels,
        period,
        currentPeriod,
        viewAll,
        query,
        status,
        category,
        station: stationSelect ? (stationSelect.options.find((o) => o.value === stationSelect.current)?.label ?? null) : null,
        idLabel,
        scope,
        now: new Date(),
      });
      await downloadBmiXlsx(input, xlsxFilename(scope.code, today));
      toast(`Excel diekspor: ${filtered.length} petugas`);
    } catch {
      toast("Excel belum bisa dibuat. Coba lagi.");
    } finally {
      setExporting(false);
    }
  }

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setCategory("all");
  }

  /** Phone cards: due and late first, for the chosen period. */
  const cards = useMemo<Array<Omit<BmiCardProps, "accessKey">>>(() => {
    if (phone !== true) return [];
    return dueFirst(shown, (v) => v.summary, period).map(({ row, summary }) => {
      const slot = summary.periods[period - 1] ?? null;
      return {
        period,
        // Checks are recorded on the day they are entered, never on a planned date still ahead.
        defaultDate: today,
        plannedDates,
        labels,
        settings,
        person: {
          code: row.code,
          displayId: idOf(row),
          name: row.name,
          station: row.station,
          employeeNo: row.employeeNo ?? null,
          gender: row.gender,
          bmiNote: row.fitnessNote,
          assignmentStatus: row.assignmentStatus,
          summary,
        },
        showStation: stationSelect !== null,
        status: slotStatusLine(slot, summary, today),
        saved:
          slot && isCheckedIn(summary, period) && slot.heightCm !== null && slot.weightKg !== null
            ? { checkDate: slot.checkDate, heightCm: slot.heightCm, weightKg: slot.weightKg }
            : null,
      };
    });
  }, [phone, shown, period, plannedDates, labels, settings, today, stationSelect]);

  const editRow = edit ? rowOf(edit.target.code) : undefined;
  const staffEditRow = staffEdit ? rowOf(staffEdit.code) : undefined;
  const profileView = profileCode ? (views.find((v) => v.row.code === profileCode) ?? null) : null;

  // 52 options at most; rebuilt only when the labels or the current period change, not on every keystroke.
  const periodOptions = useMemo(
    () =>
      labels.map((label, i) => (
        <option key={label} value={i + 1}>
          {label}
          {currentPeriod === i + 1 ? " · sekarang" : ""}
        </option>
      )),
    [labels, currentPeriod],
  );

  const nothingYet = views.length === 0;

  return (
    <div className="bmi-tracker flex flex-col gap-4">
      <BmiHero title={title} meta={scope.chip}>
        <Button
          variant="secondary"
          className="max-sm:hidden"
          onClick={exportXlsx}
          disabled={filtered.length === 0}
          loading={exporting}
          loadingText="Menyusun Excel…"
          title={filtered.length === 0 ? "Tidak ada staf untuk diekspor" : undefined}
        >
          Ekspor Excel
        </Button>
        <Button onClick={() => setAddOpen(true)}>Tambah SDM</Button>
      </BmiHero>

      <BmiMetrics metrics={metrics} period={period} scopeFoot={scope.foot} />

      <section className="bmi-workspace" aria-labelledby={`${ids}-title`}>
        <div className="bmi-ws-head">
          <h2 id={`${ids}-title`} className="bmi-ws-title">
            Daftar staf
          </h2>
        </div>

        {nothingYet ? (
          <div className="bmi-ws-empty">
            <EmptyState
              title={`Belum ada SDM di ${scope.chip.toLowerCase().startsWith("semua") ? "semua stasiun" : scope.chip}`}
              action={<Button onClick={() => setAddOpen(true)}>Tambah SDM</Button>}
            >
              Cek BMI dicatat per SDM. Tambahkan SDM pertama untuk mulai.
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="bmi-controls" role="group" aria-label="Filter cek BMI" data-print="hide">
              <Control id={`${ids}-q`} label="Cari petugas" className="bmi-control--search">
                <Input
                  id={`${ids}-q`}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchHint}
                  autoComplete="off"
                />
              </Control>
              <Control id={`${ids}-p`} label={period === currentPeriod ? "Periode pemeriksaan · sekarang" : "Periode pemeriksaan"} className="bmi-control--period">
                <Select id={`${ids}-p`} value={period} onChange={(e) => choosePeriod(Number(e.target.value))}>
                  {periodOptions}
                </Select>
              </Control>
              {stationSelect ? <StationSelect options={stationSelect.options} current={stationSelect.current} /> : null}
              <Control id={`${ids}-s`} label="Status jadwal" className="bmi-control--filter">
                <Select
                  id={`${ids}-s`}
                  value={status}
                  onChange={(e) => isStatusFilter(e.target.value) && setStatus(e.target.value)}
                >
                  {STATUS_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Control>
              <Control id={`${ids}-c`} label="Kategori BMI terakhir" className="bmi-control--filter">
                <Select
                  id={`${ids}-c`}
                  value={category}
                  onChange={(e) => isCategoryFilter(e.target.value) && setCategory(e.target.value)}
                >
                  {CATEGORY_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Control>
              {phone !== true ? (
                <>
                  <span className="bmi-spacer" />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => scrollToPeriod(true)}
                    title="Geser tabel ke kolom cek yang dipilih"
                  >
                    {jumpLabel}
                  </Button>
                  <div className="bmi-switch" role="group" aria-label="Tampilan kolom">
                    <button type="button" aria-pressed={viewAll} onClick={() => chooseView(true)}>
                      Semua periode
                    </button>
                    <button type="button" aria-pressed={!viewAll} onClick={() => chooseView(false)}>
                      Fokus periode
                    </button>
                  </div>
                </>
              ) : null}
            </div>

            <div className="bmi-legend" data-print="hide">
              {phone !== true ? (
                <p className="bmi-legend-key">
                  <span>
                    <i className="bmi-legend-mark bmi-legend-mark--input" aria-hidden="true" />
                    Isian, klik untuk mengisi
                  </span>
                  <span>
                    <i className="bmi-legend-mark bmi-legend-mark--formula" aria-hidden="true" />
                    Hasil perhitungan otomatis
                  </span>
                  <span>
                    <i className="bmi-legend-mark bmi-legend-mark--link" aria-hidden="true" />
                    Identitas dari Master SDM
                  </span>
                </p>
              ) : (
                <span />
              )}
              <span className="bmi-count" role="status" aria-live="polite">
                {filtered.length} dari {views.length} petugas
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className="bmi-ws-empty">
                <EmptyState
                  title="Tidak ada petugas yang cocok"
                  action={
                    hasFilters ? (
                      <Button variant="secondary" onClick={clearFilters}>
                        Hapus pencarian dan filter
                      </Button>
                    ) : undefined
                  }
                >
                  Ubah kata kunci atau filter di atas.
                </EmptyState>
              </div>
            ) : phone === true ? (
              <BmiPhoneList
                key={`${period}|${status}|${category}|${stationFilter}`}
                label={labels[period - 1] ?? bmiCheckName(period)}
                cards={cards}
                accessKey={accessKey}
                more={remaining > 0}
              />
            ) : (
              <div className="bmi-table-region" data-pending={phone === null || undefined}>
                <a href={`#${ids}-after`} className="bmi-skip">
                  Lewati tabel
                </a>
                <BmiTable
                  caption={`Cek BMI, ${scope.chip}`}
                  views={shown}
                  labels={labels}
                  period={period}
                  viewAll={viewAll}
                  idLabel={idLabel}
                  onEdit={openEdit}
                  onProfile={openProfile}
                  scrollRef={scrollRef}
                />
                <div id={`${ids}-after`} tabIndex={-1} />
              </div>
            )}

            <div className="bmi-bottom">
              <span>
                {filtered.length > 0 ? (
                  <>
                    Menampilkan <strong>{shown.length}</strong> dari <strong>{filtered.length}</strong> petugas
                  </>
                ) : null}
              </span>
              {remaining > 0 ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setPaging({ key: pageKey, extra: extra + pageSize })}
                >
                  Tampilkan {Math.min(pageSize, remaining)} berikutnya
                </Button>
              ) : null}
            </div>
          </>
        )}
      </section>

      <EditCellDialog
        request={edit}
        row={editRow ?? null}
        settings={settings}
        plannedDates={plannedDates}
        labels={labels}
        today={today}
        onClose={() => setEdit(null)}
        saveCheck={saveCheck}
        deleteCheck={deleteCheck}
        saveProfile={saveProfile}
      />
      <EditStaffDialog request={staffEdit} row={staffEditRow ?? null} onClose={() => setStaffEdit(null)} onSave={saveStaffProfile} />
      <BmiDetailPanel
        open={profileView !== null}
        onClose={() => setProfileCode(null)}
        view={profileView}
        settings={settings}
        plannedDates={plannedDates}
        labels={labels}
        period={period}
        onEditProfile={openStaffEdit}
      />
      <AddBmiStaffDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          toast("SDM tersimpan. Sinkronisasi belum dikonfirmasi.");
        }}
        addStaff={addStaff}
        settings={settings}
        plannedDates={plannedDates}
        labels={labels}
        today={today}
        defaultPeriod={period}
        stations={addStations}
        ownStation={ownStation}
        initialStation={stationFilter}
      />
      {toastNode}
    </div>
  );
}
