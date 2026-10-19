"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { formatTanggal } from "@/lib/dates";
import { formatScore } from "@/lib/format";
import { reassessResult, staffFlag } from "@/lib/pd-rules";
import type { CellValue } from "@/lib/grid/values";
import { DataGrid, type GridColumn, type SaveRowResult } from "@/components/grid/DataGrid";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { StatusChip } from "@/components/ui/StatusChip";
import { FilterBar } from "@/components/ui/Toolbar";
import { saveTrackerStaff } from "./actions";
import { DeleteStaffDialog } from "./DeleteStaffDialog";
import { StaffDetailDialog } from "./StaffDetailDialog";
import { TrackerCards } from "./TrackerCards";
import {
  COLUMNS,
  FIELD_RULES,
  coachingItemsText,
  isPicKey,
  stationRules,
  type ColumnDef,
  type TrackerRow,
} from "./fields";
import { changesToPatch } from "./patch";
import { needsDecision } from "./rows";
import "./tracker-staf.css";

export type TrackerStafViewProps = {
  accessKey: string;
  caption: string;
  rows: TrackerRow[];
  today: string;
  stations: string[];
  /** Station code → Cabang, so a moved station shows its new Cabang before the refresh. */
  groupOf: Record<string, string>;
  penggantianHref: string;
  /** Server-rendered filter selects (Cabang, Stasiun, Usulan, Flag). */
  filters: ReactNode;
  emptyTitle: string;
  emptyHint: string;
  /** ?staf=SUB-03: that row becomes active (deep link). */
  focusCode: string | null;
};

const rowKey = (r: TrackerRow) => r.code;
const rowLabel = (r: TrackerRow) => `${r.code}, ${r.name}`;
const SEARCH = { placeholder: "Nama atau ID", text: (r: TrackerRow) => `${r.code} ${r.name} ${r.nipp ?? ""}` };

function num(value: CellValue): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: CellValue): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function chip(value: CellValue) {
  const label = str(value);
  return label ? <StatusChip label={label} /> : null;
}

/** Cream cell (filled in by PIC / CS Division): tracker-staf.css keys on [data-pic-input]. */
function pic(content: ReactNode) {
  return <span data-pic-input="">{content}</span>;
}

type Ctx = { stations: string[]; groupOf: Record<string, string>; today: string };

function gridColumn(def: ColumnDef, ctx: Ctx): GridColumn<TrackerRow> {
  const base = {
    key: def.key,
    header: def.header,
    label: def.label,
    group: def.group,
    width: def.width,
    frozen: def.frozen,
    get: def.prop ? (r: TrackerRow) => (r[def.prop!] ?? null) as CellValue : undefined,
  };
  const wrap = (render: (value: CellValue, row: TrackerRow) => ReactNode) =>
    isPicKey(def.key) ? (value: CellValue, row: TrackerRow) => pic(render(value, row)) : render;

  switch (def.key) {
    case "no":
      return { ...base, editor: "readonly", align: "end" };
    case "code":
      return { ...base, editor: "readonly", render: (v) => <span className="tabular font-semibold">{v}</span> };
    case "report_group":
      return {
        ...base,
        editor: "readonly",
        derive: (row, value) => ctx.groupOf[String(value("station") ?? "")] ?? row.reportGroup,
      };
    case "station":
      return { ...base, ...stationRules(ctx.stations), render: (v) => <span className="station-code">{v}</span> };
    case "result":
      return {
        ...base,
        editor: "readonly",
        derive: (_row, value) => reassessResult(num(value("reassess_practice"))),
        render: chip,
      };
    case "flag":
      return {
        ...base,
        editor: "readonly",
        derive: (_row, value) =>
          staffFlag(
            {
              mainDue: str(value("main_due")),
              mainStatus: str(value("main_status")),
              extraDue: str(value("extra_due")),
              extraStatus: str(value("extra_status")),
            },
            ctx.today,
          ),
        render: chip,
      };
    case "changed":
      return {
        ...base,
        editor: "readonly",
        get: (r) => r.changedLabel.replace(/^Diubah lewat /, ""),
      };
    default: {
      const rules = FIELD_RULES[def.key];
      let render: (value: CellValue, row: TrackerRow) => ReactNode;
      if (rules.editor === "select") render = chip;
      else if (rules.editor === "number") render = (v) => formatScore(num(v));
      else if (rules.editor === "date") render = (v) => (str(v) ? formatTanggal(String(v)) : "");
      else render = (v) => v;
      if (def.key === "initial_coaching") render = chip;
      if (def.key === "coaching_items") {
        render = (v) => <span title={coachingItemsText(str(v)) || undefined}>{v}</span>;
      }
      if (def.key === "final_decision") {
        render = (v, row) =>
          str(v) ? chip(v) : needsDecision(row) ? <span className="font-semibold text-warning">Isi: Diganti</span> : null;
      }
      return { ...base, ...rules, render: wrap(render) };
    }
  }
}

/**
 * Tracker Staf for KPS: the editable grid (cards on phones), the "keputusan akhir" reminder,
 * and the detail and delete dialogs. Cells save per row; "Detail" opens every field of one
 * person. Client component.
 */
export function TrackerStafView(props: TrackerStafViewProps) {
  const { accessKey, rows, today, stations, groupOf } = props;
  const [detail, setDetail] = useState<{ row: TrackerRow; key: number } | null>(null);
  const [deleting, setDeleting] = useState<TrackerRow | null>(null);
  const [message, setMessage] = useState("");

  const openDetail = useCallback((row: TrackerRow) => setDetail((d) => ({ row, key: (d?.key ?? 0) + 1 })), []);

  const columns = useMemo(
    () => COLUMNS.map((def) => gridColumn(def, { stations, groupOf, today })),
    [stations, groupOf, today],
  );

  const rowActions = useMemo(
    () => ({
      header: "Aksi",
      width: 148,
      render: (row: TrackerRow) => (
        <>
          <Button size="sm" variant="secondary" tabIndex={-1} onClick={() => openDetail(row)}>
            Detail<span className="sr-only"> {row.name}</span>
          </Button>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setDeleting(row)}
            className="inline-flex min-h-8 items-center rounded-control px-2 text-xs font-semibold text-critical transition-colors duration-120 hover:bg-critical-tint"
          >
            Hapus<span className="sr-only"> {row.name}</span>
          </button>
        </>
      ),
    }),
    [openDetail],
  );

  const onSaveRow = useCallback(
    async (_key: string, changes: Record<string, CellValue>, row: TrackerRow): Promise<SaveRowResult> => {
      const result = await saveTrackerStaff(accessKey, row.code, changesToPatch(changes));
      if (result.ok) return { ok: true };
      return {
        ok: false,
        message: result.error.message,
        fieldErrors: result.error.field ? { [result.error.field]: result.error.message } : undefined,
      };
    },
    [accessKey],
  );

  const pending = rows.filter(needsDecision);
  // The dialog follows the refreshed row after a save elsewhere (grid, another link).
  const detailRow = detail ? (rows.find((r) => r.code === detail.row.code) ?? detail.row) : null;

  const count = <span className="tabular">{rows.length} staf</span>;
  const legend = (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span aria-hidden="true" className="pic-swatch" />
      Diisi PIC / CS Division
    </span>
  );

  return (
    <div className="tracker-staf flex flex-col gap-4">
      <p role="status" aria-live="polite" className="text-sm font-semibold text-good empty:hidden">
        {message}
      </p>

      {pending.length > 0 ? (
        <DecisionReminder rows={pending} penggantianHref={props.penggantianHref} onOpen={openDetail} />
      ) : null}

      <DataGrid
        caption={props.caption}
        rows={rows}
        columns={columns}
        rowKey={rowKey}
        rowLabel={rowLabel}
        onSaveRow={onSaveRow}
        search={SEARCH}
        toolbar={props.filters}
        summary={
          <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
            {count}
            {legend}
          </span>
        }
        rowActions={rowActions}
        focusRowKey={props.focusCode}
        emptyState={
          <EmptyState title={props.emptyTitle} layout="inline">
            {props.emptyHint}
          </EmptyState>
        }
        phone={
          <div className="flex flex-col gap-4">
            <FilterBar label="Filter staf" end={count}>
              {props.filters}
            </FilterBar>
            <TrackerCards
              rows={rows}
              today={today}
              emptyTitle={props.emptyTitle}
              emptyHint={props.emptyHint}
              onOpen={openDetail}
            />
          </div>
        }
      />

      <StaffDetailDialog
        row={detailRow}
        formKey={detail ? `${detail.row.code}-${detail.key}` : "tutup"}
        onClose={() => setDetail(null)}
        accessKey={accessKey}
        stations={stations}
        groupOf={groupOf}
        today={today}
        penggantianHref={props.penggantianHref}
        onSaved={setMessage}
        onDelete={(row) => {
          setDetail(null);
          setDeleting(row);
        }}
      />
      <DeleteStaffDialog row={deleting} onClose={() => setDeleting(null)} accessKey={accessKey} onDeleted={setMessage} />
    </div>
  );
}

/**
 * "Praktik ulang < 4,00 → otomatis Tidak Sesuai → usulan ganti": the people re-assessed as
 * Tidak Sesuai who still have no Keputusan akhir, each opening their detail, plus the way to
 * Penggantian SDM.
 */
function DecisionReminder({
  rows,
  penggantianHref,
  onOpen,
}: {
  rows: TrackerRow[];
  penggantianHref: string;
  onOpen: (row: TrackerRow) => void;
}) {
  return (
    <section
      aria-labelledby="ts-decision-title"
      className="flex flex-col gap-3 rounded-panel border border-warning/30 bg-warning-tint px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id="ts-decision-title" className="text-sm font-semibold text-ink">
          {rows.length} staf Tidak Sesuai belum punya keputusan akhir
        </h2>
        <p className="text-sm text-ink">
          Praktik ulang di bawah 4,00 berarti usulan ganti. Isi Keputusan akhir <strong>Diganti</strong>, lalu tambahkan ke
          Penggantian SDM.
        </p>
        <ul className="flex flex-wrap gap-2">
          {rows.map((row) => (
            <li key={row.code}>
              <button
                type="button"
                onClick={() => onOpen(row)}
                className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-sm text-ink transition-colors duration-120 hover:border-ink lg:min-h-8"
              >
                <span className="tabular font-semibold">{row.code}</span>
                <span>{row.name}</span>
                <span className="tabular text-ink-muted">{formatScore(row.reassessPractice)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ButtonLink href={penggantianHref} className="shrink-0">
        Buka Penggantian SDM
      </ButtonLink>
    </section>
  );
}
