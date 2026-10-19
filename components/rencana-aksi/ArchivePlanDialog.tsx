"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { archivePlan } from "./actions";
import type { PlanView } from "./plan-view";

type ArchivePlanDialogProps = {
  accessKey: string;
  /** The row to remove; null closes the dialog. */
  plan: PlanView | null;
  onClose: () => void;
  onArchived: (plan: PlanView) => void;
};

/** "Hapus rencana aksi?": says where the row disappears from and that the pengelola can restore it. */
export function ArchivePlanDialog({ accessKey, plan, onClose, onArchived }: ArchivePlanDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setError(null);
    onClose();
  }

  function confirm() {
    if (!plan) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await archivePlan(accessKey, plan.id);
        if (result.ok) onArchived(plan);
        else setError(result.message);
      } catch {
        setError("Server tidak menjawab. Periksa koneksi, lalu coba lagi.");
      }
    });
  }

  return (
    <Dialog
      open={plan !== null}
      onClose={close}
      dismissible={!pending}
      title={plan?.itemNo ? `Hapus rencana aksi ${plan.itemNo}?` : "Hapus rencana aksi ini?"}
      description={plan ? `${plan.reportGroup} · ${plan.area}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Batal
          </Button>
          <Button variant="danger" onClick={confirm} loading={pending} loadingText="Menghapus…">
            Hapus rencana aksi
          </Button>
        </>
      }
    >
      {plan ? (
        <div className="flex flex-col gap-3">
          <p className="line-clamp-4 rounded-control border border-line bg-surface-sunken p-3 text-ink [overflow-wrap:anywhere]">
            {plan.action}
          </p>
          <p>
            Rencana aksi ini hilang dari daftar dan dari Google Sheet. Status, progres, bukti, dan catatannya tetap
            tersimpan, dan pengelola aplikasi bisa memulihkannya.
          </p>
          {error ? (
            <p role="alert" className="font-semibold text-critical">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
