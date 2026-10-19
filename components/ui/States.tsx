import type { ReactNode } from "react";
import { cx } from "./cx";

/*
 * Empty / loading / error states (DESIGN.md States). Server-component friendly.
 *   <EmptyState title="Belum ada SDM di CGK" action={<AddStaffButton />}>Tambahkan SDM pertama.</EmptyState>
 *   <TableSkeleton label="Memuat daftar SDM" />
 *   <ErrorState title="Daftar SDM tidak bisa dimuat" cause="Koneksi terputus." action={<ReloadButton />} />
 */

type Layout = "block" | "inline";

// No horizontal padding: the container (Panel, table cell, page) already sets the gutter.
const shell: Record<Layout, string> = {
  block: "flex flex-col items-start gap-1 py-8",
  inline: "flex flex-col items-start gap-1 py-3",
};

type EmptyStateProps = {
  /** What is missing, specifically: "Belum ada tindak lanjut untuk SUB". */
  title: ReactNode;
  /** One sentence: why it is empty, or when it fills. */
  children?: ReactNode;
  /** The one action that fills it. */
  action?: ReactNode;
  layout?: Layout;
  className?: string;
};

export function EmptyState({ title, children, action, layout = "block", className }: EmptyStateProps) {
  return (
    <div className={cx(shell[layout], className)}>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children ? <div className="max-w-2xl text-sm text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

type LoadingStateProps = {
  /** What is loading, e.g. "Memuat nilai Minggu ke-3". An ellipsis is added. */
  label: string;
  layout?: Layout;
  className?: string;
};

/** Text only, no spinner (MOTION 1). Announced politely. Prefer TableSkeleton for pages. */
export function LoadingState({ label, layout = "block", className }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className={cx(shell[layout], className)}>
      <p className="text-sm text-ink-muted">{label}…</p>
    </div>
  );
}

type TableSkeletonProps = {
  /** Spoken while loading, e.g. "Memuat daftar SDM". */
  label: string;
  /** Number of placeholder rows. Default 8. */
  rows?: number;
  /** Number of placeholder columns. Default 5. */
  columns?: number;
  className?: string;
};

/**
 * Static skeleton rows for a loading table or page (no shimmer: MOTION 1). Matches the
 * DataTable frame: sunken 40px header, 40px rows divided by --line.
 */
export function TableSkeleton({ label, rows = 8, columns = 5, className }: TableSkeletonProps) {
  return (
    <div role="status" aria-live="polite" className={cx("overflow-hidden rounded-panel border border-line bg-surface", className)}>
      <span className="sr-only">{label}…</span>
      <div aria-hidden="true">
        <div className="flex h-10 items-center gap-4 bg-surface-sunken px-3">
          {Array.from({ length: columns }, (_, c) => (
            <span key={c} className={cx("h-2.5 rounded-status bg-line", c === 0 ? "w-24" : "flex-1")} />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex h-10 items-center gap-4 border-t border-line px-3">
            {Array.from({ length: columns }, (_, c) => (
              <span key={c} className={cx("h-2.5 rounded-status bg-neutral-tint", c === 0 ? "w-24" : "flex-1")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

type ErrorStateProps = {
  /** What failed, in plain words: "Nilai Minggu ke-3 tidak bisa dimuat". */
  title: ReactNode;
  /** The cause in plain words. Never raw database text or column names. */
  cause?: ReactNode;
  /** What to do next; usually a "Coba lagi" button. Defaults to one sentence. */
  action?: ReactNode;
  layout?: Layout;
  className?: string;
};

export function ErrorState({ title, cause, action, layout = "block", className }: ErrorStateProps) {
  return (
    <div role="alert" className={cx(shell[layout], className)}>
      <p className="text-sm font-semibold text-critical">{title}</p>
      {cause ? <p className="max-w-2xl text-sm text-ink">{cause}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        {action ?? "Muat ulang halaman. Jika masih gagal, hubungi pengelola aplikasi."}
      </div>
    </div>
  );
}
