import { Fragment } from "react";
import { formatTanggal, type IsoDate } from "@/lib/dates";
import { StatusChip } from "@/components/ui/StatusChip";
import { cx } from "@/components/ui/cx";
import { nextTimelineIndex, type TimelineRow } from "./dashboard-view";

const dot: Record<TimelineRow["state"], string> = {
  past: "border-line bg-line",
  today: "border-accent-bright bg-accent-bright ring-4 ring-brand-tint",
  soon: "border-warning bg-surface",
  later: "border-line-strong bg-surface",
};

function Remaining({ row }: { row: TimelineRow }) {
  if (row.state === "past") return <span className="text-xs text-ink-muted">Lewat</span>;
  if (row.state === "later") return <span className="text-xs text-ink-muted tabular-nums">{row.remaining}</span>;
  return <StatusChip label={row.remaining} tone="warning" />;
}

/**
 * "Linimasa kunci" as a rail: past dates go quiet, the next ones carry their Sisa hari, and a
 * "Hari ini" marker (the bright Gapura dot, DESIGN.md) sits where today falls between them.
 */
export function KeyTimeline({ rows, today }: { rows: TimelineRow[]; today: IsoDate }) {
  const next = nextTimelineIndex(rows);
  const markerAt = rows[next]?.state === "today" ? -1 : next;

  return (
    <div className="relative px-4 py-2">
      <span aria-hidden="true" className="absolute top-5 bottom-5 left-[23.5px] w-px bg-line" />
      <ol className="relative flex flex-col" aria-label="Linimasa kunci">
        {rows.map((row, i) => (
          <Fragment key={row.date}>
            {i === markerAt ? <NowMarker today={today} /> : null}
            <li className="relative flex gap-3 py-2.5">
              <span aria-hidden="true" className="flex h-5 w-4 shrink-0 items-center justify-center">
                <span className={cx("size-2.5 rounded-full border-2", dot[row.state])} />
              </span>
              <div className={cx("flex min-w-0 flex-1 flex-col gap-0.5", row.state === "past" && "text-ink-muted")}>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <time dateTime={row.date} className={cx("text-sm font-semibold", row.state === "past" ? "text-ink-muted" : "text-ink")}>
                    {row.dateLabel}
                  </time>
                  <Remaining row={row} />
                </span>
                <span className={cx("text-sm [text-wrap:pretty]", row.state === "past" ? "text-ink-muted" : "text-ink")}>
                  {row.agenda}
                </span>
              </div>
            </li>
          </Fragment>
        ))}
        {markerAt === rows.length ? <NowMarker today={today} /> : null}
      </ol>
    </div>
  );
}

function NowMarker({ today }: { today: IsoDate }) {
  return (
    <li className="relative flex items-center gap-3 py-1.5">
      <span aria-hidden="true" className="flex h-5 w-4 shrink-0 items-center justify-center">
        <span className="size-2.5 rounded-full bg-accent-bright ring-4 ring-brand-tint" />
      </span>
      <span className="text-xs font-semibold text-accent">
        Hari ini, <time dateTime={today}>{formatTanggal(today)}</time>
      </span>
    </li>
  );
}
