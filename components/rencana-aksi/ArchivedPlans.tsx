"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { shortDateTime } from "@/lib/workspace/view";
import { restorePlan } from "./actions";
import { percentLabel, type PlanView } from "./plan-view";

type ArchivedPlansProps = {
  accessKey: string;
  /** Archived rows in the Cabang filter, already sorted. */
  plans: PlanView[];
};

/**
 * Owner only: rows removed with "Hapus", behind a disclosure under the list, each with
 * "Pulihkan". A restored row goes back to the list and to the Google Sheet.
 */
export function ArchivedPlans({ accessKey, plans }: ArchivedPlansProps) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [, startTransition] = useTransition();

  function restore(plan: PlanView) {
    setBusyId(plan.id);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await restorePlan(accessKey, plan.id);
        setMessage(
          result.ok
            ? { text: `${plan.itemNo ? `Rencana aksi ${plan.itemNo}` : "Rencana aksi"} dipulihkan ke daftar.`, error: false }
            : { text: result.message, error: true },
        );
      } catch {
        setMessage({ text: "Server tidak menjawab. Periksa koneksi, lalu coba lagi.", error: true });
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <details className="group rounded-panel border border-line bg-surface shadow-card" data-print="hide">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-panel px-4 py-3 hover:bg-bg [&::-webkit-details-marker]:hidden">
        <span className="text-base font-semibold text-ink">
          Diarsipkan <span className="tabular font-normal text-ink-muted">({plans.length})</span>
        </span>
        <span className="text-sm font-semibold text-brand">
          <span className="group-open:hidden">Tampilkan</span>
          <span className="hidden group-open:inline">Sembunyikan</span>
        </span>
      </summary>
      <div className="border-t border-line">
        <p role="status" aria-live="polite" className="px-4 pt-3 text-sm font-semibold empty:hidden">
          {message ? <span className={message.error ? "text-critical" : "text-good"}>{message.text}</span> : null}
        </p>
        {plans.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">Tidak ada rencana aksi yang dihapus.</p>
        ) : (
          <ul className="divide-y divide-line">
            {plans.map((plan) => {
              const archived = shortDateTime(plan.archivedAt);
              return (
                <li key={plan.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <p className="text-xs text-ink-muted">
                      <span className="station-code text-ink">{plan.reportGroup}</span>
                      {plan.itemNo ? ` · No ${plan.itemNo}` : ""} · {plan.area}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-ink [overflow-wrap:anywhere]">{plan.action}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                      <StatusChip label={plan.status} />
                      <span className="tabular">{percentLabel(plan.progress)}</span>
                      {archived ? <span>· Dihapus {archived}</span> : null}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => restore(plan)}
                    loading={busyId === plan.id}
                    loadingText="Memulihkan…"
                    disabled={busyId !== null && busyId !== plan.id}
                  >
                    Pulihkan<span className="sr-only"> {plan.itemNo ?? plan.action}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
