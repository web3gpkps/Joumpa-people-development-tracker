"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { applyHeldDeletes, runSyncNow, type SyncNowResult } from "@/app/admin/sinkronisasi/actions";

type SyncActionsProps = {
  /** Open "deletes held back" log rows, per table label: shows the apply button. */
  heldDeletes: { table: string; rows: number }[];
};

/** "Sinkronkan sekarang" and, when the guard held deletes back, "Terapkan penghapusan". */
export function SyncActions({ heldDeletes }: SyncActionsProps) {
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<"sync" | "deletes" | null>(null);
  const [result, setResult] = useState<SyncNowResult | null>(null);

  function start(kind: "sync" | "deletes") {
    setRunning(kind);
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await (kind === "sync" ? runSyncNow() : applyHeldDeletes()));
      } catch {
        setResult({ ok: false, message: "Server tidak menjawab. Coba lagi." });
      } finally {
        setRunning(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {heldDeletes.length ? (
        <div className="flex flex-col gap-2 rounded-control border border-line-strong bg-surface p-4 text-sm text-ink">
          <p>
            <strong>Penghapusan ditahan.</strong> Banyak baris hilang sekaligus dari satu sisi, jadi belum dihapus di sisi
            lain: {heldDeletes.map((h) => `${h.table} (${h.rows} baris)`).join(", ")}. Jika memang sengaja dihapus,
            terapkan sekarang. Jika tidak, pulihkan barisnya (Google Sheet: File → Histori versi).
          </p>
          <div>
            <Button variant="danger" loading={pending && running === "deletes"} loadingText="Menerapkan…" disabled={pending} onClick={() => start("deletes")}>
              Terapkan penghapusan
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" loading={pending && running === "sync"} loadingText="Menyinkronkan…" disabled={pending} onClick={() => start("sync")}>
          Sinkronkan sekarang
        </Button>
        {result ? (
          <p role="status" className={result.ok ? "text-sm text-ink" : "text-sm text-critical"}>
            {result.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
