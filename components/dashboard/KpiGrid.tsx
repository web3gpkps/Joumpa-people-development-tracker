import Link from "next/link";
import type { SheetLinks } from "@/lib/workspace/access";
import { cx } from "@/components/ui/cx";
import { Dash } from "./cells";
import type { KpiCard } from "./dashboard-view";

const valueTone = { good: "text-good", critical: "text-critical", warning: "text-warning" } as const;
const barTone = { good: "bg-good", critical: "bg-critical", warning: "bg-warning" } as const;

const card = "group relative flex min-w-0 flex-col rounded-panel border border-line bg-surface p-3 shadow-card sm:p-5";

/** Small chevron in the corner of a card that opens a page. Drawn, 1.75 stroke like the nav icons. */
function OpenMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="absolute top-3 right-3 size-4 text-ink-muted transition-colors duration-120 group-hover:text-brand sm:top-5 sm:right-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function Body({ kpi }: { kpi: KpiCard }) {
  return (
    <>
      <p className="pr-6 text-xs text-ink-muted">{kpi.label}</p>
      <p data-numeric className={cx("mt-1 text-[22px] leading-7 font-semibold sm:mt-2 sm:text-[28px] sm:leading-9", kpi.tone ? valueTone[kpi.tone] : "text-ink")}>
        {kpi.value ?? <Dash reason={kpi.emptyReason ?? "belum ada data"} />}
      </p>
      <p className="mt-1 text-xs text-ink-muted">{kpi.foot}</p>
      {kpi.progress !== undefined ? (
        <div aria-hidden="true" className="mt-auto pt-3">
          <div className="h-1 overflow-hidden rounded-full bg-neutral-tint">
            <div
              className={cx("h-full rounded-full", kpi.tone ? barTone[kpi.tone] : "bg-brand")}
              style={{ width: `${Math.max(0, Math.min(100, kpi.progress))}%` }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The KPI row (workbook Dashboard row 6): six cards, each opening the page that holds its rows.
 * Two up on phones, three on tablets and laptops, one row of six on wide screens.
 */
export function KpiGrid({ items, links }: { items: KpiCard[]; links: SheetLinks }) {
  return (
    <section aria-label="Ringkasan program" data-print="hide">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 2xl:grid-cols-6">
        {items.map((kpi) => (
          <li key={kpi.key} className="flex min-w-0">
            {kpi.sheet ? (
              <Link href={links[kpi.sheet]} className={cx(card, "w-full transition-colors duration-120 hover:border-line-strong")}>
                <Body kpi={kpi} />
                <OpenMark />
              </Link>
            ) : (
              <div className={cx(card, "w-full")}>
                <Body kpi={kpi} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Six empty cards while the workspace loads (static, MOTION 1). */
export function KpiGridSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 2xl:grid-cols-6">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={cx(card, "gap-3")}>
          <span className="h-2.5 w-20 rounded-status bg-neutral-tint" />
          <span className="h-7 w-16 rounded-status bg-line" />
          <span className="h-2.5 w-28 rounded-status bg-neutral-tint" />
        </div>
      ))}
    </div>
  );
}
