"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { deleteTrackerStaff } from "./actions";
import type { TrackerRow } from "./fields";

type DeleteStaffDialogProps = {
  /** The person to delete; null keeps the dialog closed. */
  row: TrackerRow | null;
  onClose: () => void;
  accessKey: string;
  onDeleted: (message: string) => void;
};

/**
 * "Hapus staf" confirmation. Says what goes with the person, counted from the data on screen:
 * their BMI checks are deleted too; replacement rows stay, without the link. Client component.
 */
export function DeleteStaffDialog({ row, onClose, accessKey, onDeleted }: DeleteStaffDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<TrackerRow | null>(row);
  if (row && row !== shown) {
    setShown(row);
    setError(null);
  }
  const target = row ?? shown;

  async function confirm() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteTrackerStaff(accessKey, target.code);
      if (result.ok) {
        onDeleted(
          `${target.code} ${target.name} dihapus${target.bmiChecks > 0 ? `, bersama ${target.bmiChecks} cek BMI` : ""}.`,
        );
        onClose();
      } else {
        setError(result.error.message);
      }
    } catch {
      setError("Koneksi terputus. Staf belum dihapus; coba lagi.");
    }
    setBusy(false);
  }

  return (
    <Dialog
      open={row !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      title={target ? `Hapus ${target.code} ${target.name}?` : "Hapus staf?"}
      description="Tidak bisa dibatalkan."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="danger" onClick={() => void confirm()} loading={busy} loadingText="Menghapus…">
            Hapus staf
          </Button>
        </>
      }
    >
      {target ? (
        <div className="flex flex-col gap-2">
          <p>
            Semua isian Tracker Staf orang ini hilang, termasuk data Cek BMI-nya:{" "}
            <strong className="tabular">{target.bmiChecks > 0 ? `${target.bmiChecks} cek BMI` : "belum ada cek BMI"}</strong>
            {target.bmiChecks > 0 ? " ikut terhapus." : "."}
          </p>
          {target.replacements > 0 ? (
            <p>{target.replacements} data Penggantian SDM tetap ada, tanpa tautan ke staf ini.</p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-control bg-critical-tint px-3 py-2 font-semibold text-critical">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
