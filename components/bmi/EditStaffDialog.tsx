"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { checkEditBmiStaff, type EditBmiStaffInput } from "./edit-staff";
import type { SaveOutcome } from "./EditCellDialog";
import { idOf, type BmiTrackerRow } from "./tracker-model";

/** Which person is being edited; `n` changes on every opening so the form starts from the stored values. */
export type StaffEditRequest = { n: number; code: string };

type EditStaffDialogProps = {
  request: StaffEditRequest | null;
  row: BmiTrackerRow | null;
  onClose: () => void;
  onSave: (input: EditBmiStaffInput) => Promise<SaveOutcome>;
};

/** "Ubah profil": correct the name, the NIPP and L/P of one person. */
export function EditStaffDialog({ request, row, onClose, onSave }: EditStaffDialogProps) {
  const open = request !== null && row !== null;
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      title="Ubah profil petugas"
      description={row ? [idOf(row), row.station].filter(Boolean).join(" · ") : undefined}
      size="md"
    >
      {request && row ? <EditStaffForm key={request.n} row={row} onBusy={setBusy} onClose={onClose} onSave={onSave} /> : null}
    </Dialog>
  );
}

function EditStaffForm({
  row,
  onBusy,
  onClose,
  onSave,
}: {
  row: BmiTrackerRow;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
  onSave: (input: EditBmiStaffInput) => Promise<SaveOutcome>;
}) {
  const [name, setName] = useState(row.name);
  const [employeeNo, setEmployeeNo] = useState(row.employeeNo ?? "");
  const [gender, setGender] = useState(row.gender === "L" || row.gender === "P" ? row.gender : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  // The dialog opens after this form mounts, so focus the first input once it is showing.
  useEffect(() => {
    const frame = requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("input")?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  function fail(found: Record<string, string>, text = "Periksa isian yang ditandai.") {
    setErrors(found);
    setMessage(text);
    requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const input: EditBmiStaffInput = {
      code: row.code,
      name,
      employeeNo,
      gender: gender === "L" || gender === "P" ? gender : null,
    };
    const problem = checkEditBmiStaff(input);
    if (problem) return fail({ [problem.field ?? "name"]: problem.message });

    const same =
      name.trim() === row.name &&
      employeeNo.trim() === (row.employeeNo ?? "") &&
      (input.gender ?? "") === (row.gender ?? "");
    if (same) return onClose();

    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setErrors({});
    setMessage("");
    try {
      const outcome = await onSave(input);
      if (outcome.ok) return onClose();
      setMessage(outcome.message);
    } catch {
      setMessage("Koneksi ke server terputus. Isian masih ada; simpan lagi.");
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-4">
      {message ? (
        <p role="alert" className="rounded-control bg-warning-tint p-3 text-sm text-warning">
          {message}
        </p>
      ) : null}
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
        <Field label="Nama petugas" required error={errors.name} help="Periksa ejaan nama.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="NIPP" error={errors.employee_no}>
            <Input value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} maxLength={50} autoComplete="off" />
          </Field>
          <Field label="L/P" error={errors.gender}>
            <Select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Belum diisi</option>
              <option value="L">L</option>
              <option value="P">P</option>
            </Select>
          </Field>
        </div>
      </fieldset>
      <DialogActions>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Batal
        </Button>
        <Button type="submit" loading={busy} loadingText="Menyimpan…">
          Simpan
        </Button>
      </DialogActions>
    </form>
  );
}
