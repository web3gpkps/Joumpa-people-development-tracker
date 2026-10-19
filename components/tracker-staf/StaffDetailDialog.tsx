"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { formatScore } from "@/lib/format";
import { COACHING_STATUSES, FINAL_DECISIONS, PROPOSALS, STATUSES, reassessResult, staffFlag } from "@/lib/pd-rules";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog, DialogActions } from "@/components/ui/Dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/Field";
import { StatusChip } from "@/components/ui/StatusChip";
import { saveTrackerStaff } from "./actions";
import { coachingItems, type PatchKey, type TrackerRow } from "./fields";
import { diffDraft, draftOf, parsePractice, type Draft } from "./patch";

type StaffDetailDialogProps = {
  /** The person shown; null keeps the dialog closed. */
  row: TrackerRow | null;
  /** Changes on every open so the form starts from the row's current values. */
  formKey: string;
  onClose: () => void;
  accessKey: string;
  stations: string[];
  groupOf: Record<string, string>;
  today: string;
  penggantianHref: string;
  onSaved: (message: string) => void;
  onDelete: (row: TrackerRow) => void;
};

/** "Coaching awal" values seen in the assessment (free text, these are suggestions). */
const INITIAL_COACHING = ["Siap Bertugas*", "Perlu Pembinaan", "Tidak Sesuai", "Tidak ikut", "Belum dinilai", "Tidak tercatat"];

/**
 * Every Tracker Staf field of one person: first what PIC / CS Division fills in (cream, as in the
 * grid), then the report data KPS keeps. Saves only the fields that changed. Client component.
 */
export function StaffDetailDialog(props: StaffDetailDialogProps) {
  const { row, onClose } = props;
  const [saving, setSaving] = useState(false);
  const [shown, setShown] = useState<TrackerRow | null>(row);
  // Keep the last row while the dialog closes, so the title does not blank out mid-close.
  if (row && row !== shown) setShown(row);
  const target = row ?? shown;

  return (
    <Dialog
      open={row !== null}
      onClose={() => {
        if (!saving) onClose();
      }}
      dismissible={!saving}
      size="md"
      title={target ? target.name : "Detail staf"}
      description={target ? `${target.code} · ${target.station}${target.reportGroup ? ` · ${target.reportGroup}` : ""} · ${target.changedLabel}` : undefined}
    >
      {row ? <DetailForm key={props.formKey} {...props} row={row} onSavingChange={setSaving} /> : null}
    </Dialog>
  );
}

type FormProps = StaffDetailDialogProps & { row: TrackerRow; onSavingChange: (saving: boolean) => void };

function DetailForm({
  row,
  accessKey,
  stations,
  groupOf,
  today,
  penggantianHref,
  onClose,
  onSaved,
  onDelete,
  onSavingChange,
}: FormProps) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(row));
  const [errors, setErrors] = useState<Partial<Record<PatchKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  const set = (key: PatchKey) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const practice = parsePractice(draft.reassess_practice ?? "");
  const result = reassessResult(Number.isNaN(practice) ? null : practice);
  const flag = staffFlag(
    {
      mainDue: draft.main_due || null,
      mainStatus: draft.main_status || null,
      extraDue: draft.extra_due || null,
      extraStatus: draft.extra_status || null,
    },
    today,
  );
  const missingDecision = result === "Tidak Sesuai → usulan ganti" && !draft.final_decision;
  const replace = draft.final_decision === "Diganti" && row.replacements === 0;
  const items = coachingItems(draft.coaching_items);

  function busy(value: boolean) {
    setSaving(value);
    onSavingChange(value);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const { patch, errors: found } = diffDraft(row, draft, stations);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      setFormError("Periksa isian yang ditandai.");
      setFocusRequest((n) => n + 1);
      return;
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    busy(true);
    try {
      const saved = await saveTrackerStaff(accessKey, row.code, patch);
      if (saved.ok) {
        busy(false);
        onSaved(`Data ${row.code} ${saved.name || row.name} tersimpan.`);
        onClose();
        return;
      }
      if (saved.error.field) {
        setErrors({ [saved.error.field]: saved.error.message });
        setFocusRequest((n) => n + 1);
      }
      setFormError(saved.error.message);
    } catch {
      setFormError("Koneksi terputus. Isian masih ada; simpan lagi.");
    }
    busy(false);
  }

  const text = (key: PatchKey) => draft[key] ?? "";
  const select = (key: PatchKey, values: readonly string[], empty = "Belum diisi") => (
    <Select value={text(key)} onChange={(e) => set(key)(e.target.value)}>
      <option value="">{empty}</option>
      {values.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </Select>
  );
  const date = (key: PatchKey) => <Input type="date" value={text(key)} onChange={(e) => set(key)(e.target.value)} />;
  const score = (key: PatchKey) => (
    <NumberInput decimal placeholder="4,17" value={text(key)} onChange={(e) => set(key)(e.target.value)} />
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {formError ? (
        <p role="alert" className="rounded-control bg-critical-tint px-3 py-2 text-sm font-semibold text-critical">
          {formError}
        </p>
      ) : null}

      <fieldset className="pic-section flex flex-col gap-4 rounded-panel p-4">
        <legend className="sr-only">Diisi PIC / CS Division</legend>
        <p aria-hidden="true" className="text-sm font-semibold text-ink">
          Diisi PIC / CS Division
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status tindakan utama" error={errors.main_status}>
            {select("main_status", STATUSES)}
          </Field>
          <Field label="Status tindakan tambahan" error={errors.extra_status}>
            {select("extra_status", STATUSES)}
          </Field>
          <Field label="Tgl penilaian ulang" error={errors.reassessed_on}>
            {date("reassessed_on")}
          </Field>
          <Field label="Praktik ulang" help="1 sampai 5, contoh 4,17" error={errors.reassess_practice}>
            {score("reassess_practice")}
          </Field>
          <Field label="Coaching ulang" error={errors.recoaching}>
            {select("recoaching", COACHING_STATUSES)}
          </Field>
          <div className="flex flex-col gap-1" aria-live="polite">
            <span className="text-sm font-semibold text-ink">Hasil penilaian ulang</span>
            <span className="flex min-h-11 items-center lg:min-h-10">
              <StatusChip label={result} emptyLabel="Isi praktik ulang" />
            </span>
          </div>
        </div>

        {missingDecision ? (
          <Notice>
            <p>
              Praktik ulang {formatScore(practice)} di bawah 4,00: otomatis usulan ganti. Isi Keputusan akhir{" "}
              <strong>Diganti</strong> dan tambahkan ke Penggantian SDM.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => set("final_decision")("Diganti")}>
                Isi Diganti
              </Button>
              <ButtonLink size="sm" variant="ghost" href={penggantianHref}>
                Buka Penggantian SDM
              </ButtonLink>
            </div>
          </Notice>
        ) : null}

        <Field label="Keputusan akhir" error={errors.final_decision}>
          {select("final_decision", FINAL_DECISIONS)}
        </Field>
        {replace ? (
          <p className="text-sm text-ink">
            Belum ada di Penggantian SDM.{" "}
            <Link href={penggantianHref} className="font-semibold text-accent underline underline-offset-2">
              Tambahkan di Penggantian SDM
            </Link>
          </p>
        ) : null}
        <Field label="Catatan progres" error={errors.progress_notes}>
          <Textarea value={text("progress_notes")} onChange={(e) => set("progress_notes")(e.target.value)} maxLength={4000} rows={3} />
        </Field>
        <p className="text-xs text-ink-muted">
          Flag sekarang: <StatusChip label={flag} />
        </p>
      </fieldset>

      <Section title="Tindakan">
        <Field label="Tindakan utama" error={errors.main_action}>
          <Textarea value={text("main_action")} onChange={(e) => set("main_action")(e.target.value)} maxLength={4000} rows={2} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Batas waktu" error={errors.main_due}>
            {date("main_due")}
          </Field>
          <Field label="PIC" error={errors.pic}>
            <Input value={text("pic")} onChange={(e) => set("pic")(e.target.value)} maxLength={500} autoComplete="off" />
          </Field>
        </div>
        <Field label="Tindakan tambahan / pemantauan khusus" error={errors.extra_action}>
          <Textarea value={text("extra_action")} onChange={(e) => set("extra_action")(e.target.value)} maxLength={4000} rows={2} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Batas tambahan" error={errors.extra_due}>
            {date("extra_due")}
          </Field>
        </div>
      </Section>

      <Section title="Data laporan">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama" required error={errors.name} className="sm:col-span-2">
            <Input value={text("name")} onChange={(e) => set("name")(e.target.value)} maxLength={200} autoComplete="off" />
          </Field>
          <Field
            label="Stasiun"
            required
            error={errors.station}
            help={groupOf[text("station")] ? `Cabang ${groupOf[text("station")]}` : undefined}
          >
            <Select value={text("station")} onChange={(e) => set("station")(e.target.value)}>
              {stations.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Usulan" error={errors.proposal}>
            {select("proposal", PROPOSALS)}
          </Field>
          <Field label="NIPP" error={errors.nipp}>
            <Input value={text("nipp")} onChange={(e) => set("nipp")(e.target.value)} maxLength={50} autoComplete="off" inputMode="numeric" />
          </Field>
          <Field label="L/P" error={errors.gender}>
            <Select value={text("gender")} onChange={(e) => set("gender")(e.target.value)}>
              <option value="">Belum diisi</option>
              <option value="L">L (laki-laki)</option>
              <option value="P">P (perempuan)</option>
            </Select>
          </Field>
          <Field label="Coaching awal" error={errors.initial_coaching}>
            <Input
              value={text("initial_coaching")}
              onChange={(e) => set("initial_coaching")(e.target.value)}
              maxLength={100}
              autoComplete="off"
              list={`${id}-coaching`}
            />
          </Field>
          <Field label="Praktik awal" help="1 sampai 5" error={errors.initial_practice}>
            {score("initial_practice")}
          </Field>
          <Field label="Item coaching belum sesuai" help="Kode dipisah koma, contoh C01, C02" error={errors.coaching_items} className="sm:col-span-2">
            <Input
              value={text("coaching_items")}
              onChange={(e) => set("coaching_items")(e.target.value)}
              maxLength={500}
              autoComplete="off"
            />
          </Field>
        </div>
        {items.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm" aria-label="Arti item coaching">
            {items.map((item) => (
              <li key={item.code} className="flex gap-2">
                <span className="tabular w-10 shrink-0 font-semibold">{item.code}</span>
                <span className={item.meaning ? "text-ink" : "text-ink-muted"}>{item.meaning ?? "Kode dari form coaching assessment"}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <datalist id={`${id}-coaching`}>
          {INITIAL_COACHING.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </Section>

      <DialogActions>
        <Button variant="delete" disabled={saving} onClick={() => onDelete(row)} className="sm:mr-auto">
          Hapus staf
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Batal
        </Button>
        <Button type="submit" loading={saving} loadingText="Menyimpan…">
          Simpan perubahan
        </Button>
      </DialogActions>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-4 text-sm font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="note" className="flex flex-col gap-2 rounded-control border border-warning/30 bg-warning-tint px-3 py-3 text-sm text-ink">
      {children}
    </div>
  );
}
