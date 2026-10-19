import type { ReactNode } from "react";
import { cx } from "./cx";
import { TableSkeleton } from "./States";

type PageHeaderProps = {
  /** The page's h1 (20/600). One per page. */
  title: ReactNode;
  /**
   * At most one meta line (13, muted): counts and nouns, never a sentence of explanation.
   * e.g. "SUB · Minggu ke-2 · 4 dari 5 dinilai".
   */
  meta?: ReactNode;
  /** Small caps line above the title (programme or scope), e.g. "People Development JOUMPA". */
  eyebrow?: ReactNode;
  /** Page actions on the right (wrap below the title on phones). At most one primary. */
  actions?: ReactNode;
  /** Optional row under the title, e.g. a <Toolbar>. Prefer placing the Toolbar right after the header. */
  children?: ReactNode;
  className?: string;
};

/** Page title block (DESIGN.md PageHeader). No description. Server-component friendly. */
export function PageHeader({ title, eyebrow, meta, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cx("flex flex-col gap-4", className)}>
      <div className="hero flex flex-col gap-4 px-5 py-6 sm:min-h-32 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-8 sm:py-7">
        <div className="relative z-10 min-w-0">
          {eyebrow ? <p className="hero-eyebrow mb-2">{eyebrow}</p> : null}
          <h1 className="text-xl font-semibold text-white sm:text-[28px] sm:leading-9">{title}</h1>
          {meta ? <p className="mt-1.5 text-sm text-[#d2e9df]">{meta}</p> : null}
        </div>
        {actions ? (
          <div className="hero-actions relative z-10 flex shrink-0 flex-wrap gap-2 sm:justify-end" data-print="hide">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </header>
  );
}

/** Suspense fallback for a page: its title right away, then static skeleton rows. */
export function PageLoading({ title, label }: { title: ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} />
      <TableSkeleton label={label} />
    </div>
  );
}
