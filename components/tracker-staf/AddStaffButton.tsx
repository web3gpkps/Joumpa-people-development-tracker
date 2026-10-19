"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PROPOSALS } from "@/lib/pd-rules";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { saveTrackerStaff } from "./actions";
import type { PatchKey } from "./fields";
import { checkPatch } from "./patch";

type AddStaffButtonProps = {
  accessKey: string;
  stations: string[];
  groupOf: Record<string, string>;
  /** Preselected in the form: the station filter, when one is chosen. */
  defaultStation: string | null;
};

/** "Tambah staf": a new person (Stasiun, Nama, optional NIPP, L/P, Usulan); the ID is assigned. Client component. */
export function AddStaffButton(props: AddStaffButtonProps) {
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // A fragment: the hero banner restyles buttons that are its direct children.
  return (
    <>
      <Button
        onClick={() => {
          setOpenCount((n) => n + 1);
          setMessage("");
          setOpen(true);
        }}
      >
        Tambah staf
      </Button>
      <p role="status" aria-live="polite" className="self-center text-sm font-semibold text-white empty:hidden">
        {message}
      </p>
      <Dialog
        open={open}
        onClose={() => {
          if (!saving) setOpen(false);
        }}
        dismissible={!saving}
        size="md"
        title="Tambah staf"
        description="ID dibuat otomatis dari stasiun, misalnya BPN-06."
      >
        {open ? (
          <AddForm
            key={openCount}
            {...props}
            onSavingChange={setSaving}
            onClose={() => setOpen(false)}
            onSaved={(text) => {
              setMessage(text);
              setOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function AddForm({
  accessKey,
  stations,
  groupOf,
  defaultStation,
  onSavingChange,
  onClose,
  onSaved,
}: AddStaffButtonProps & { onSavingChange: (saving: boolean) => void; onClose: () => void; onSaved: (message: string) => void }) {
  const [station, setStation] = useState(defaultStation ?? "");
  const [name, setName] = useState("");
  const [nipp, setNipp] = useState("");
  const [gender, setGender] = useState("");
  const [proposal, setProposal] = useState("");
  const [errors, setErrors] = useState<Partial<Record<PatchKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  function busy(value: boolean) {
    setSaving(value);
    onSavingChange(value);
  }

  function showError(field: string | undefined, message: string) {
    if (field) setErrors({ [field]: message });
    setFormError(field ? "Periksa isian yang ditandai." : message);
    setFocusRequest((n) => n + 1);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setErrors({});
    setFormError(null);
    const input = { station, name, nipp, gender, proposal };
    const checked = checkPatch(
      Object.fromEntries(Object.entries(input).filter(([, v]) => v.trim() !== "")),
      { isNew: true },
    );
    if (!checked.ok) {
      showError(checked.field === "patch" ? undefined : checked.field, checked.message);
      return;
    }
    busy(true);
    try {
      const result = await saveTrackerStaff(accessKey, null, checked.patch);
      if (result.ok) {
        busy(false);
        onSaved(`${result.code} ${result.name || name.trim()} ditambahkan.`);
        return;
      }
      showError(result.error.field, result.error.message);
      setFormError(result.error.message);
    } catch {
      setFormError("Koneksi terputus. Isian masih ada; simpan lagi.");
    }
    busy(false);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {formError ? (
        <p role="alert" className="rounded-control bg-critical-tint px-3 py-2 text-sm font-semibold text-critical">
          {formError}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stasiun" required error={errors.station} help={groupOf[station] ? `Cabang ${groupOf[station]}` : undefined}>
          <Select value={station} onChange={(e) => setStation(e.target.value)}>
            <option value="">Pilih stasiun</option>
            {stations.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Usulan" error={errors.proposal}>
          <Select value={proposal} onChange={(e) => setProposal(e.target.value)}>
            <option value="">Belum diisi</option>
            {PROPOSALS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Nama" required error={errors.name}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="NIPP" error={errors.nipp}>
          <Input value={nipp} onChange={(e) => setNipp(e.target.value)} maxLength={50} autoComplete="off" inputMode="numeric" />
        </Field>
        <Field label="L/P" error={errors.gender}>
          <Select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Belum diisi</option>
            <option value="L">L (laki-laki)</option>
            <option value="P">P (perempuan)</option>
          </Select>
        </Field>
      </div>
      <DialogActions>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Batal
        </Button>
        <Button type="submit" loading={saving} loadingText="Menambahkan…">
          Tambah staf
        </Button>
      </DialogActions>
    </form>
  );
}
