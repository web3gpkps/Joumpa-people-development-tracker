"use client";

import { useState } from "react";
import { Button, type ButtonVariant } from "@/components/ui/Button";
import { PlanFormDialog, type PlanFormContext } from "./PlanFormDialog";

type AddPlanButtonProps = PlanFormContext & {
  /** KPS: the Cabang of the current filter, preselected. */
  defaultGroup?: string | null;
  variant?: ButtonVariant;
  fullWidth?: boolean;
};

/** "Tambah rencana aksi" and its dialog. Every scope may add rows to its own Cabang. */
export function AddPlanButton({ defaultGroup, variant = "primary", fullWidth, ...ctx }: AddPlanButtonProps) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  return (
    <>
      <Button variant={variant} fullWidth={fullWidth} onClick={() => setOpen(true)}>
        Tambah rencana aksi
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {notice}
      </span>
      <PlanFormDialog
        {...ctx}
        plan={open ? "new" : null}
        defaultGroup={defaultGroup}
        onClose={() => setOpen(false)}
        onSaved={(_id, message) => {
          setNotice(message);
          setOpen(false);
        }}
      />
    </>
  );
}
