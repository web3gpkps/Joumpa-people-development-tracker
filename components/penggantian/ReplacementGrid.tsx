"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { DataGrid, type CellValue, type GridColumn, type SaveRowResult } from "@/components/grid/DataGrid";
import { StatusChip } from "@/components/ui/StatusChip";
import { formatTanggal, isValidIsoDate } from "@/lib/dates";
import { formatDecimal } from "@/lib/format";
import {
  REPLACEMENT_CATEGORIES,
  STATUSES,
  YA_BELUM_TIDAK,
  replacementFlag,
  replacementNotRegistered,
  replacementPassed,
} from "@/lib/pd-rules";
import { saveReplacement } from "./actions";
import {
  FIELD_MESSAGES,
  LONG_TEXT_MAX,
  POST_TEST_RULES,
  PRACTICE_RULES,
  TEXT_MAX,
  patchFromCells,
  type PatchKey,
  type ReplacementView,
} from "./model";
import {
  DeleteReplacementButton,
  EditReplacementButton,
  NotRegisteredNote,
  STRONG_REMINDER_NOTE,
  type ReplacementCtx,
} from "./ReplacementDialogs";

type ReplacementGridProps = {
  caption: string;
  rows: ReplacementView[];
  ctx: ReplacementCtx;
  summary: ReactNode;
  actions?: ReactNode;
};

const rowKey = (r: ReplacementView) => String(r.id);
const rowLabel = (r: ReplacementView) => `No ${r.no}, ${r.name}${r.reportGroup ? `, ${r.reportGroup}` : ""}`;
const options = (values: readonly string[]) => values.map((value) => ({ value }));

function chip(value: CellValue) {
  const label = typeof value === "string" ? value : null;
  return label ? <StatusChip label={label} /> : null;
}

const text = (value: CellValue) => (typeof value === "string" ? value : null);
const num = (value: CellValue) => (typeof value === "number" ? value : null);
const date = (value: CellValue) => (typeof value === "string" && isValidIsoDate(value) ? value : null);

/**
 * Penggantian SDM as the workbook's entry grid: every input inline, Lulus training? and Flag
 * computed read-only (and live while typing), "Hapus" per row. A row saves itself a moment after
 * the last edit, sending only the changed fields (pd_share_save_replacement changes only the keys
 * it gets). Phones get one card per row with an "Ubah" sheet. Client component.
 */
export function ReplacementGrid({ caption, rows, ctx, summary, actions }: ReplacementGridProps) {
  const { accessKey, staff, today } = ctx;

  const columns = useMemo<GridColumn<ReplacementView>[]>(() => {
    const byCode = new Map(staff.map((s) => [s.code, s] as const));
    return [
      { key: "no", header: "No", width: 52, editor: "readonly", frozen: true, align: "end" },
      {
        key: "staff_code",
        header: "Nama",
        label: "Nama (pilih dari Tracker Staf)",
        width: 220,
        frozen: true,
        editor: "select",
        options: staff.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` })),
        get: (r) => r.staffCode,
        validate: (value, r) => (value === null && r.staffCode ? FIELD_MESSAGES.staff_code : null),
        render: (value, r) => {
          const person = typeof value === "string" ? byCode.get(value) : undefined;
          return (
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate font-semibold text-ink">{person?.name ?? r.name}</span>
              {value ? <span className="tabular shrink-0 text-xs text-ink-muted">{String(value)}</span> : null}
            </span>
          );
        },
      },
      {
        key: "report_group",
        header: "Cabang",
        group: "Usulan",
        width: 100,
        editor: "readonly",
        derive: (r, value) => {
          const code = value("staff_code");
          return (typeof code === "string" ? byCode.get(code)?.reportGroup : null) ?? r.reportGroup;
        },
        render: (value) => (value ? <span className="station-code">{String(value)}</span> : null),
      },
      {
        key: "category",
        header: "Kategori",
        group: "Usulan",
        width: 140,
        editor: "select",
        options: options(REPLACEMENT_CATEGORIES),
      },
      { key: "basis", header: "Dasar usulan", group: "Usulan", width: 240, editor: "longtext", maxLength: LONG_TEXT_MAX },
      {
        key: "withdraw_due",
        header: "Batas tarik / keputusan",
        group: "Penarikan",
        width: 132,
        editor: "date",
        get: (r) => r.withdrawDue,
      },
      {
        key: "director_approval",
        header: "Persetujuan Direksi",
        group: "Penarikan",
        width: 120,
        editor: "select",
        options: options(YA_BELUM_TIDAK),
        get: (r) => r.directorApproval,
        render: chip,
      },
      {
        key: "withdrawn_on",
        header: "Tgl ditarik / keputusan",
        group: "Penarikan",
        width: 132,
        editor: "date",
        get: (r) => r.withdrawnOn,
      },
      {
        key: "withdraw_status",
        header: "Status penarikan",
        label: "Status penarikan. Selesai pada kategori Penggantian menandai SDM ini Diganti di Tracker Staf",
        group: "Penarikan",
        width: 136,
        editor: "select",
        options: options(STATUSES),
        get: (r) => r.withdrawStatus,
        render: chip,
      },
      {
        key: "replacement_name",
        header: "Nama pengganti",
        group: "Pengganti",
        width: 220,
        editor: "text",
        maxLength: TEXT_MAX,
        get: (r) => r.replacementName,
        render: (value) => {
          if (typeof value !== "string") return null;
          const missing = replacementNotRegistered({ replacementName: value }, staff);
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{value}</span>
              {missing ? (
                <span className="shrink-0 rounded-status bg-warning-tint px-1.5 text-xs font-semibold text-warning">
                  Belum terdaftar
                </span>
              ) : null}
            </span>
          );
        },
      },
      { key: "selected_on", header: "Tgl seleksi", group: "Pengganti", width: 116, editor: "date", get: (r) => r.selectedOn },
      {
        key: "post_test",
        header: "Post-test",
        label: "Post-test pengganti, 0 sampai 100, lulus 80",
        group: "Pengganti",
        width: 92,
        ...POST_TEST_RULES,
        get: (r) => r.postTest,
        render: (value) => (typeof value === "number" ? formatDecimal(value, 0, 2) : null),
      },
      {
        key: "practice",
        header: "Praktik",
        label: "Praktik pengganti, 1 sampai 5, lulus 4,00",
        group: "Pengganti",
        width: 84,
        ...PRACTICE_RULES,
        get: (r) => r.practice,
        render: (value) => (typeof value === "number" ? formatDecimal(value, 2) : null),
      },
      {
        key: "passed",
        header: "Lulus training?",
        group: "Pengganti",
        width: 120,
        editor: "readonly",
        derive: (_r, value) => replacementPassed({ postTest: num(value("post_test")), practice: num(value("practice")) }),
        render: chip,
      },
      {
        key: "training_due",
        header: "Batas lulus training",
        group: "Pengganti",
        width: 132,
        editor: "date",
        get: (r) => r.trainingDue,
      },
      {
        key: "started_on",
        header: "Tgl mulai bertugas",
        group: "Pengganti",
        width: 132,
        editor: "date",
        get: (r) => r.startedOn,
      },
      { key: "notes", header: "Catatan", width: 220, editor: "longtext", maxLength: LONG_TEXT_MAX },
      {
        key: "flag",
        header: "Flag",
        width: 164,
        editor: "readonly",
        derive: (_r, value) =>
          replacementFlag(
            {
              withdrawDue: date(value("withdraw_due")),
              withdrawStatus: text(value("withdraw_status")),
              trainingDue: date(value("training_due")),
              startedOn: date(value("started_on")),
            },
            today,
          ),
        render: chip,
      },
      {
        key: "changed",
        header: "Terakhir diubah",
        width: 232,
        editor: "readonly",
        render: (_value, r) => <span className="text-xs text-ink-muted">{r.changed}</span>,
      },
    ];
  }, [staff, today]);

  const rowActions = useMemo(
    () => ({
      header: "Aksi",
      width: 84,
      render: (row: ReplacementView) => <DeleteReplacementButton ctx={ctx} row={row} inGrid />,
    }),
    [ctx],
  );

  const onSaveRow = useCallback(
    async (_key: string, changes: Record<string, CellValue>, row: ReplacementView): Promise<SaveRowResult> => {
      const patch = patchFromCells(changes);
      if (Object.keys(patch).length === 0) return { ok: true };
      let result: Awaited<ReturnType<typeof saveReplacement>>;
      try {
        result = await saveReplacement(accessKey, row.id, patch);
      } catch {
        return { ok: false, message: "Koneksi terputus. Isian masih ada, simpan lagi." };
      }
      if (result.ok) return { ok: true };
      const field = result.error.code === "invalid_input" ? result.error.field : undefined;
      // Nama and Cabang come from the picked staff member, so their errors belong to the Nama cell.
      const column = field === "name" || field === "report_group" ? "staff_code" : field;
      const known = column && column in FIELD_MESSAGES;
      return {
        ok: false,
        message: result.error.message,
        fieldErrors: known ? { [column]: FIELD_MESSAGES[column as PatchKey] } : undefined,
      };
    },
    [accessKey],
  );

  return (
    <DataGrid
      caption={caption}
      rows={rows}
      columns={columns}
      rowKey={rowKey}
      rowLabel={rowLabel}
      onSaveRow={onSaveRow}
      summary={summary}
      actions={actions}
      rowActions={rowActions}
      phone={<ReplacementCards rows={rows} ctx={ctx} label={caption} />}
    />
  );
}

// ------------------------------------------------------------------ phone

function DateText({ value }: { value: string | null }) {
  return value && isValidIsoDate(value) ? <time dateTime={value}>{formatTanggal(value)}</time> : <span className="text-ink-muted">–</span>;
}

function Item({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** One card per row: who, where and the flag first; the deadlines and the replacement below. */
function ReplacementCards({ rows, ctx, label }: { rows: ReplacementView[]; ctx: ReplacementCtx; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-3">
      {rows.map((row) => {
        const flag = replacementFlag(row, ctx.today);
        const passed = replacementPassed(row);
        const missing = replacementNotRegistered(row, ctx.staff);
        return (
          <li key={row.id}>
            <article
              aria-labelledby={`pg-${row.id}`}
              className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4 shadow-card"
            >
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id={`pg-${row.id}`} className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
                    <span className="tabular mr-1.5 font-normal text-ink-muted">{row.no}.</span>
                    {row.name}
                  </h2>
                  <p className="text-xs text-ink-muted">
                    {[row.reportGroup && `Cabang ${row.reportGroup}`, row.category, row.staffCode].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <StatusChip label={flag} className="shrink-0" />
              </header>
              {row.basis ? <p className="line-clamp-3 text-sm text-ink">{row.basis}</p> : null}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Item label="Status penarikan">
                  <StatusChip label={row.withdrawStatus} emptyLabel="–" />
                </Item>
                <Item label="Persetujuan Direksi">
                  <StatusChip label={row.directorApproval} emptyLabel="–" />
                </Item>
                <Item label="Batas tarik / keputusan">
                  <DateText value={row.withdrawDue} />
                </Item>
                <Item label="Tgl ditarik / keputusan">
                  <DateText value={row.withdrawnOn} />
                </Item>
                <Item label="Nama pengganti" wide>
                  {row.replacementName ?? <span className="text-ink-muted">–</span>}
                </Item>
                <Item label="Lulus training?">
                  <StatusChip label={passed} emptyLabel="–" />
                </Item>
                <Item label="Mulai bertugas">
                  <DateText value={row.startedOn} />
                </Item>
              </dl>
              {missing ? <NotRegisteredNote href={ctx.trackerStafHref} /> : null}
              {row.category === "Strong reminder" ? <p className="text-xs text-ink-muted">{STRONG_REMINDER_NOTE}</p> : null}
              <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line pt-3">
                <p className="text-xs text-ink-muted">{row.changed}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <EditReplacementButton ctx={ctx} row={row} />
                  <DeleteReplacementButton ctx={ctx} row={row} />
                </div>
              </footer>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
