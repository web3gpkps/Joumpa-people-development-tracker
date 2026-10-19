"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions } from "@/components/ui/Dialog";
import { Field, Input, NumberInput, Select, Textarea, parseDecimal } from "@/components/ui/Field";
import { formatDecimal } from "@/lib/format";
import { bmi, bmiCategory, type Settings } from "@/lib/rules";
import { checkAddBmiStaff, type AddBmiStaffInput, type AddBmiStaffResult } from "./add-staff";
import { NOTE_LABEL } from "./labels";
import { CategoryBadge } from "./badges";
import { planCheck, type CheckErrors } from "./entry";

type AddBmiStaffDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Called after the SDM (and the optional first check) are stored. */
  onSaved: () => void;
  addStaff: (input: AddBmiStaffInput) => Promise<AddBmiStaffResult>;
  settings: Settings;
  plannedDates: string[];
  /** "BMI Cek ke-3 (Periode 9-22 Nov 2026)" for every period. */
  labels: string[];
  today: string;
  /** The period shown on the page; the first check goes there unless changed. */
  defaultPeriod: number;
  /** Owner and KPS: the stations to choose from. null for a single-station access (link or account). */
  stations: string[] | null;
  /** The access's own station code, shown read-only when `stations` is null. */
  ownStation: string;
  /** Station preselected for an owner or KPS access (the page's station filter), or "". */
  initialStation: string;
};

/** Tambah SDM: a controlled dialog; the form remounts on every opening so it starts empty. */
export function AddBmiStaffDialog({ open, onClose, ...rest }: AddBmiStaffDialogProps) {
  const [opening, setOpening] = useState(0);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  // A new opening is a new form (adjusting state while rendering, not in an effect).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening((n) => n + 1);
  }
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      title="Tambah SDM"
      description="ID SDM dibuat otomatis setelah disimpan."
      size="md"
    >
      {open ? <AddBmiStaffForm key={opening} onBusy={setBusy} onClose={onClose} {...rest} /> : null}
    </Dialog>
  );
}

const PAIR_MESSAGE = "Isi tinggi dan berat badan bersama.";

function AddBmiStaffForm({
  onBusy,
  onClose,
  onSaved,
  addStaff,
  settings,
  labels,
  today,
  defaultPeriod,
  stations,
  ownStation,
  initialStation,
}: Omit<AddBmiStaffDialogProps, "open"> & { onBusy: (busy: boolean) => void }) {
  const [name, setName] = useState("");
  const [employeeNo, setEmployeeNo] = useState("");
  const [gender, setGender] = useState("");
  const [note, setNote] = useState("");
  const [station, setStation] = useState(initialStation);
  const checkChoices = labels.map((label, index) => ({ label, period: index + 1 }));
  const [period, setPeriod] = useState(String(defaultPeriod));
  const [date, setDate] = useState(today);
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  const heightValue = parseDecimal(height);
  const weightValue = parseDecimal(weight);
  const preview =
    heightValue !== null && weightValue !== null && heightValue >= 120 && heightValue <= 210 && weightValue >= 30 && weightValue <= 200
      ? bmi(heightValue, weightValue)
      : null;

  function fail(found: Record<string, string>) {
    setErrors(found);
    setMessage("Periksa isian yang ditandai.");
    requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || uncertain) return;

    // Every required field at once, in page order.
    const missing: Record<string, string> = {};
    if (stations && !station) missing.station = "Pilih stasiun untuk SDM ini.";
    if (!name.trim()) missing.name = "Nama wajib diisi.";
    if (gender !== "L" && gender !== "P") missing.gender = "Pilih L atau P.";
    if (Object.keys(missing).length > 0) {
      fail(missing);
      return;
    }

    // A first check needs both measurements; with neither typed there is no first check.
    let firstCheck: AddBmiStaffInput["firstCheck"] = null;
    if (height.trim() !== "" || weight.trim() !== "") {
      if (height.trim() === "" || weight.trim() === "") {
        fail(height.trim() === "" ? { height_cm: PAIR_MESSAGE } : { weight_kg: PAIR_MESSAGE });
        return;
      }
      const plan = planCheck({ date, height, weight });
      if (!plan.ok) {
        const e: CheckErrors = plan.errors;
        fail({
          ...(e.date ? { check_date: e.date } : {}),
          ...(e.height ? { height_cm: e.height } : {}),
          ...(e.weight ? { weight_kg: e.weight } : {}),
        });
        return;
      }
      firstCheck = { period: Number(period), ...plan.check };
    }

    const input: AddBmiStaffInput = {
      name,
      employeeNo,
      gender: gender as AddBmiStaffInput["gender"],
      bmiNote: note,
      station: stations ? station : null,
      firstCheck,
      savedCode,
    };
    const problem = checkAddBmiStaff(input, settings.bmiPeriods);
    if (problem) {
      fail({ [problem.field ?? "name"]: problem.message });
      return;
    }

    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setErrors({});
    setMessage("");
    try {
      const result = await addStaff(input);
      if (result.ok) {
        onSaved();
      } else {
        if (result.code) setSavedCode(result.code);
        setUncertain(Boolean(result.uncertain));
        if (result.error.field) setErrors({ [result.error.field]: result.error.message });
        setMessage(
          result.code
            ? `SDM tersimpan; data BMI belum lengkap. ${result.error.message}`
            : result.uncertain
              ? "Hasil simpan belum pasti. Tutup dan muat ulang untuk memeriksa daftar SDM."
              : result.error.message,
        );
      }
    } catch {
      setUncertain(true);
      setMessage("Hasil simpan belum pasti. Tutup dan muat ulang untuk memeriksa daftar SDM.");
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
      <fieldset disabled={busy || uncertain} className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ID SDM">
            <Input value={savedCode ?? "Otomatis"} readOnly />
          </Field>
          {stations ? (
            <Field label="Stasiun" required error={errors.station}>
              <Select value={station} onChange={(e) => setStation(e.target.value)} disabled={Boolean(savedCode)}>
                <option value="">Pilih stasiun</option>
                {stations.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Stasiun">
              <Input value={ownStation} readOnly />
            </Field>
          )}
        </div>
        <Field label="Nama petugas" required error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} readOnly={Boolean(savedCode)} maxLength={200} autoComplete="off" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="NIPP" error={errors.employee_no}>
            <Input value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} readOnly={Boolean(savedCode)} maxLength={50} autoComplete="off" />
          </Field>
          <Field label="L/P" required error={errors.gender}>
            <Select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Pilih L/P</option>
              <option value="L">L</option>
              <option value="P">P</option>
            </Select>
          </Field>
        </div>
        <Field label={NOTE_LABEL} error={errors.bmi_note}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>

        {checkChoices.length > 0 ? (
          <div className="flex flex-col gap-4 rounded-panel border border-line p-4">
            <Field label="Cek pertama (opsional)" error={errors.period} help="Kosongkan tinggi dan berat jika belum ada pemeriksaan.">
              <Select
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setDate(today);
                }}
              >
                {checkChoices.map((choice) => (
                  <option key={choice.period} value={choice.period}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Tanggal cek" error={errors.check_date}>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Tinggi (cm)" error={errors.height_cm}>
                <NumberInput decimal value={height} onChange={(e) => setHeight(e.target.value)} />
              </Field>
              <Field label="Berat (kg)" error={errors.weight_kg}>
                <NumberInput decimal value={weight} onChange={(e) => setWeight(e.target.value)} />
              </Field>
            </div>
            <p className="flex flex-wrap items-center gap-3 text-sm" aria-live="polite">
              <span>BMI {formatDecimal(preview, 1) || "–"}</span>
              <CategoryBadge category={bmiCategory(preview, settings)} />
            </p>
          </div>
        ) : null}
      </fieldset>
      <DialogActions>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Tutup
        </Button>
        <Button type="submit" loading={busy} disabled={uncertain} loadingText="Menyimpan…">
          {savedCode ? "Lengkapi data BMI" : "Simpan SDM"}
        </Button>
      </DialogActions>
    </form>
  );
}
