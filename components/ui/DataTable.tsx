import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

type DataTableProps = {
  /**
   * What the table shows. Rendered as the <caption> (screen readers only by default,
   * DESIGN.md DataTable) and used as the accessible name of the scroll region.
   */
  caption: string;
  /** Default true: the caption is sr-only (the Panel title says the same). Pass false to show it. */
  hideCaption?: boolean;
  /** Keep the first column (staff name, item code) visible while scrolling sideways. Default true. */
  stickyFirstColumn?: boolean;
  /**
   * Keep the header row visible while scrolling down inside the table. The table then
   * scrolls vertically inside its own box of `maxHeight`. Default true.
   */
  stickyHeader?: boolean;
  /** Max height of the scroll box when stickyHeader is on. Default "min(70dvh, 760px)". */
  maxHeight?: string;
  /** Minimum table width before it scrolls sideways, e.g. "960px" for the A to F score grid. */
  minWidth?: string;
  /** 40 px rows ("default") or 36 px / 13 px text ("dense"). */
  density?: "default" | "dense";
  /** <thead> and <tbody>, built with Th / Td / Tr. */
  children: ReactNode;
  className?: string;
};

/**
 * Table shell: its own scroll container (the page never scrolls sideways), sticky
 * header, sticky first column, keyboard-scrollable region with a visible focus ring.
 * Server-component friendly. Put it inside <Panel padding="flush"> for the usual frame.
 *
 *   <DataTable caption="Nilai praktik Minggu ke-3" minWidth="960px">
 *     <thead><tr><Th>Nama</Th><Th numeric>A</Th></tr></thead>
 *     <tbody>
 *       {rows.length === 0 ? <DataTableEmpty colSpan={2} title="Belum ada SDM" /> : rows.map(...)}
 *     </tbody>
 *   </DataTable>
 */
export function DataTable({
  caption,
  hideCaption = true,
  stickyFirstColumn = true,
  stickyHeader = true,
  maxHeight = "min(70dvh, 760px)",
  minWidth,
  density = "default",
  children,
  className,
}: DataTableProps) {
  const scrollStyle: CSSProperties | undefined = stickyHeader ? { maxHeight } : undefined;
  const tableStyle: CSSProperties | undefined = minWidth ? { minWidth } : undefined;

  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cx("dt-scroll", className)}
      style={scrollStyle}
    >
      <table
        className="dt"
        data-density={density}
        data-sticky-first={stickyFirstColumn ? "true" : "false"}
        data-sticky-header={stickyHeader ? "true" : "false"}
        style={tableStyle}
      >
        <caption
          className={cx(
            "px-3 py-2 text-left text-sm font-semibold text-ink caption-top",
            hideCaption && "sr-only",
          )}
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

type ThProps = ComponentProps<"th"> & {
  /** Right-aligned tabular digits (scores, BMI, counts, dates). */
  numeric?: boolean;
};

/** Header cell. Defaults to scope="col"; use scope="row" for the first cell of a body row. */
export function Th({ numeric, scope = "col", className, ...rest }: ThProps) {
  return <th scope={scope} data-numeric={numeric ? "" : undefined} className={className} {...rest} />;
}

type TdProps = ComponentProps<"td"> & {
  numeric?: boolean;
};

export function Td({ numeric, className, ...rest }: TdProps) {
  return <td data-numeric={numeric ? "" : undefined} className={className} {...rest} />;
}

type TrProps = ComponentProps<"tr"> & {
  /** Highlights the row with --brand-tint (e.g. the row being edited). */
  selected?: boolean;
};

export function Tr({ selected, ...rest }: TrProps) {
  return <tr data-selected={selected ? "true" : undefined} {...rest} />;
}

type DataTableEmptyProps = {
  /** Number of columns, so the message spans the full row. */
  colSpan: number;
  /** What is missing. */
  title: ReactNode;
  /** Why, and what fills it. */
  children?: ReactNode;
  action?: ReactNode;
};

/** The single row shown when a table has no rows. Says why and what to do next. */
export function DataTableEmpty({ colSpan, title, children, action }: DataTableEmptyProps) {
  return (
    <tr data-empty="">
      <td colSpan={colSpan} className="h-auto">
        <div className="sticky left-0 flex max-w-[calc(100vw-4rem)] flex-col items-start gap-1 py-6">
          <p className="text-sm font-semibold text-ink">{title}</p>
          {children ? <div className="text-sm text-ink-muted">{children}</div> : null}
          {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </td>
    </tr>
  );
}
