"use client";

import { useCallback, useMemo, useState, useTransition, type ReactNode } from "react";
import { DataGrid, type CellValue, type GridColumn, type SaveRowResult } from "@/components/grid/DataGrid";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { cx } from "@/components/ui/cx";
import { formatTanggal } from "@/lib/dates";
import { STATUSES, planFlag } from "@/lib/pd-rules";
import { ArchivePlanDialog } from "./ArchivePlanDialog";
import { PlanFormDialog, type PlanFormContext } from "./PlanFormDialog";
import { savePlan } from "./actions";
import { PLAN_FIELD_LABEL, PLAN_MAX_LENGTH, completionFill, isPlanField } from "./plan-input";
import { daysLeftLabel, dueLabel, percentLabel, type PlanView } from "./plan-view";

type PlanBoardProps = PlanFormContext & {
  /** Filtered and sorted rows. */
  plans: PlanView[];
  /** Accessible name of the list ("Rencana aksi, Cabang SUB"). */
  caption: string;
  /** Show the Cabang on phone cards (KPS / owner without a Cabang filter). */
  showGroup: boolean;
  /** Shown when the filters leave no rows (why + how to widen). */
  emptyState: ReactNode;
};

type Offer = { id: number; label: string; fill: { progress?: string; done_on?: string } };

const label = (plan: Pick<PlanView, "itemNo">) => (plan.itemNo ? `Rencana aksi ${plan.itemNo}` : "Rencana aksi");

/**
 * The Rencana Aksi list: an editable spreadsheet from 900 px (every column inline, "Detail"
 * for the long texts), one card per row on phones with "Perbarui" opening the full form.
 */
export function PlanBoard({ plans, caption, showGroup, emptyState, ...ctx }: PlanBoardProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [archiving, setArchiving] = useState<PlanView | null>(null);
  const [notice, setNotice] = useState("");
  const [offer, setOffer] = useState<Offer | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [offerPending, startOffer] = useTransition();
  const { accessKey, today, isKps, areas, groups } = ctx;

  const editing = editingId === null ? null : (plans.find((p) => p.id === editingId) ?? null);

  // ── grid ─────────────────────────────────────────────────────────────────────────────
  const columns = useMemo<GridColumn<PlanView>[]>(
    () => [
      { key: "item_no", header: "No", width: 56, frozen: true, editor: "text", maxLength: PLAN_MAX_LENGTH.item_no, get: (r) => r.itemNo },
      {
        key: "area",
        header: "Area",
        width: 128,
        frozen: true,
        editor: "select",
        required: true,
        options: areas.map((a) => ({ value: a })),
        get: (r) => r.area,
      },
      {
        key: "action",
        header: "Tindakan",
        width: 240,
        frozen: true,
        editor: "longtext",
        required: true,
        maxLength: PLAN_MAX_LENGTH.action,
        get: (r) => r.action,
      },
      {
        key: "report_group",
        header: "Cabang",
        width: 104,
        editor: isKps ? "select" : "readonly",
        required: true,
        options: groups.map((g) => ({ value: g })),
        get: (r) => r.reportGroup,
        render: (v) => <span className="station-code">{v}</span>,
      },
      {
        key: "target",
        header: "Sasaran / keterangan",
        label: PLAN_FIELD_LABEL.target,
        width: 200,
        editor: "longtext",
        maxLength: PLAN_MAX_LENGTH.target,
        get: (r) => r.target,
      },
      { key: "due_date", header: "Batas waktu", width: 116, editor: "date", get: (r) => r.dueDate },
      { key: "pic", header: "PIC", width: 140, editor: "text", maxLength: PLAN_MAX_LENGTH.pic, get: (r) => r.pic },
      {
        key: "status",
        header: "Status",
        width: 124,
        editor: "select",
        options: STATUSES.map((s) => ({ value: s })),
        get: (r) => r.status,
        render: (v) => <StatusChip label={v === null ? null : String(v)} />,
      },
      {
        key: "progress",
        header: "% Progres",
        label: "Persen progres",
        width: 88,
        editor: "number",
        min: 0,
        max: 100,
        decimals: 0,
        get: (r) => r.progress,
        render: (v) => (v === null ? "" : `${v}%`),
      },
      { key: "done_on", header: "Tgl selesai", label: "Tanggal selesai", width: 116, editor: "date", get: (r) => r.doneOn },
      {
        key: "evidence",
        header: "Bukti / dokumen",
        width: 180,
        editor: "longtext",
        maxLength: PLAN_MAX_LENGTH.evidence,
        get: (r) => r.evidence,
      },
      {
        key: "notes",
        header: "Kendala / catatan",
        width: 180,
        editor: "longtext",
        maxLength: PLAN_MAX_LENGTH.notes,
        get: (r) => r.notes,
      },
      {
        key: "flag",
        header: "Flag",
        width: 156,
        editor: "readonly",
        get: (r) => r.flag,
        // Follows the row as typed: a new status or due date moves the flag at once.
        derive: (_r, value) => {
          const due = value("due_date");
          const status = value("status");
          return planFlag({ dueDate: due === null ? null : String(due), status: status === null ? null : String(status) }, today);
        },
        render: (v) => <StatusChip label={v === null ? null : String(v)} />,
      },
      {
        key: "changed",
        header: "Terakhir diubah",
        width: 220,
        editor: "readonly",
        get: (r) => r.changedLabel.replace(/^Diubah lewat /, ""),
      },
    ],
    [areas, groups, isKps, today],
  );

  const onSaveRow = useCallback(
    async (_key: string, changes: Record<string, CellValue>, row: PlanView): Promise<SaveRowResult> => {
      const patch: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(changes)) if (isPlanField(k)) patch[k] = v;
      const result = await savePlan(accessKey, row.id, patch);
      if (!result.ok) return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
      if (changes.status === "Selesai") {
        const fill = completionFill(
          {
            progress: String(changes.progress ?? row.progress),
            done_on: String(changes.done_on ?? row.doneOn ?? ""),
          },
          today,
        );
        if (Object.keys(fill).length > 0) {
          setOfferError(null);
          setOffer({ id: row.id, label: label(row), fill });
        }
      }
      return { ok: true };
    },
    [accessKey, today],
  );

  function applyOffer(current: Offer) {
    setOfferError(null);
    startOffer(async () => {
      try {
        const patch: Record<string, string | number> = {};
        if (current.fill.progress) patch.progress = 100;
        if (current.fill.done_on) patch.done_on = current.fill.done_on;
        const result = await savePlan(accessKey, current.id, patch);
        if (result.ok) {
          setOffer(null);
          setNotice(`${current.label}: progres 100% dan tanggal selesai tersimpan.`);
        } else setOfferError(result.message);
      } catch {
        setOfferError("Server tidak menjawab. Periksa koneksi, lalu coba lagi.");
      }
    });
  }

  const rowActions = useMemo(
    () => ({
      header: "Aksi",
      width: 148,
      render: (plan: PlanView) => (
        <>
          <Button size="sm" variant="secondary" onClick={() => setEditingId(plan.id)}>
            Detail<span className="sr-only"> {label(plan)}</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setArchiving(plan)}>
            Hapus<span className="sr-only"> {label(plan)}</span>
          </Button>
        </>
      ),
    }),
    [],
  );

  const offerBar = offer ? (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-panel border border-line bg-good-tint px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-ink">
        <span className="font-semibold">{offer.label} ditandai Selesai.</span>{" "}
        {offer.fill.progress && offer.fill.done_on
          ? `Isi % progres 100 dan Tgl selesai hari ini (${formatTanggal(today)})?`
          : offer.fill.progress
            ? "Isi % progres 100?"
            : `Isi Tgl selesai hari ini (${formatTanggal(today)})?`}
        {offerError ? <span className="mt-1 block font-semibold text-critical">{offerError}</span> : null}
      </p>
      <span className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" loading={offerPending} loadingText="Menyimpan…" onClick={() => applyOffer(offer)}>
          {offer.fill.progress && offer.fill.done_on ? "Isi 100% dan hari ini" : offer.fill.progress ? "Isi 100%" : "Isi hari ini"}
        </Button>
        <Button size="sm" variant="ghost" disabled={offerPending} onClick={() => setOffer(null)}>
          Tidak usah
        </Button>
      </span>
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      <p role="status" aria-live="polite" className="text-sm font-semibold text-good empty:hidden">
        {notice}
      </p>
      {offerBar}
      <DataGrid
        caption={caption}
        rows={plans}
        columns={columns}
        rowKey={(r) => String(r.id)}
        rowLabel={(r) => `${r.itemNo ? `No ${r.itemNo}, ` : ""}${r.reportGroup}, ${r.action.slice(0, 60)}`}
        onSaveRow={onSaveRow}
        rowActions={rowActions}
        emptyState={emptyState}
        phone={
          <PlanCards
            plans={plans}
            caption={caption}
            showGroup={showGroup}
            emptyState={emptyState}
            onEdit={(plan) => setEditingId(plan.id)}
          />
        }
      />

      <PlanFormDialog
        {...ctx}
        plan={editing}
        onClose={() => setEditingId(null)}
        onSaved={(_id, message) => {
          setNotice(message);
          setEditingId(null);
        }}
        onArchive={(plan) => {
          setEditingId(null);
          setArchiving(plan);
        }}
      />
      <ArchivePlanDialog
        accessKey={accessKey}
        plan={archiving}
        onClose={() => setArchiving(null)}
        onArchived={(plan) => {
          setArchiving(null);
          setNotice(`${label(plan)} dihapus dari daftar.`);
        }}
      />
    </div>
  );
}

// ── phone ──────────────────────────────────────────────────────────────────────────────

function PlanCards({
  plans,
  caption,
  showGroup,
  emptyState,
  onEdit,
}: {
  plans: PlanView[];
  caption: string;
  showGroup: boolean;
  emptyState: ReactNode;
  onEdit: (plan: PlanView) => void;
}) {
  if (plans.length === 0) {
    return <div className="rounded-panel border border-line bg-surface px-4 shadow-card">{emptyState}</div>;
  }
  return (
    <ul aria-label={caption} className="grid gap-3 sm:grid-cols-2">
      {plans.map((plan) => (
        <li key={plan.id}>
          <PlanCard plan={plan} showGroup={showGroup} onEdit={onEdit} />
        </li>
      ))}
    </ul>
  );
}

function PlanCard({ plan, showGroup, onEdit }: { plan: PlanView; showGroup: boolean; onEdit: (plan: PlanView) => void }) {
  const due = dueLabel(plan.dueDate);
  const left = daysLeftLabel(plan.daysLeft);
  const late = plan.flag === "Terlambat";
  return (
    <article className="flex h-full flex-col gap-3 rounded-panel border border-line bg-surface p-4 shadow-card">
      <header className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-xs text-ink-muted">
          {plan.itemNo ? <span className="station-code text-ink">No {plan.itemNo}</span> : null}
          {plan.itemNo ? " · " : ""}
          {plan.area}
          {showGroup ? (
            <>
              {" · "}
              <span className="station-code text-ink">{plan.reportGroup}</span>
            </>
          ) : null}
        </p>
        <StatusChip label={plan.flag} className="shrink-0" />
      </header>

      <h2 className="text-base font-semibold text-ink [overflow-wrap:anywhere]">{plan.action}</h2>
      {plan.target ? <p className="-mt-1 line-clamp-3 text-sm text-ink-muted [overflow-wrap:anywhere]">{plan.target}</p> : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-sm">
          <StatusChip label={plan.status} />
          <span className="tabular font-semibold text-ink">{percentLabel(plan.progress)}</span>
        </div>
        <div
          role="progressbar"
          aria-label="% Progres"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={plan.progress}
          className="h-1.5 overflow-hidden rounded-full bg-neutral-tint"
        >
          <div
            className={cx("h-full rounded-full", plan.flag === "Selesai" ? "bg-good" : late ? "bg-critical" : "bg-brand")}
            style={{ width: `${Math.max(0, Math.min(100, plan.progress))}%` }}
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-ink-muted">Batas waktu</dt>
          <dd className="tabular text-ink">{due ?? <span className="text-ink-muted">–</span>}</dd>
          {left ? <dd className={cx("text-xs", late ? "font-semibold text-critical" : "text-ink-muted")}>{left}</dd> : null}
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-muted">PIC</dt>
          <dd className="text-ink [overflow-wrap:anywhere]">{plan.pic ?? <span className="text-ink-muted">–</span>}</dd>
        </div>
        {plan.doneOn ? (
          <div className="min-w-0">
            <dt className="text-xs text-ink-muted">Tgl selesai</dt>
            <dd className="tabular text-ink">{dueLabel(plan.doneOn)}</dd>
          </div>
        ) : null}
        {plan.notes ? (
          <div className="col-span-2 min-w-0">
            <dt className="text-xs text-ink-muted">Kendala / catatan</dt>
            <dd className="line-clamp-2 text-ink [overflow-wrap:anywhere]">{plan.notes}</dd>
          </div>
        ) : null}
      </dl>

      <footer className="mt-auto flex flex-col gap-2 border-t border-line pt-3">
        <p className="text-xs text-ink-muted">{plan.changedLabel}</p>
        <Button variant="secondary" fullWidth onClick={() => onEdit(plan)}>
          Perbarui<span className="sr-only"> {label(plan)}</span>
        </Button>
      </footer>
    </article>
  );
}
