"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { formatTanggal, isValidIsoDate } from "@/lib/dates";
import { periodLabel } from "@/lib/pd-rules";
import { toQuery } from "@/lib/workspace/access";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { saveMonthlyReport } from "./actions";
import { MONTH_OPTIONS, defaultDueOn, monthValue, reportKey, type Filters } from "./monthly-view";

type AddReportButtonProps = {
  accessKey: string;
  /** Every Cabang, in station order. */
  groups: string[];
  /** Keys (reportGroup|period) that already have a report. */
  existing: string[];
  years: string[];
  /** Today (Asia/Jakarta): the month a new report starts on. */
  today: string;
  /** links.laporanBulanan, to show the new row when the filters would hide it. */
  listHref: string;
  filters: Filters;
};

/**
 * "Tambah laporan": pick a Cabang and a month; the due date fills in as the 5th of the next month
 * and can be changed. The row is created empty and filled in the table. The button sits in the
 * page banner, so the dialog is portalled to <body>: inside `.hero` its focus rings would be white.
 */
export function AddReportButton(props: AddReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // A fresh form every time the dialog opens; 0 until the first click (nothing portalled before).
  const [round, setRound] = useState(0);

  return (
    <>
      <Button
        onClick={() => {
          setRound((n) => n + 1);
          setOpen(true);
        }}
      >
        Tambah laporan
      </Button>
      {round > 0
        ? createPortal(
            <Dialog
              open={open}
              onClose={() => {
                if (!busy) setOpen(false);
              }}
              dismissible={!busy}
              title="Tambah laporan bulanan"
              description="Satu laporan per cabang per bulan. Isian lainnya diisi setelah laporan dibuat."
              size="sm"
            >
              {open ? <AddReportForm key={round} {...props} onBusyChange={setBusy} onDone={() => setOpen(false)} /> : null}
            </Dialog>,
            document.body,
          )
        : null}
    </>
  );
}

function AddReportForm({
  accessKey,
  groups,
  existing,
  years,
  today,
  listHref,
  filters,
  onBusyChange,
  onDone,
}: AddReportButtonProps & { onBusyChange: (busy: boolean) => void; onDone: () => void }) {
  const router = useRouter();
  const [group, setGroup] = useState("");
  const [month, setMonth] = useState(today.slice(5, 7));
  const [year, setYear] = useState(today.slice(0, 4));
  // The due date follows the month until someone types their own.
  const [ownDue, setOwnDue] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ group?: string; dueOn?: string; form?: string }>({});
  const [pending, startTransition] = useTransition();

  const period = `${year}-${month}-01`;
  const dueOn = ownDue ?? defaultDueOn(period);
  const duplicate = group !== "" && existing.includes(reportKey(group, period));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!group) return setErrors({ group: "Pilih cabang." });
    if (duplicate) return setErrors({ group: `Laporan ${group} ${periodLabel(period)} sudah ada. Ubah langsung di tabel.` });
    if (dueOn !== "" && !isValidIsoDate(dueOn)) return setErrors({ dueOn: "Jatuh tempo laporan harus tanggal yang valid." });
    setErrors({});
    onBusyChange(true);
    startTransition(async () => {
      try {
        const result = await saveMonthlyReport(accessKey, { reportGroup: group, period, patch: { dueOn: dueOn || null } });
        if (!result.ok) {
          setErrors(result.error.field === "due_on" ? { dueOn: result.error.message } : { form: result.error.message });
          return;
        }
        // Show the new row when the current filters would hide it.
        const hidden = (filters.group && filters.group !== group) || (filters.period && filters.period !== period);
        if (hidden) router.push(`${listHref}${toQuery({ cabang: group, periode: monthValue(period) })}`, { scroll: false });
        onDone();
      } catch {
        setErrors({ form: "Server tidak menjawab. Periksa koneksi, lalu coba lagi." });
      } finally {
        onBusyChange(false);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Cabang" required error={errors.group}>
        <Select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="" disabled>
            Pilih cabang
          </option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-1 text-sm font-semibold text-ink">Bulan laporan</legend>
        <Field label="Bulan" hideLabel>
          <Select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tahun" hideLabel>
          <Select value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>
      <Field
        label="Jatuh tempo laporan"
        help={isValidIsoDate(dueOn) ? `Biasanya tanggal 5 bulan berikutnya: ${formatTanggal(defaultDueOn(period))}.` : undefined}
        error={errors.dueOn}
      >
        <Input type="date" value={dueOn} onChange={(e) => setOwnDue(e.target.value)} />
      </Field>
      {duplicate && !errors.group ? (
        <p className="text-sm text-warning">
          {group} {periodLabel(period)} sudah punya laporan.
        </p>
      ) : null}
      {errors.form ? (
        <p role="alert" className="text-sm font-semibold text-critical">
          {errors.form}
        </p>
      ) : null}
      <DialogActions>
        <Button variant="secondary" onClick={onDone} disabled={pending}>
          Batal
        </Button>
        <Button type="submit" loading={pending} loadingText="Menambahkan…" disabled={duplicate}>
          Tambah laporan
        </Button>
      </DialogActions>
    </form>
  );
}
