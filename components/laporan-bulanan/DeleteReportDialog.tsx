"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { deleteMonthlyReport } from "./actions";
import type { MonthlyReportRow } from "./monthly-view";

type DeleteReportDialogProps = {
  accessKey: string;
  /** The report to delete; null closes the dialog. */
  row: MonthlyReportRow | null;
  onClose: () => void;
  onDeleted: (row: MonthlyReportRow) => void;
};

/** "Hapus laporan" with a confirmation that says what is lost. */
export function DeleteReportDialog({ accessKey, row, onClose, onDeleted }: DeleteReportDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setError(null);
    onClose();
  }

  function confirm() {
    if (!row) return;
    const target = row;
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteMonthlyReport(accessKey, target.reportGroup, target.period);
        if (result.ok) onDeleted(target);
        else setError(result.error.message);
      } catch {
        setError("Server tidak menjawab. Periksa koneksi, lalu coba lagi.");
      }
    });
  }

  return (
    <Dialog
      open={row !== null}
      onClose={close}
      dismissible={!pending}
      title={row ? `Hapus laporan ${row.reportGroup} ${row.periodLabel}?` : "Hapus laporan"}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Batal
          </Button>
          <Button variant="danger" onClick={confirm} loading={pending} loadingText="Menghapus…">
            Hapus laporan
          </Button>
        </>
      }
    >
      {row ? (
        <div className="flex flex-col gap-2">
          <p>
            Tanggal diterima, jumlah staf, keluhan, indeks kepuasan dan catatan laporan ini ikut terhapus. Penghapusan tidak
            bisa dibatalkan.
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
