import type { ReactNode } from "react";
import { formatJam } from "@/lib/dates";
import { cx } from "./cx";

export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at?: Date | string }
  | { status: "deleted"; at?: Date | string }
  | { status: "error"; message: string };

type SaveStatusProps = {
  state: SaveState;
  className?: string;
};

function progressText(state: SaveState): string {
  if (state.status === "saving") return "Menyimpan…";
  if (state.status === "saved") return state.at ? `Tersimpan · ${formatJam(state.at)}` : "Tersimpan";
  if (state.status === "deleted") return state.at ? `Dihapus · ${formatJam(state.at)}` : "Dihapus";
  return "";
}

/**
 * Inline save feedback for one field or row: "Menyimpan…", "Tersimpan · 14.05",
 * "Dihapus · 14.05", or "Gagal menyimpan: <reason>". Two live regions stay mounted
 * (polite for progress, assertive for errors) so every change is announced. Render it
 * once, before the first save, and pass a new `state`. No toasts.
 */
export function SaveStatus({ state, className }: SaveStatusProps) {
  const error = state.status === "error" ? `Gagal menyimpan: ${state.message}` : "";

  return (
    <span className={cx("inline-flex min-h-5 items-center text-xs", className)}>
      <span role="status" aria-live="polite" className={state.status === "saved" ? "text-good" : "text-ink-muted"}>
        {progressText(state)}
      </span>
      <span role="alert" aria-live="assertive" className="font-semibold text-critical">
        {error}
      </span>
    </span>
  );
}

type SaveSummaryProps = {
  /** Rows that failed to save. 0 means everything that was edited is stored. */
  failed: number;
  /** Rows still saving or waiting to save. */
  pending?: number;
  /** Time of the last successful save, for "Semua tersimpan · 14.05". */
  lastSavedAt?: Date | string | null;
  /** "Coba lagi" button (or similar) shown next to failures. */
  retry?: ReactNode;
  className?: string;
};

/**
 * Toolbar summary for a grid (DESIGN.md Save status): "Semua tersimpan · 14.05",
 * "Menyimpan 2 baris…", or "2 baris gagal disimpan" plus a retry action.
 */
export function SaveSummary({ failed, pending = 0, lastSavedAt, retry, className }: SaveSummaryProps) {
  let text = "";
  if (failed > 0) text = `${failed} baris gagal disimpan`;
  else if (pending > 0) text = `Menyimpan ${pending} baris…`;
  else if (lastSavedAt) text = `Semua tersimpan · ${formatJam(lastSavedAt)}`;
  return (
    <span className={cx("inline-flex items-center gap-2 text-xs", className)}>
      <span role="status" aria-live="polite" className={failed > 0 ? "font-semibold text-critical" : "text-ink-muted"}>
        {text}
      </span>
      {failed > 0 ? retry : null}
    </span>
  );
}
