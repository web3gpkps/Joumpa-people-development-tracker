"use client";

import Link from "next/link";
import { createContext, use, useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/Field";
import { SaveStatus, type SaveState } from "@/components/ui/SaveStatus";
import { StatusChip } from "@/components/ui/StatusChip";
import { cx } from "@/components/ui/cx";
import {
  REPLACEMENT_CATEGORIES,
  STATUSES,
  YA_BELUM_TIDAK,
  replacementNotRegistered,
  replacementPassed,
} from "@/lib/pd-rules";
import { deleteReplacement, saveReplacement } from "./actions";
import {
  LONG_TEXT_MAX,
  PASS_RULE,
  TEXT_MAX,
  checkForm,
  formFromRow,
  formKeyOf,
  formScores,
  newFormValues,
  searchStaff,
  type FormErrors,
  type FormKey,
  type FormValues,
  type ReplacementView,
  type StaffOption,
} from "./model";

/** Everything the client parts need from the server (serialisable). */
export type ReplacementCtx = {
  accessKey: string;
  /** 'YYYY-MM-DD', Asia/Jakarta. */
  today: string;
  /** Tracker Staf, in workbook order. */
  staff: StaffOption[];
  /** ID SDM already in the list (shown in the picker). */
  listedCodes: string[];
  trackerStafHref: string;
};

const CONNECTION_LOST = "koneksi terputus. Isian masih ada, simpan lagi.";

export const STATUS_HINT = "Selesai pada kategori Penggantian otomatis menandai SDM ini “Diganti” di Tracker Staf.";
export const STRONG_REMINDER_NOTE =
  "Isi ‘Status penarikan’ = Batal / N.A. bila diputuskan tetap bertugas setelah strong reminder.";

// ------------------------------------------------------------------ page-level status

type PageStatus = { state: SaveState; set: (state: SaveState) => void };
const PageStatusContext = createContext<PageStatus | null>(null);

/** Save feedback that outlives a row: "Dihapus · 14.05" lands here after its row is gone. */
export function ReplacementPageStatus({ children }: { children: ReactNode }) {
  const [state, set] = useState<SaveState>({ status: "idle" });
  return <PageStatusContext value={{ state, set }}>{children}</PageStatusContext>;
}

export function PageSaveStatus({ className }: { className?: string }) {
  const page = use(PageStatusContext);
  return page ? <SaveStatus state={page.state} className={className} /> : null;
}

// ------------------------------------------------------------------ staff picker

type StaffPickerProps = {
  staff: StaffOption[];
  value: string;
  onChange: (code: string) => void;
  listedCodes: string[];
  /** The row's own ID SDM (not flagged as "sudah di daftar"). */
  ownCode: string | null;
  error?: string;
};

/** Search by name or ID, then one radio per match. Picking fills Cabang (shown, not typed). */
function StaffPicker({ staff, value, onChange, listedCodes, ownCode, error }: StaffPickerProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const matches = searchStaff(staff, query, 40);
  const chosen = staff.find((s) => s.code === value) ?? null;
  const listed = new Set(listedCodes);

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-1 text-sm font-semibold text-ink">
        SDM <span className="font-normal text-ink-muted">(wajib)</span>
      </legend>
      {chosen ? (
        <p className="flex flex-wrap items-baseline gap-x-2 rounded-control bg-brand-tint px-3 py-2 text-sm text-ink">
          <span className="font-semibold">{chosen.name}</span>
          <span className="tabular text-ink-muted">
            {chosen.code} · Cabang {chosen.reportGroup ?? chosen.station}
          </span>
        </p>
      ) : null}
      <label htmlFor={`${id}-q`} className="sr-only">
        Cari SDM
      </label>
      <Input
        id={`${id}-q`}
        type="search"
        value={query}
        placeholder="Cari nama atau ID SDM"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-56 overflow-y-auto overscroll-contain rounded-control border border-line">
        {matches.length === 0 ? (
          <p className="px-3 py-3 text-sm text-ink-muted">Tidak ada SDM yang cocok dengan &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          <ul className="divide-y divide-line">
            {matches.map((s) => {
              const checked = s.code === value;
              return (
                <li key={s.code}>
                  <label
                    className={cx(
                      "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors duration-120 lg:min-h-10",
                      checked ? "bg-brand-tint" : "hover:bg-bg",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-staff`}
                      value={s.code}
                      checked={checked}
                      onChange={() => onChange(s.code)}
                      className="size-4 shrink-0 accent-brand"
                    />
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{s.name}</span>
                    <span className="tabular shrink-0 text-xs text-ink-muted">
                      {s.code}
                      {listed.has(s.code) && s.code !== ownCode ? " · sudah di daftar" : ""}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs font-semibold text-critical">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

// ------------------------------------------------------------------ the form

function Options({ values, blank }: { values: readonly string[]; blank: string }) {
  return (
    <>
      <option value="">{blank}</option>
      {values.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </>
  );
}

type FormProps = {
  ctx: ReplacementCtx;
  row: ReplacementView | null;
  formId: string;
  pending: boolean;
  errors: FormErrors;
  setErrors: (errors: FormErrors) => void;
  onSubmit: (values: FormValues) => void;
};

/** Add (short: the usulan and its deadlines) or edit (every input field). Mounted only while open. */
function ReplacementForm({ ctx, row, formId, pending, errors, setErrors, onSubmit }: FormProps) {
  const [values, setValues] = useState<FormValues>(() => (row ? formFromRow(row) : newFormValues()));
  const set = (key: FormKey) => (event: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: event.target.value }));
  const isNew = row === null;
  const strongReminder = values.category === "Strong reminder";
  const passed = replacementPassed(formScores(values));
  const notRegistered = replacementNotRegistered(values, ctx.staff);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const result = checkForm(values, row);
    if (!result.ok) {
      setErrors(result.errors);
      const form = event.currentTarget;
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setErrors({});
    onSubmit(values);
  }

  return (
    <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-base font-semibold text-ink">Usulan</legend>
        <StaffPicker
          staff={ctx.staff}
          value={values.staffCode}
          onChange={(code) => setValues((v) => ({ ...v, staffCode: code }))}
          listedCodes={ctx.listedCodes}
          ownCode={row?.staffCode ?? null}
          error={errors.staffCode}
        />
        {row && !row.staffCode ? (
          <p className="text-xs text-ink-muted">Tercatat sebagai {row.name}, belum terhubung ke Tracker Staf.</p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kategori" required={isNew} error={errors.category}>
            <Select value={values.category} onChange={set("category")}>
              <Options values={REPLACEMENT_CATEGORIES} blank="Pilih kategori" />
            </Select>
          </Field>
          <Field label="Dasar usulan" error={errors.basis} className="sm:col-span-2">
            <Textarea value={values.basis} rows={2} maxLength={LONG_TEXT_MAX} onChange={set("basis")} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-base font-semibold text-ink">Penarikan</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Batas tarik / keputusan" error={errors.withdrawDue}>
            <Input type="date" value={values.withdrawDue} onChange={set("withdrawDue")} />
          </Field>
          <Field label="Persetujuan Direksi" error={errors.directorApproval}>
            <Select value={values.directorApproval} onChange={set("directorApproval")}>
              <Options values={YA_BELUM_TIDAK} blank="Belum diisi" />
            </Select>
          </Field>
          {isNew ? null : (
            <Field label="Tgl ditarik / keputusan" error={errors.withdrawnOn}>
              <Input type="date" value={values.withdrawnOn} onChange={set("withdrawnOn")} />
            </Field>
          )}
          <Field
            label="Status penarikan"
            error={errors.withdrawStatus}
            help={strongReminder ? STRONG_REMINDER_NOTE : STATUS_HINT}
            className={isNew ? undefined : "sm:col-span-2"}
          >
            <Select value={values.withdrawStatus} onChange={set("withdrawStatus")}>
              <Options values={STATUSES} blank="Belum diisi" />
            </Select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-base font-semibold text-ink">Pengganti</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {isNew ? null : (
            <>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Field label="Nama pengganti" error={errors.replacementName}>
                  <Input value={values.replacementName} maxLength={TEXT_MAX} onChange={set("replacementName")} />
                </Field>
                {notRegistered ? <NotRegisteredNote href={ctx.trackerStafHref} /> : null}
              </div>
              <Field label="Tgl seleksi" error={errors.selectedOn}>
                <Input type="date" value={values.selectedOn} onChange={set("selectedOn")} />
              </Field>
              <Field label="Tgl mulai bertugas" error={errors.startedOn}>
                <Input type="date" value={values.startedOn} onChange={set("startedOn")} />
              </Field>
              <Field label="Post-test pengganti" help="0 sampai 100, lulus ≥ 80" error={errors.postTest}>
                <NumberInput decimal value={values.postTest} onChange={set("postTest")} />
              </Field>
              <Field label="Praktik pengganti" help="1 sampai 5, lulus ≥ 4,00" error={errors.practice}>
                <NumberInput decimal value={values.practice} onChange={set("practice")} />
              </Field>
            </>
          )}
          <Field label="Batas lulus training" error={errors.trainingDue}>
            <Input type="date" value={values.trainingDue} onChange={set("trainingDue")} />
          </Field>
          {isNew ? null : (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-ink">Lulus training?</p>
              <p className="flex min-h-11 items-center lg:min-h-10">
                <StatusChip label={passed} emptyLabel="Isi post-test dan praktik" />
              </p>
            </div>
          )}
        </div>
        {isNew ? (
          <p className="text-xs text-ink-muted">Nama pengganti, nilai training dan tanggalnya diisi di tabel setelah usulan ini dibuat.</p>
        ) : (
          <p className="text-xs text-ink-muted">Lulus bila {PASS_RULE}. Dihitung otomatis.</p>
        )}
      </fieldset>

      {isNew ? null : (
        <Field label="Catatan" error={errors.notes}>
          <Textarea value={values.notes} rows={2} maxLength={LONG_TEXT_MAX} onChange={set("notes")} />
        </Field>
      )}
    </form>
  );
}

/** "Pengganti belum terdaftar di Tracker Staf", with the way there. */
export function NotRegisteredNote({ href, className }: { href: string; className?: string }) {
  return (
    <p className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)}>
      <span className="rounded-status bg-warning-tint px-1.5 py-0.5 font-semibold text-warning">
        Pengganti belum terdaftar di Tracker Staf
      </span>
      <Link href={href} className="font-semibold text-accent underline underline-offset-2 hover:text-brand">
        Tambahkan di Tracker Staf
      </Link>
    </p>
  );
}

type FormDialogProps = {
  ctx: ReplacementCtx;
  row: ReplacementView | null;
  open: boolean;
  onClose: () => void;
  onSaved: (at: string) => void;
};

function ReplacementFormDialog({ ctx, row, open, onClose, onSaved }: FormDialogProps) {
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<SaveState>({ status: "idle" });

  function close() {
    if (pending) return;
    setErrors({});
    setStatus({ status: "idle" });
    onClose();
  }

  function save(values: FormValues) {
    const result = checkForm(values, row);
    if (!result.ok) return;
    if (Object.keys(result.patch).length === 0) {
      close();
      return;
    }
    setStatus({ status: "saving" });
    startTransition(async () => {
      let saved: Awaited<ReturnType<typeof saveReplacement>>;
      try {
        saved = await saveReplacement(ctx.accessKey, row?.id ?? null, result.patch);
      } catch {
        setStatus({ status: "error", message: CONNECTION_LOST });
        return;
      }
      if (saved.ok) {
        setErrors({});
        setStatus({ status: "idle" });
        onSaved(saved.savedAt);
        return;
      }
      const key = saved.error.code === "invalid_input" ? formKeyOf(saved.error.field) : null;
      setErrors(key ? { [key]: saved.error.message } : {});
      setStatus({ status: "error", message: saved.error.message });
    });
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={false}
      size="md"
      title={row ? `Penggantian ${row.name}` : "Tambah usulan penggantian"}
      description={row ? [row.reportGroup && `Cabang ${row.reportGroup}`, row.category].filter(Boolean).join(" · ") : undefined}
      footer={
        <>
          <SaveStatus state={status} className="sm:mr-auto" />
          <Button variant="secondary" onClick={close} disabled={pending}>
            Batal
          </Button>
          <Button type="submit" form={formId} loading={pending} loadingText="Menyimpan…">
            {row ? "Simpan perubahan" : "Tambah ke daftar"}
          </Button>
        </>
      }
    >
      {open ? (
        <ReplacementForm
          ctx={ctx}
          row={row}
          formId={formId}
          pending={pending}
          errors={errors}
          setErrors={setErrors}
          onSubmit={save}
        />
      ) : null}
    </Dialog>
  );
}

// ------------------------------------------------------------------ buttons

/** Page action: "Tambah usulan" and its dialog. */
export function AddReplacementButton({ ctx }: { ctx: ReplacementCtx }) {
  const [open, setOpen] = useState(false);
  const page = use(PageStatusContext);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Tambah usulan</Button>
      <ReplacementFormDialog
        ctx={ctx}
        row={null}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(at) => {
          setOpen(false);
          page?.set({ status: "saved", at });
        }}
      />
    </>
  );
}

/** "Ubah" for one row (phone cards): every field in a sheet. */
export function EditReplacementButton({ ctx, row }: { ctx: ReplacementCtx; row: ReplacementView }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SaveState>({ status: "idle" });
  return (
    <>
      <SaveStatus state={status} />
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Perbarui<span className="sr-only"> penggantian {row.name}</span>
      </Button>
      <ReplacementFormDialog
        ctx={ctx}
        row={row}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(at) => {
          setOpen(false);
          setStatus({ status: "saved", at });
        }}
      />
    </>
  );
}

/** "Hapus" with its confirmation. The row disappears on success, so the status goes to the page. */
export function DeleteReplacementButton({
  ctx,
  row,
  inGrid = false,
}: {
  ctx: ReplacementCtx;
  row: Pick<ReplacementView, "id" | "name">;
  /** Inside the grid the row action is reached with the arrow keys, not Tab. */
  inGrid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const page = use(PageStatusContext);

  function remove() {
    startTransition(async () => {
      try {
        const result = await deleteReplacement(ctx.accessKey, row.id);
        if (result.ok) {
          setOpen(false);
          page?.set({ status: "deleted", at: result.savedAt });
        } else {
          setError(result.error.message);
        }
      } catch {
        setError(CONNECTION_LOST);
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        tabIndex={inGrid ? -1 : undefined}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Hapus<span className="sr-only"> penggantian {row.name}</span>
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        dismissible={!pending}
        title={`Hapus penggantian ${row.name}?`}
        description="Baris ini hilang dari daftar penggantian. Data SDM-nya di Tracker Staf tidak berubah."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Batal
            </Button>
            <Button variant="danger" onClick={remove} loading={pending} loadingText="Menghapus…">
              Hapus penggantian
            </Button>
          </>
        }
      >
        {error ? (
          <p role="alert" className="text-sm font-semibold text-critical">
            Gagal menghapus: {error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
