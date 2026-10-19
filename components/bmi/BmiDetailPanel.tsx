"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { formatTanggal } from "@/lib/dates";
import { formatDecimal, formatSignedKg } from "@/lib/format";
import type { Settings } from "@/lib/rules";
import { CategoryBadge, Dash, HeightBadge, PendingBadge, ScheduleBadge } from "./badges";
import { NOTE_LABEL } from "./labels";
import { idOf, type BmiRowView } from "./tracker-model";

const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

type BmiDetailPanelProps = {
  open: boolean;
  onClose: () => void;
  view: BmiRowView | null;
  settings: Settings;
  plannedDates: string[];
  /** "BMI Cek ke-3 (Periode 9-22 Nov 2026)" for every period. */
  labels: string[];
  /** The period chosen on the page, marked in the history. */
  period: number;
  /** "Edit Profil": opens the form for this person's name, NIPP and L/P. */
  onEditProfile: (code: string) => void;
};

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-stat">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Long free text: line breaks kept, a maximum height with its own scroll. */
function NoteBox({ label, text, empty }: { label: string; text: string | null; empty: string }) {
  return (
    <div className="note-box" role="region" aria-label={label} tabIndex={0} data-empty={!text || undefined}>
      {text ? text : empty}
    </div>
  );
}

/**
 * The right-hand profile of one person: facts, every check, and the programme note in full.
 * A native modal dialog docked to the right, so the page behind is inert, Escape and a click
 * on the scrim close it, focus starts on the close button and returns to the name that opened it.
 */
export function BmiDetailPanel({ open, onClose, view, settings, plannedDates, labels, period, onEditProfile }: BmiDetailPanelProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      document.documentElement.style.overflow = "hidden";
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    const handleClose = () => {
      const target = returnFocusTo.current;
      returnFocusTo.current = null;
      if (target?.isConnected) target.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const row = view?.row;
  const summary = view?.summary;
  const gender = row?.gender === "L" ? "Laki-laki" : row?.gender === "P" ? "Perempuan" : null;
  const meta = row ? [idOf(row), row.station].filter(Boolean).join(" · ") : "";

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="bmi-panel-root"
      onClick={(event) => {
        // A click on the dialog box itself, outside the panel, is a click on the scrim.
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      {row && summary ? (
        <div className="bmi-panel">
          <div className="bmi-panel-head">
            <button type="button" className="bmi-panel-close" onClick={() => onCloseRef.current()} aria-label="Tutup detail">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
                <path d="M2 2l10 10M12 2 2 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
            <p className="bmi-panel-overline">Profil pemeriksaan</p>
            <h2 id={titleId}>{row.name}</h2>
            <p className="bmi-panel-meta">{meta}</p>
          </div>

          <div className="bmi-panel-body">
            <div className="detail-section-row">
              <h3 className="detail-section">Informasi petugas</h3>
              <button type="button" className="detail-edit" onClick={() => onEditProfile(row.code)}>
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path
                    d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3l-7.6 7.6-3 .7.7-3 7.6-7.6Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
                Edit Profil
                <span className="sr-only">, {row.name}</span>
              </button>
            </div>
            <dl className="detail-grid">
              <Stat label="Jenis kelamin">{gender ?? <Dash reason="belum diisi" />}</Stat>
              <Stat label="NIPP">{row.employeeNo || <Dash reason="belum diisi" />}</Stat>
              <Stat label="BMI terakhir">
                {summary.latestBmi !== null ? formatDecimal(summary.latestBmi, 1) : <Dash reason="belum ada" />}
              </Stat>
              <Stat label="Kategori">
                <CategoryBadge category={summary.latestCategory} />
              </Stat>
              <Stat label="Jumlah pemeriksaan">
                {summary.checks} / {settings.bmiPeriods}
              </Stat>
              <Stat label="Cek berikutnya">
                <span className="detail-next">
                  {formatTanggal(summary.nextCheck)}
                  <ScheduleBadge status={summary.scheduleStatus} />
                </span>
              </Stat>
              <Stat label="Δ Berat vs cek pertama (kg)">
                {summary.weightDelta !== null ? formatSignedKg(summary.weightDelta) : <Dash reason="belum ada" />}
              </Stat>
              <Stat label="Syarat tinggi badan">
                <HeightBadge value={summary.heightRequirement} />
              </Stat>
              {row.assignmentStatus ? <Stat label="Status penugasan">{row.assignmentStatus}</Stat> : null}
            </dl>
            {row.changed ? <p className="detail-changed">Terakhir diubah lewat {row.changed}</p> : null}

            <h3 className="detail-section">Riwayat cek BMI</h3>
            <ol className="history">
              {plannedDates.map((planned, i) => {
                const check = row.checks[i] ?? null;
                const value = summary.periods[i] ?? null;
                const selected = i + 1 === period;
                return (
                  <li key={planned} className="history-row" data-selected={selected || undefined}>
                    <div className="left">
                      <b>
                        {labels[i]}
                        {selected ? <span className="sr-only"> (dipilih)</span> : null}
                      </b>
                      <small>
                        {check?.date ? formatTanggal(check.date) : `${formatTanggal(planned)} · belum diisi`}
                      </small>
                    </div>
                    <div className="right">
                      {check && value?.bmi != null ? (
                        <>
                          <span className="history-bmi">
                            {formatDecimal(value.bmi, 1)} <CategoryBadge category={value.category} />
                          </span>
                          <small>
                            {formatDecimal(check.heightCm, 0, 1)} cm · {formatDecimal(check.weightKg, 0, 1)} kg
                          </small>
                        </>
                      ) : (
                        <PendingBadge>Belum diperiksa</PendingBadge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            <h3 className="detail-section">{NOTE_LABEL}</h3>
            <NoteBox label={NOTE_LABEL} text={row.fitnessNote} empty="Belum ada catatan." />
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
