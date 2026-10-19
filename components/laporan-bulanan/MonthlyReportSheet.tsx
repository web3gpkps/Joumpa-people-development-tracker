"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { formatTanggal } from "@/lib/dates";
import { YA_BELUM_TIDAK, monthlyCompliance, monthlyOnTime, monthlyTargetMet } from "@/lib/pd-rules";
import { DataGrid, type CellValue, type GridColumn, type SaveRowResult } from "@/components/grid/DataGrid";
import { Button } from "@/components/ui/Button";
import { SaveStatus, type SaveState } from "@/components/ui/SaveStatus";
import { EmptyState } from "@/components/ui/States";
import { StatusChip } from "@/components/ui/StatusChip";
import { cx } from "@/components/ui/cx";
import { saveMonthlyReport } from "./actions";
import { DeleteReportDialog } from "./DeleteReportDialog";
import { Dash, YesNo, formatCompliance, formatSatisfaction } from "./display";
import { EditReportDialog } from "./EditReportDialog";
import { COUNT_MAX, NOTES_MAX, SATISFACTION_MAX, compliantError, fieldOfColumn, type MonthlyPatch } from "./monthly-input";
import { satisfactionBelowTarget, type MonthlyReportRow } from "./monthly-view";

type MonthlyReportSheetProps = {
  accessKey: string;
  /** Filtered, in display order. */
  rows: MonthlyReportRow[];
  /** Today (Asia/Jakarta), for Tepat waktu? of a report not received yet. */
  today: string;
  /** "Laporan bulanan, semua cabang, semua periode". */
  caption: string;
  /** Shown when there are no rows: why, and what fills it. */
  empty: { title: string; body: string };
};

const num = (v: CellValue) => (typeof v === "number" ? v : null);
const text = (v: CellValue) => (typeof v === "string" && v !== "" ? v : null);

/** Group headers (the workbook's column bands). */
const SENT = "Pengiriman laporan";
const COMPLIANCE = "Kepatuhan petugas";
const SERVICE = "Keluhan dan kepuasan";

/**
 * Laporan Bulanan as an editable sheet (desktop and tablet) and as cards with a "Perbarui"
 * form (phones). Cabang and Periode are the row's key and never change here; Tepat waktu?,
 * % Sesuai and Capai target follow the cells as typed. Saving is per row, automatic.
 */
export function MonthlyReportSheet({ accessKey, rows, today, caption, empty }: MonthlyReportSheetProps) {
  const [deleting, setDeleting] = useState<MonthlyReportRow | null>(null);
  const [editing, setEditing] = useState<MonthlyReportRow | null>(null);
  const [status, setStatus] = useState<SaveState>({ status: "idle" });

  const columns = useMemo<GridColumn<MonthlyReportRow>[]>(
    () => [
      { key: "reportGroup", header: "Cabang", width: 112, editor: "readonly", frozen: true },
      { key: "periodLabel", header: "Periode", width: 92, editor: "readonly", frozen: true },
      { key: "dueOn", header: "Jatuh tempo", label: "Jatuh tempo laporan", group: SENT, width: 124, editor: "date" },
      { key: "receivedOn", header: "Tgl diterima", label: "Tanggal diterima", group: SENT, width: 124, editor: "date" },
      {
        key: "onTime",
        header: "Tepat waktu?",
        group: SENT,
        width: 112,
        editor: "readonly",
        derive: (_row, value) => monthlyOnTime({ dueOn: text(value("dueOn")), receivedOn: text(value("receivedOn")) }, today),
        render: (value) => <YesNo value={text(value)} empty="belum diterima" />,
      },
      {
        key: "activeStaff",
        header: "Staf aktif",
        label: "Total staf aktif",
        group: COMPLIANCE,
        width: 92,
        editor: "number",
        decimals: 0,
        min: 0,
        max: COUNT_MAX,
        validate: (value, row) => compliantError(num(value), row.compliantStaff),
      },
      {
        key: "compliantStaff",
        header: "Staf Sesuai",
        label: "Staf berstatus Sesuai",
        group: COMPLIANCE,
        width: 96,
        editor: "number",
        decimals: 0,
        min: 0,
        max: COUNT_MAX,
        validate: (value, row) => compliantError(row.activeStaff, num(value)),
      },
      {
        key: "compliance",
        header: "% Sesuai",
        group: COMPLIANCE,
        width: 88,
        editor: "readonly",
        align: "end",
        derive: (_row, value) => monthlyCompliance({ activeStaff: num(value("activeStaff")), compliantStaff: num(value("compliantStaff")) }),
        render: (value) => (num(value) === null ? <Dash reason="belum bisa dihitung" /> : formatCompliance(num(value))),
      },
      {
        key: "targetMet",
        header: "Target ≥ 90%?",
        label: "Capai target ≥ 90%?",
        group: COMPLIANCE,
        width: 112,
        editor: "readonly",
        derive: (_row, value) =>
          monthlyTargetMet({ activeStaff: num(value("activeStaff")), compliantStaff: num(value("compliantStaff")) }),
        render: (value) => <YesNo value={text(value)} empty="belum bisa dihitung" />,
      },
      {
        key: "complaints",
        header: "Keluhan",
        label: "Keluhan sikap / komunikasi",
        group: SERVICE,
        width: 84,
        editor: "number",
        decimals: 0,
        min: 0,
        max: COUNT_MAX,
        render: (value) => <span className={cx((num(value) ?? 0) > 0 && "font-semibold text-critical")}>{num(value) ?? ""}</span>,
      },
      {
        key: "responded",
        header: "Direspons ≤ 1×24 jam?",
        label: "Semua direspons ≤ 1×24 jam?",
        group: SERVICE,
        width: 132,
        editor: "select",
        options: YA_BELUM_TIDAK.map((v) => ({ value: v })),
        render: (value) => (text(value) ? <YesNo value={text(value)} /> : null),
      },
      {
        key: "satisfaction",
        header: "Indeks kepuasan",
        label: "Indeks kepuasan JOUMPA (0 sampai 5)",
        group: SERVICE,
        width: 100,
        editor: "number",
        decimals: 2,
        min: 0,
        max: SATISFACTION_MAX,
        render: (value, row) => (
          <span className={cx(satisfactionBelowTarget(row, num(value)) && "font-semibold text-warning")}>
            {formatSatisfaction(num(value))}
          </span>
        ),
      },
      { key: "notes", header: "Catatan", width: 240, editor: "longtext", maxLength: NOTES_MAX },
      {
        key: "changed",
        header: "Terakhir diubah",
        width: 264,
        editor: "readonly",
        render: (value) => <span className="text-ink-muted">{text(value) ?? ""}</span>,
      },
    ],
    [today],
  );

  const onSaveRow = useCallback(
    async (_key: string, changes: Record<string, CellValue>, row: MonthlyReportRow): Promise<SaveRowResult> => {
      try {
        const result = await saveMonthlyReport(accessKey, {
          reportGroup: row.reportGroup,
          period: row.period,
          patch: changes as MonthlyPatch,
        });
        if (result.ok) return { ok: true };
        const field = fieldOfColumn(result.error.field);
        return field
          ? { ok: false, message: result.error.message, fieldErrors: { [field]: result.error.message } }
          : { ok: false, message: result.error.message };
      } catch {
        return { ok: false, message: "Server tidak menjawab. Periksa koneksi, lalu coba lagi." };
      }
    },
    [accessKey],
  );

  const rowKey = useCallback((r: MonthlyReportRow) => r.key, []);
  const rowLabel = useCallback((r: MonthlyReportRow) => `${r.reportGroup}, ${r.periodLabel}`, []);
  const rowActions = useMemo(
    () => ({
      header: "Aksi",
      width: 84,
      render: (r: MonthlyReportRow) => (
        <Button size="sm" variant="ghost" onClick={() => setDeleting(r)} aria-label={`Hapus laporan ${r.reportGroup} ${r.periodLabel}`}>
          Hapus
        </Button>
      ),
    }),
    [],
  );
  const search = useMemo(() => ({ placeholder: "Cari cabang atau catatan", text: (r: MonthlyReportRow) => `${r.reportGroup} ${r.periodLabel} ${r.notes ?? ""}` }), []);

  const emptyState = (
    <EmptyState title={empty.title} className="px-4">
      {empty.body}
    </EmptyState>
  );

  return (
    <>
      <DataGrid
        caption={caption}
        rows={rows}
        columns={columns}
        rowKey={rowKey}
        rowLabel={rowLabel}
        onSaveRow={onSaveRow}
        rowActions={rowActions}
        search={rows.length > 6 ? search : undefined}
        emptyState={emptyState}
        phone={
          <PhoneCards
            rows={rows}
            today={today}
            status={status}
            empty={emptyState}
            onEdit={setEditing}
            onDelete={setDeleting}
          />
        }
      />
      <EditReportDialog
        accessKey={accessKey}
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={(_row, savedAt) => setStatus({ status: "saved", at: savedAt })}
      />
      <DeleteReportDialog
        accessKey={accessKey}
        row={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          setStatus({ status: "deleted", at: new Date() });
        }}
      />
    </>
  );
}

function Fact({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-0.5", wide && "col-span-2")}>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-sm text-ink tabular-nums [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const date = (iso: string | null, reason: string) => (iso ? formatTanggal(iso) : <Dash reason={reason} />);
const count = (n: number | null) => (n === null ? <Dash reason="belum diisi" /> : n);

/** Phones: one card per report, its figures as label / value pairs, "Perbarui" and "Hapus". */
function PhoneCards({
  rows,
  today,
  status,
  empty,
  onEdit,
  onDelete,
}: {
  rows: MonthlyReportRow[];
  today: string;
  status: SaveState;
  empty: ReactNode;
  onEdit: (row: MonthlyReportRow) => void;
  onDelete: (row: MonthlyReportRow) => void;
}) {
  if (rows.length === 0) return <div className="rounded-panel border border-line bg-surface shadow-card">{empty}</div>;
  return (
    <div className="flex flex-col gap-1">
      {/* Mounted from the start so the first save is announced; takes no room until then. */}
      <SaveStatus state={status} className={status.status === "idle" ? "sr-only" : undefined} />
      <ul className="flex flex-col gap-3" aria-label="Laporan bulanan">
        {rows.map((r) => {
          const onTime = monthlyOnTime(r, today);
          const share = monthlyCompliance(r);
          return (
            <li key={r.key} className="rounded-panel border border-line bg-surface shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <h3 className="text-base font-semibold text-ink">
                  <span className="station-code">{r.reportGroup}</span>
                  <span className="font-normal text-ink-muted"> · {r.periodLabel}</span>
                </h3>
                {onTime === "Ya" ? (
                  <StatusChip label="Tepat waktu" tone="good" />
                ) : onTime === "Terlambat" ? (
                  <StatusChip label={r.receivedOn ? "Terlambat" : "Belum diterima, lewat jatuh tempo"} tone="critical" />
                ) : (
                  <StatusChip label="Belum diterima" tone="neutral" />
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
                <Fact label="Jatuh tempo">{date(r.dueOn, "belum diisi")}</Fact>
                <Fact label="Tgl diterima">{date(r.receivedOn, "belum diterima")}</Fact>
                <Fact label="Staf aktif / Sesuai">
                  {count(r.activeStaff)} / {count(r.compliantStaff)}
                </Fact>
                <Fact label="% Sesuai · target ≥ 90%">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {share === null ? <Dash reason="belum bisa dihitung" /> : formatCompliance(share)}
                    <YesNo value={monthlyTargetMet(r)} empty="belum bisa dihitung" />
                  </span>
                </Fact>
                <Fact label="Keluhan">
                  <span className={cx((r.complaints ?? 0) > 0 && "font-semibold text-critical")}>{count(r.complaints)}</span>
                </Fact>
                <Fact label="Direspons ≤ 1×24 jam?">
                  <YesNo value={r.responded} empty="belum diisi" />
                </Fact>
                <Fact label="Indeks kepuasan">
                  {r.satisfaction === null ? (
                    <Dash reason="belum diisi" />
                  ) : (
                    <span className={cx(satisfactionBelowTarget(r, r.satisfaction) && "font-semibold text-warning")}>
                      {formatSatisfaction(r.satisfaction)}
                    </span>
                  )}
                </Fact>
                {r.notes ? (
                  <Fact label="Catatan" wide>
                    <span className="whitespace-pre-line">{r.notes}</span>
                  </Fact>
                ) : null}
              </dl>
              <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
                {r.changed ? <p className="text-xs text-ink-muted">Diubah lewat {r.changed}</p> : null}
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => onEdit(r)}>
                    Perbarui
                  </Button>
                  <Button variant="ghost" onClick={() => onDelete(r)} aria-label={`Hapus laporan ${r.reportGroup} ${r.periodLabel}`}>
                    Hapus
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
