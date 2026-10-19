"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { bmiCheckName } from "@/lib/bmi-periods";
import { formatTanggal } from "@/lib/dates";
import { formatDecimal, formatSignedKg } from "@/lib/format";
import type { BmiCategory } from "@/lib/rules";
import { CategoryBadge, Dash, HeightBadge, ScheduleBadge } from "./badges";
import { BmiTextCell } from "./BmiTextCell";
import { BMI_SHEET_TAB, NOTE_LABEL, sheetColumnCount, sheetColumnRange } from "./labels";
import {
  initialWindow,
  isWindowed,
  needsShift,
  periodsInView,
  segmentsFor,
  windowFor,
  type PeriodRange,
  type PeriodSegment,
} from "./period-window";
import { GEOMETRY, IDENTITY, PERIOD_FIELDS, SUMMARY, W, textWidth } from "./table-columns";
import { idOf, type BmiRowView, type EditTarget } from "./tracker-model";

/** Bit of the per-row "expanded" mask. */
const FITNESS = 4;

type RowProps = {
  view: BmiRowView;
  /** 1-based position in the list in view. */
  index: number;
  /** The period groups to draw (0-based): runs of cells, and spacers for the runs left out. */
  segments: readonly PeriodSegment[];
  openMask: number;
  onEdit: (target: EditTarget) => void;
  onProfile: (code: string) => void;
  onToggle: (code: string, bit: number) => void;
};

function EditCell({
  className,
  text,
  hint,
  onActivate,
}: {
  className?: string;
  text: string;
  hint: string;
  onActivate: () => void;
}) {
  return (
    <td className={`editable ${className ?? ""}`}>
      <button
        type="button"
        className="cell-btn"
        data-empty={text === "" || undefined}
        onClick={(event) => {
          // Safari and Firefox on a Mac do not focus a clicked button; the dialog returns focus here.
          event.currentTarget.focus();
          onActivate();
        }}
      >
        {text}
        <span className="sr-only">{text === "" ? `Kosong. ${hint}` : `. ${hint}`}</span>
      </button>
    </td>
  );
}

const number = (value: number | null | undefined) => (value == null ? "" : formatDecimal(value, 0, 1));

type PeriodCellsProps = {
  code: string;
  name: string;
  /** 1-based period. */
  p: number;
  date: string | null;
  height: number | null;
  weight: number | null;
  bmi: number | null;
  category: BmiCategory | null;
  onEdit: (target: EditTarget) => void;
};

/**
 * The five cells of one person in one period. Every prop is a plain value, so a save in one period
 * redraws that period's cells only: with 52 periods a row is 260 cells, and the other 255 are skipped.
 */
const PeriodCells = memo(function PeriodCells({ code, name, p, date, height, weight, bmi, category, onEdit }: PeriodCellsProps) {
  const check = bmiCheckName(p);
  return (
    <>
      <EditCell
        text={date ? formatTanggal(date) : ""}
        hint={`Ubah Tanggal Cek, ${check}, ${name}`}
        onActivate={() => onEdit({ kind: "check", code, period: p, field: "date" })}
      />
      <EditCell
        className="numeric"
        text={number(height)}
        hint={`Ubah Tinggi Badan (cm), ${check}, ${name}`}
        onActivate={() => onEdit({ kind: "check", code, period: p, field: "height" })}
      />
      <EditCell
        className="numeric"
        text={number(weight)}
        hint={`Ubah Berat Badan (kg), ${check}, ${name}`}
        onActivate={() => onEdit({ kind: "check", code, period: p, field: "weight" })}
      />
      <td className="computed numeric">{bmi != null ? formatDecimal(bmi, 1) : <Dash />}</td>
      <td className="computed">
        <CategoryBadge category={category} />
      </td>
    </>
  );
});

const BmiRow = memo(function BmiRow({ view, index, segments, openMask, onEdit, onProfile, onToggle }: RowProps) {
  const { row, summary } = view;
  const { code, name } = row;
  return (
    <tr>
      <td className="sticky sticky1 numeric">{index}</td>
      <th scope="row" className="sticky sticky2 id">
        {idOf(row) || "–"}
      </th>
      <td className="sticky sticky3 name">
        <button
          type="button"
          className="name-btn"
          onClick={(event) => {
            event.currentTarget.focus();
            onProfile(code);
          }}
        >
          {name}
          <span className="sr-only">, buka profil</span>
        </button>
      </td>
      <td className="center">{row.station ?? <Dash />}</td>
      <td className="center">{row.gender === "L" || row.gender === "P" ? row.gender : <Dash />}</td>
      {segments.map((segment) =>
        segment.kind === "gap" ? (
          <td key={`gap-${segment.first}`} className="period-gap" aria-hidden="true" />
        ) : (
          Array.from({ length: segment.last - segment.first + 1 }, (_, n) => {
            const i = segment.first + n;
            const check = row.checks[i] ?? null;
            const value = summary.periods[i] ?? null;
            return (
              <PeriodCells
                key={i}
                code={code}
                name={name}
                p={i + 1}
                date={check?.date ?? null}
                height={check?.heightCm ?? null}
                weight={check?.weightKg ?? null}
                bmi={value?.bmi ?? null}
                category={value?.category ?? null}
                onEdit={onEdit}
              />
            );
          })
        ),
      )}
      <td className="computed numeric summary-tint">{summary.latestHeight != null ? number(summary.latestHeight) : <Dash />}</td>
      <td className="computed numeric">{summary.latestWeight != null ? number(summary.latestWeight) : <Dash />}</td>
      <td className="computed numeric">{summary.weightDelta != null ? formatSignedKg(summary.weightDelta) : <Dash />}</td>
      <td className="computed numeric">{summary.latestBmi != null ? formatDecimal(summary.latestBmi, 1) : <Dash />}</td>
      <td className="computed">
        <CategoryBadge category={summary.latestCategory} />
      </td>
      <td className="computed">
        <HeightBadge value={summary.heightRequirement} />
      </td>
      <td className="computed">{formatTanggal(summary.nextCheck)}</td>
      <td className="computed">
        <ScheduleBadge status={summary.scheduleStatus} />
      </td>
      <BmiTextCell
        className="comment"
        text={row.fitnessNote}
        textWidth={textWidth(W.comment)}
        column={NOTE_LABEL}
        person={name}
        expanded={(openMask & FITNESS) !== 0}
        onToggle={() => onToggle(code, FITNESS)}
        edit={{ onEdit: () => onEdit({ kind: "fitnessNote", code }) }}
      />
    </tr>
  );
});

type BmiTableProps = {
  caption: string;
  /** Only the rows to draw (the page of the list in view). */
  views: readonly BmiRowView[];
  /** "BMI Cek ke-3 (Periode 9-22 Nov 2026)" for every period: the group headers. */
  labels: readonly string[];
  /** The chosen period, 1-based: its header is highlighted. */
  period: number;
  /** All periods side by side, or only the chosen one. */
  viewAll: boolean;
  /** Header of the first identity column: "ID SDM", or "No Pegawai" in a branch account's view. */
  idLabel: string;
  onEdit: (target: EditTarget) => void;
  onProfile: (code: string) => void;
  /** The scrolling container, so the screen can scroll it to a period. */
  scrollRef: RefObject<HTMLDivElement | null>;
};

/**
 * The spreadsheet of Cek BMI: two header rows, the first three columns frozen, a yellow cell
 * for every input, computed cells tinted. It scrolls inside its own container, never the page.
 */
export function BmiTable({ caption, views, labels, period, viewAll, idLabel, onEdit, onProfile, scrollRef }: BmiTableProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback((code: string, bit: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      const key = `${code}|${bit}`;
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const count = labels.length;
  // Many periods: draw the groups near the view and stand in for the rest (period-window.ts).
  const windowed = viewAll && isWindowed(count);
  const [drawn, setDrawn] = useState<PeriodRange>(() => initialWindow(period - 1, count));
  const segments = useMemo<PeriodSegment[]>(() => {
    if (!viewAll) return [{ kind: "cells", first: period - 1, last: period - 1 }];
    return segmentsFor(count, windowed ? drawn : null);
  }, [viewAll, period, count, windowed, drawn]);

  const measure = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const view = periodsInView(box.scrollLeft, box.clientWidth, count, GEOMETRY);
    setDrawn((prev) => (needsShift(prev, view, count) ? windowFor(view, count) : prev));
  }, [scrollRef, count]);

  const frame = useRef(0);
  const onScroll = () => {
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  };

  // Fit the window to the real width of the scroll area now and whenever it changes size.
  useEffect(() => {
    const box = scrollRef.current;
    if (!windowed || !box) return;
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [windowed, measure, scrollRef]);

  const drawnPeriods = segments.reduce((n, segment) => (segment.kind === "cells" ? n + segment.last - segment.first + 1 : n), 0);
  const shownColumns = IDENTITY.length + SUMMARY.length + PERIOD_FIELDS.length * drawnPeriods;
  const widths = useMemo(
    () => [
      ...IDENTITY.map((c) => c.width),
      ...segments.flatMap((segment) =>
        segment.kind === "gap"
          ? [(segment.last - segment.first + 1) * GEOMETRY.perPeriod]
          : Array.from({ length: segment.last - segment.first + 1 }).flatMap(() => PERIOD_FIELDS.map((c) => c.width)),
      ),
      ...SUMMARY.map((c) => c.width),
    ],
    [segments],
  );
  const total = useMemo(() => widths.reduce((sum, w) => sum + w, 0), [widths]);

  const maskOf = (code: string) => (open.has(`${code}|${FITNESS}`) ? FITNESS : 0);

  return (
    <div
      ref={scrollRef}
      className="bmi-scroll"
      tabIndex={0}
      role="region"
      aria-label={`${caption}. Tabel dapat digeser ke kanan dan kiri.`}
      onScroll={windowed ? onScroll : undefined}
    >
      <table className="bmi-table" style={{ width: total }} aria-colcount={shownColumns}>
        <caption className="sr-only">
          {caption}. Struktur mengikuti tab {BMI_SHEET_TAB}, {sheetColumnCount(count)} kolom ({sheetColumnRange(count)}).
        </caption>
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: w, minWidth: w }} />
          ))}
        </colgroup>
        <thead>
          <tr className="group">
            {IDENTITY.map((c) => (
              <th key={c.label} scope="col" rowSpan={2} className={c.className}>
                {c.label === "ID SDM" ? idLabel : c.label}
              </th>
            ))}
            {segments.map((segment) =>
              segment.kind === "gap" ? (
                <th key={`gap-${segment.first}`} rowSpan={2} className="period-head period-gap" aria-hidden="true" />
              ) : (
                Array.from({ length: segment.last - segment.first + 1 }, (_, n) => {
                  const i = segment.first + n;
                  return (
                    <th
                      key={i}
                      scope="colgroup"
                      colSpan={PERIOD_FIELDS.length}
                      className="period-head"
                      data-selected={i + 1 === period || undefined}
                    >
                      {labels[i]}
                    </th>
                  );
                })
              ),
            )}
            {SUMMARY.map((c) => (
              <th key={c.label} scope="col" rowSpan={2} className={`summary-head ${c.className ?? ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
          <tr className="fields">
            {segments.map((segment) =>
              segment.kind === "gap"
                ? null
                : Array.from({ length: segment.last - segment.first + 1 }, (_, n) => {
                    const i = segment.first + n;
                    return PERIOD_FIELDS.map((c) => (
                      <th key={`${i}-${c.label}`} scope="col" className="period-field" data-selected={i + 1 === period || undefined}>
                        {c.label}
                      </th>
                    ));
                  }),
            )}
          </tr>
        </thead>
        <tbody>
          {views.map((view, i) => (
            <BmiRow
              key={view.row.code}
              view={view}
              index={i + 1}
              segments={segments}
              openMask={maskOf(view.row.code)}
              onEdit={onEdit}
              onProfile={onProfile}
              onToggle={onToggle}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
