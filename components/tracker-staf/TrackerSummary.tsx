import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import type { TrackerSummary as Summary } from "./rows";

export type Tally = {
  label: string;
  count: number;
  /** The filtered view; the active one links back to "all". */
  href: string;
  active: boolean;
  /** Colours the count when it is an exception (> 0). */
  tone?: "critical" | "warning";
};

const toneText = { critical: "text-critical", warning: "text-warning" } as const;

/**
 * The summary over the Cabang / Stasiun in view: counts per Usulan and per Flag, each a link
 * that filters the table, and the re-assessment progress. Server component.
 */
export function TrackerSummary({
  summary,
  proposals,
  flags,
}: {
  summary: Summary;
  proposals: Tally[];
  flags: Tally[];
}) {
  const pct = summary.intensive > 0 ? Math.round((summary.intensiveReassessed / summary.intensive) * 100) : 0;
  return (
    <section aria-label="Ringkasan" data-print="hide" className="rounded-panel border border-line bg-surface shadow-card">
      <dl className="flex flex-col divide-y divide-line">
        <Row label="Usulan">
          {proposals.map((t) => (
            <TallyLink key={t.label} tally={t} />
          ))}
        </Row>
        <Row label="Flag">
          {flags.map((t) => (
            <TallyLink key={t.label} tally={t} />
          ))}
        </Row>
        <Row label="Penilaian ulang">
          <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
            <p className="text-sm text-ink">
              <span className="tabular text-base font-semibold">
                {summary.intensiveReassessed} dari {summary.intensive}
              </span>{" "}
              <span className="text-ink-muted">coaching intensif dinilai ulang</span>
              {summary.reassessed > 0 ? (
                <span className="text-ink-muted">
                  {" "}
                  · <span className="tabular font-semibold text-good">{summary.compliant}</span> Sesuai ·{" "}
                  <span className={cx("tabular font-semibold", summary.notCompliant > 0 ? "text-critical" : "text-ink")}>
                    {summary.notCompliant}
                  </span>{" "}
                  Tidak Sesuai
                </span>
              ) : null}
            </p>
            {summary.intensive > 0 ? (
              <div aria-hidden="true" className="h-1 w-full max-w-sm overflow-hidden rounded-full bg-neutral-tint">
                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
            ) : null}
          </div>
        </Row>
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <dt className="section-label shrink-0 sm:w-32">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap gap-2">{children}</dd>
    </div>
  );
}

function TallyLink({ tally }: { tally: Tally }) {
  const exception = tally.tone && tally.count > 0;
  return (
    <Link
      href={tally.href}
      scroll={false}
      aria-current={tally.active ? "true" : undefined}
      className={cx(
        "inline-flex min-h-11 items-center gap-2 rounded-control border px-3 text-sm transition-colors duration-120 lg:min-h-9",
        tally.active
          ? "border-brand bg-brand-tint text-ink"
          : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
      )}
    >
      <span>{tally.label}</span>
      <span className={cx("tabular font-semibold", exception ? toneText[tally.tone!] : "text-ink")}>{tally.count}</span>
      {tally.active ? <span className="sr-only">(dipilih; pilih lagi untuk semua)</span> : null}
    </Link>
  );
}
