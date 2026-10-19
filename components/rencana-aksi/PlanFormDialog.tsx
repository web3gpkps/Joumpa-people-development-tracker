"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions } from "@/components/ui/Dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/Field";
import { SaveStatus, type SaveState } from "@/components/ui/SaveStatus";
import { StatusChip } from "@/components/ui/StatusChip";
import { formatTanggal } from "@/lib/dates";
import { STATUSES } from "@/lib/pd-rules";
import { savePlan } from "./actions";
import {
  PLAN_MAX_LENGTH,
  changedFields,
  cleanPatch,
  completionFill,
  formValues,
  newPlanInput,
  parseProgress,
  type PlanField,
  type PlanFieldErrors,
  type PlanFormValues,
} from "./plan-input";
import { daysLeftLabel, dueLabel, type PlanView } from "./plan-view";

export type PlanFormContext = {
  accessKey: string;
  /** Area names, in dropdown order. */
  areas: string[];
  /** Report groups this scope may pick (KPS / owner: every Cabang). */
  groups: string[];
  /** KPS and the owner pick the Cabang; a station scope adds to its own. */
  isKps: boolean;
  /** A station scope's own Cabang (shown read-only); null for KPS. */
  ownGroup: string | null;
  /** Today in Asia/Jakarta, 'YYYY-MM-DD'. */
  today: string;
};

type PlanFormDialogProps = PlanFormContext & {
  /** null closes the dialog; "new" adds a row; a plan edits it. */
  plan: PlanView | "new" | null;
  /** Cabang preselected for a new row (KPS, from the Cabang filter). */
  defaultGroup?: string | null;
  onClose: () => void;
  /** After a successful save: the row id and a short sentence for the page notice. */
  onSaved: (id: number, message: string) => void;
  /** Edit mode: "Hapus" (opens the archive confirmation). */
  onArchive?: (plan: PlanView) => void;
};

const SERVER_DOWN = "Server tidak menjawab. Periksa koneksi, lalu simpan lagi.";

function emptyValues(group: string): PlanFormValues {
  return {
    item_no: "",
    area: "",
    action: "",
    report_group: group,
    target: "",
    due_date: "",
    pic: "",
    status: "Belum Mulai",
    progress: "0",
    done_on: "",
    evidence: "",
    notes: "",
  };
}

/**
 * "Tambah rencana aksi" and "Ubah rencana aksi": one form, a full-screen sheet on phones. A new
 * row asks for the plan only (Area, Tindakan, Cabang for KPS, No, Sasaran, Batas waktu, PIC);
 * editing starts with the progress fields people update most, then the plan itself.
 */
export function PlanFormDialog({ plan, defaultGroup, onClose, onSaved, onArchive, ...ctx }: PlanFormDialogProps) {
  const [busy, setBusy] = useState(false);
  const isNew = plan === "new";
  const title = plan === null ? "Rencana aksi" : isNew ? "Tambah rencana aksi" : `Ubah rencana aksi${plan.itemNo ? ` ${plan.itemNo}` : ""}`;
  let description: string | undefined;
  if (plan && plan !== "new") description = `${plan.reportGroup} · ${plan.area}`;
  else if (isNew && ctx.ownGroup) description = `Cabang ${ctx.ownGroup}`;

  return (
    <Dialog
      open={plan !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      size="md"
      title={title}
      description={description}
    >
      {plan !== null ? (
        // Keyed by row: opening another row starts from that row's stored values.
        <PlanForm
          key={plan === "new" ? "new" : plan.id}
          plan={plan}
          initialGroup={ctx.ownGroup ?? defaultGroup ?? ""}
          onBusyChange={setBusy}
          onSaved={onSaved}
          onArchive={onArchive}
          onCancel={() => {
            if (!busy) onClose();
          }}
          {...ctx}
        />
      ) : null}
    </Dialog>
  );
}

type PlanFormProps = PlanFormContext & {
  plan: PlanView | "new";
  initialGroup: string;
  onBusyChange: (busy: boolean) => void;
  onSaved: (id: number, message: string) => void;
  onArchive?: (plan: PlanView) => void;
  onCancel: () => void;
};

function PlanForm({ plan, initialGroup, onBusyChange, onSaved, onArchive, onCancel, ...ctx }: PlanFormProps) {
  const isNew = plan === "new";
  const [initial] = useState<PlanFormValues>(() => (isNew ? emptyValues(initialGroup) : formValues(plan)));
  const [values, setValues] = useState<PlanFormValues>(initial);
  const [errors, setErrors] = useState<PlanFieldErrors>({});
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const set = (field: PlanField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const fill = values.status === "Selesai" ? completionFill(values, ctx.today) : {};
  const offerFill = Object.keys(fill).length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changed = isNew ? newPlanInput(values, ctx.isKps) : changedFields(initial, values);
    const needsGroup = isNew && ctx.isKps;
    const check = cleanPatch(changed, { insert: isNew, needsGroup });
    if (!check.ok) {
      setErrors(check.fieldErrors);
      setSave({ status: "error", message: "Periksa isian yang ditandai." });
      return;
    }
    if (!isNew && Object.keys(check.patch).length === 0) {
      setSave({ status: "saved" });
      return;
    }
    setErrors({});
    setSave({ status: "saving" });
    onBusyChange(true);
    startTransition(async () => {
      try {
        const result = await savePlan(ctx.accessKey, isNew ? null : plan.id, changed, { needsGroup });
        if (result.ok) {
          setSave({ status: "saved", at: result.savedAt });
          const name = values.item_no.trim() ? `Rencana aksi ${values.item_no.trim()}` : "Rencana aksi";
          onSaved(result.id, isNew ? `${name} ditambahkan.` : `${name} tersimpan.`);
        } else {
          setErrors(result.fieldErrors ?? {});
          setSave({ status: "error", message: result.message });
        }
      } catch {
        setSave({ status: "error", message: SERVER_DOWN });
      } finally {
        onBusyChange(false);
      }
    });
  }

  const progressValue = parseProgress(values.progress);
  const slider =
    progressValue !== null && Number.isFinite(progressValue) ? Math.min(100, Math.max(0, Math.round(progressValue))) : 0;

  const planFields = (
    <>
      <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
        <Field label="No" help="Contoh 1 atau 6a" error={errors.item_no}>
          <Input
            value={values.item_no}
            maxLength={PLAN_MAX_LENGTH.item_no}
            autoComplete="off"
            onChange={(e) => set("item_no")(e.target.value)}
          />
        </Field>
        <Field label="Area" required error={errors.area}>
          <Select value={values.area} onChange={(e) => set("area")(e.target.value)}>
            <option value="" disabled>
              Pilih area
            </option>
            {ctx.areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
            {values.area && !ctx.areas.includes(values.area) ? <option value={values.area}>{values.area}</option> : null}
          </Select>
        </Field>
      </div>
      <Field label="Tindakan" required error={errors.action}>
        <Textarea rows={3} value={values.action} onChange={(e) => set("action")(e.target.value)} />
      </Field>
      {ctx.isKps ? (
        <Field label="Cabang" required error={errors.report_group}>
          <Select value={values.report_group} onChange={(e) => set("report_group")(e.target.value)}>
            <option value="" disabled>
              Pilih cabang
            </option>
            {ctx.groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="Cabang" help="Rencana aksi cabang Anda sendiri">
          <Input value={values.report_group || ctx.ownGroup || ""} readOnly />
        </Field>
      )}
      <Field label="Sasaran / keterangan" error={errors.target}>
        <Textarea rows={2} value={values.target} onChange={(e) => set("target")(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Batas waktu" error={errors.due_date}>
          <Input type="date" value={values.due_date} onChange={(e) => set("due_date")(e.target.value)} />
        </Field>
        <Field label="PIC" error={errors.pic}>
          <Input
            value={values.pic}
            maxLength={PLAN_MAX_LENGTH.pic}
            autoComplete="off"
            onChange={(e) => set("pic")(e.target.value)}
          />
        </Field>
      </div>
    </>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {isNew ? (
        planFields
      ) : (
        <>
          <PlanSummary plan={plan} />
          <Section title="Progres">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status" error={errors.status}>
                <Select value={values.status} onChange={(e) => set("status")(e.target.value)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tgl selesai" error={errors.done_on}>
                <Input type="date" value={values.done_on} onChange={(e) => set("done_on")(e.target.value)} />
              </Field>
            </div>
            {offerFill ? (
              <div className="flex flex-col gap-2 rounded-control border border-line bg-good-tint px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-ink">
                  {fill.progress && fill.done_on
                    ? `Isi % progres 100 dan Tgl selesai hari ini (${formatTanggal(ctx.today)})?`
                    : fill.progress
                      ? "Isi % progres 100?"
                      : `Isi Tgl selesai hari ini (${formatTanggal(ctx.today)})?`}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setValues((current) => ({ ...current, ...fill }));
                    setErrors((current) => ({ ...current, progress: undefined, done_on: undefined }));
                  }}
                >
                  {fill.progress && fill.done_on ? "Isi 100% dan hari ini" : fill.progress ? "Isi 100%" : "Isi hari ini"}
                </Button>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <Field label="% Progres" help="Bilangan bulat 0 sampai 100" error={errors.progress}>
                <NumberInput
                  value={values.progress}
                  onChange={(e) => set("progress")(e.target.value)}
                  className="max-w-28"
                />
              </Field>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={slider}
                onChange={(e) => set("progress")(e.target.value)}
                aria-label="Geser % progres"
                aria-valuetext={`${slider}%`}
                className="h-11 w-full cursor-pointer accent-brand sm:h-8"
              />
            </div>
            <Field label="Bukti / dokumen" error={errors.evidence}>
              <Textarea
                rows={3}
                value={values.evidence}
                placeholder="Daftar hadir, foto kegiatan, nomor dokumen, atau tautan berkas"
                onChange={(e) => set("evidence")(e.target.value)}
              />
            </Field>
            <Field label="Kendala / catatan" error={errors.notes}>
              <Textarea rows={3} value={values.notes} onChange={(e) => set("notes")(e.target.value)} />
            </Field>
          </Section>
          <Section title="Rencana">{planFields}</Section>
        </>
      )}

      <DialogActions>
        {!isNew && onArchive ? (
          <Button variant="delete" onClick={() => onArchive(plan)} disabled={pending} className="sm:mr-auto">
            Hapus rencana aksi
          </Button>
        ) : null}
        <SaveStatus state={save} className={isNew || !onArchive ? "sm:mr-auto" : undefined} />
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Batal
        </Button>
        <Button type="submit" loading={pending} loadingText="Menyimpan…">
          {isNew ? "Simpan rencana aksi" : "Simpan perubahan"}
        </Button>
      </DialogActions>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4">
      <legend className="mb-3 text-base font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Where the row stands now, above the form: flag, due date, last change. */
function PlanSummary({ plan }: { plan: PlanView }) {
  const due = dueLabel(plan.dueDate);
  const left = daysLeftLabel(plan.daysLeft);
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line bg-surface-sunken p-3 text-sm">
      <p className="whitespace-pre-line text-ink [overflow-wrap:anywhere]">{plan.action}</p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusChip label={plan.flag} />
        <span className="text-ink-muted">
          {due ? (
            <>
              Batas <span className="tabular text-ink">{due}</span>
              {left ? ` · ${left}` : ""}
            </>
          ) : (
            "Tanpa batas waktu"
          )}
        </span>
      </p>
      <p className="text-xs text-ink-muted">{plan.changedLabel}</p>
    </div>
  );
}
