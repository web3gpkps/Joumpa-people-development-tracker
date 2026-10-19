"use client";

import { useState, useTransition, type FormEvent } from "react";
import { YA_BELUM_TIDAK } from "@/lib/pd-rules";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions } from "@/components/ui/Dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/Field";
import { saveMonthlyReport } from "./actions";
import { formFromRow, formToPatch, type MonthlyForm, type MonthlyFormErrors } from "./monthly-form";
import { fieldOfColumn } from "./monthly-input";
import type { MonthlyReportRow } from "./monthly-view";

type EditReportDialogProps = {
  accessKey: string;
  /** The report being edited; null closes the dialog. */
  row: MonthlyReportRow | null;
  onClose: () => void;
  onSaved: (row: MonthlyReportRow, savedAt: string) => void;
};

/** "Ubah laporan" on phones, where the grid gives way to cards: every input field in one form. */
export function EditReportDialog({ accessKey, row, onClose, onSaved }: EditReportDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={row !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      size="md"
      title={row ? `Ubah laporan ${row.reportGroup} ${row.periodLabel}` : "Ubah laporan"}
    >
      {row ? <EditForm key={row.key} accessKey={accessKey} row={row} onBusyChange={setBusy} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function EditForm({
  accessKey,
  row,
  onBusyChange,
  onClose,
  onSaved,
}: {
  accessKey: string;
  row: MonthlyReportRow;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onSaved: (row: MonthlyReportRow, savedAt: string) => void;
}) {
  const [form, setForm] = useState<MonthlyForm>(() => formFromRow(row));
  const [errors, setErrors] = useState<MonthlyFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (field: keyof MonthlyForm) => (event: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: event.target.value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = formToPatch(row, form);
    if (!result.ok) {
      setErrors(result.errors);
      setFormError(null);
      return;
    }
    setErrors({});
    if (Object.keys(result.patch).length === 0) return onClose();
    onBusyChange(true);
    startTransition(async () => {
      try {
        const saved = await saveMonthlyReport(accessKey, { reportGroup: row.reportGroup, period: row.period, patch: result.patch });
        if (saved.ok) {
          onSaved(row, saved.savedAt);
          onClose();
          return;
        }
        const field = fieldOfColumn(saved.error.field);
        if (field) setErrors({ [field]: saved.error.message });
        else setFormError(saved.error.message);
      } catch {
        setFormError("Server tidak menjawab. Periksa koneksi, lalu coba lagi.");
      } finally {
        onBusyChange(false);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink-muted">Pengiriman</legend>
        <Field label="Jatuh tempo laporan" error={errors.dueOn}>
          <Input type="date" value={form.dueOn} onChange={set("dueOn")} />
        </Field>
        <Field label="Tanggal diterima" error={errors.receivedOn}>
          <Input type="date" value={form.receivedOn} onChange={set("receivedOn")} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink-muted">Kepatuhan petugas</legend>
        <Field label="Total staf aktif" error={errors.activeStaff}>
          <NumberInput value={form.activeStaff} onChange={set("activeStaff")} />
        </Field>
        <Field label="Staf berstatus Sesuai" error={errors.compliantStaff}>
          <NumberInput value={form.compliantStaff} onChange={set("compliantStaff")} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink-muted">Keluhan dan kepuasan</legend>
        <Field label="Keluhan sikap / komunikasi" error={errors.complaints}>
          <NumberInput value={form.complaints} onChange={set("complaints")} />
        </Field>
        <Field label="Semua direspons ≤ 1×24 jam?" error={errors.responded}>
          <Select value={form.responded} onChange={set("responded")}>
            <option value="">Belum diisi</option>
            {YA_BELUM_TIDAK.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Indeks kepuasan JOUMPA" help="0 sampai 5, contoh 4,25" error={errors.satisfaction}>
          <NumberInput decimal value={form.satisfaction} onChange={set("satisfaction")} />
        </Field>
      </fieldset>

      <Field label="Catatan" error={errors.notes}>
        <Textarea value={form.notes} onChange={set("notes")} rows={3} />
      </Field>

      {formError ? (
        <p role="alert" className="text-sm font-semibold text-critical">
          {formError}
        </p>
      ) : null}

      <DialogActions>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Batal
        </Button>
        <Button type="submit" loading={pending} loadingText="Menyimpan…">
          Simpan laporan
        </Button>
      </DialogActions>
    </form>
  );
}
