import type { ReactNode } from "react";
import { cx } from "./cx";

type PanelProps = {
  /** Section title (16/600, h2 by default). Optional: a panel holding only a table can rely on its caption. */
  title?: ReactNode;
  /** Buttons or links aligned with the title (right on desktop, below on phones). */
  actions?: ReactNode;
  /** Heading level for the title. Default 2. */
  headingLevel?: 2 | 3;
  /** "default" pads the body; "flush" lets a DataTable or list run edge to edge. */
  padding?: "default" | "flush";
  /** Sets aria-labelledby to the title automatically. */
  id?: string;
  className?: string;
  children: ReactNode;
};

/**
 * A white surface with a 1px --line border and 8px radius. No shadow, no description:
 * a panel is a title and its content. Server-component friendly.
 */
export function Panel({ title, actions, headingLevel = 2, padding = "default", id, className, children }: PanelProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingId = id ? `${id}-title` : undefined;
  const hasHeader = Boolean(title || actions);

  return (
    <section
      id={id}
      aria-labelledby={title && headingId ? headingId : undefined}
      className={cx("min-w-0 rounded-panel border border-line bg-surface shadow-card", className)}
    >
      {hasHeader ? (
        <div
          className={cx(
            "flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-center sm:justify-between",
            padding === "flush" && "pb-3",
          )}
        >
          {title ? (
            <Heading id={headingId} className="min-w-0 text-lg font-semibold text-ink">
              {title}
            </Heading>
          ) : (
            <span />
          )}
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div
        className={cx(
          padding === "default" && "px-4 pb-4",
          padding === "default" && (hasHeader ? "pt-3" : "pt-4"),
          padding === "flush" && "overflow-hidden rounded-b-panel",
          padding === "flush" && !hasHeader && "rounded-t-panel",
        )}
      >
        {children}
      </div>
    </section>
  );
}
