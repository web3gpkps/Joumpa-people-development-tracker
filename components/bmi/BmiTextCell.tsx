"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { cx } from "@/components/ui/cx";
import { Dash } from "./badges";
import { expandLabel, isClipped, mayOverflow } from "./long-text";

/* One ResizeObserver for every cell: it reports each cell once when it is first laid out. */
const watchers = new WeakMap<Element, () => void>();
let observer: ResizeObserver | null = null;

function watch(el: Element, run: () => void): () => void {
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) watchers.get(entry.target)?.();
  });
  watchers.set(el, run);
  observer.observe(el);
  return () => {
    observer?.unobserve(el);
    watchers.delete(el);
  };
}

/**
 * True when the one-line text is really clipped by the cell (measured, so a short text never
 * gets a toggle). Measured while collapsed; once a cell is expanded the last answer is kept.
 */
function useClipped(ref: RefObject<HTMLElement | null>, text: string | null, textWidth: number, active: boolean): boolean {
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || !mayOverflow(text, textWidth)) return;
    const measure = () => setClipped(isClipped(el));
    const stop = watch(el, measure);
    let live = true;
    // Text is a little wider once the web font has loaded.
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      stop();
    };
  }, [ref, text, textWidth, active]);
  return clipped && mayOverflow(text, textWidth);
}

type TextCellProps = {
  /** Column class (width) and the cell's own modifier classes. */
  className?: string;
  text: string | null;
  /** Pixels the one-line text has: column width minus padding and the toggle. */
  textWidth: number;
  /** Column title, used in every accessible name. */
  column: string;
  person: string;
  expanded: boolean;
  onToggle: () => void;
  /** Present for a yellow cell: the text opens the edit dialog, the toggle stays a separate target. */
  edit?: { onEdit: () => void };
};

function Chevron() {
  return (
    <svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true" focusable="false">
      <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A free-text cell (Coaching Evaluation Feedback, Result/Remarks, Catatan Program
 * Kebugaran). Collapsed it is one line with an ellipsis. When the text is clipped a toggle
 * appears; expanding keeps the line breaks, grows the row, and lets the text be selected.
 * Escape collapses. A yellow cell keeps editing on the text and expanding on the toggle.
 */
export function BmiTextCell({ className, text, textWidth, column, person, expanded, onToggle, edit }: TextCellProps) {
  const mainRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const keepFocus = useRef(false);
  const clipped = useClipped(mainRef, text, textWidth, !expanded);
  const showToggle = expanded || clipped;
  const empty = !text;

  // The toggle that was used is replaced by its twin; put the keyboard focus on the new one.
  useLayoutEffect(() => {
    if (keepFocus.current) {
      keepFocus.current = false;
      toggleRef.current?.focus();
    }
  }, [expanded]);

  const toggle = () => {
    keepFocus.current = true;
    onToggle();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && expanded) {
      event.stopPropagation();
      toggle();
    }
  };

  const label = expandLabel(expanded, column, person);
  const editHint = `Ubah ${column}, ${person}`;

  return (
    <td className={cx("text-cell", edit && "editable", className)} data-expanded={expanded || undefined}>
      <div className="cell-inner" data-expanded={expanded || undefined} onKeyDown={onKeyDown}>
        {expanded ? (
          <div className="cell-main" data-expanded="" role="region" aria-label={`${column}, ${person}`} tabIndex={0}>
            {text}
          </div>
        ) : edit ? (
          <button
            ref={mainRef as RefObject<HTMLButtonElement>}
            type="button"
            className="cell-main cell-btn"
            data-empty={empty || undefined}
            onClick={(event) => {
              event.currentTarget.focus();
              edit.onEdit();
            }}
          >
            {text}
            <span className="sr-only">
              {empty ? `Kosong. ${editHint}` : `. ${editHint}`}
            </span>
          </button>
        ) : (
          <span ref={mainRef as RefObject<HTMLSpanElement>} className="cell-main">
            {empty ? <Dash /> : text}
          </span>
        )}

        {expanded ? (
          <div className="cell-actions">
            <button ref={toggleRef} type="button" className="cell-chip" aria-expanded="true" aria-label={label} onClick={toggle}>
              Hide
            </button>
            {edit ? (
              <button type="button" className="cell-chip" aria-label={editHint} onClick={edit.onEdit}>
                Ubah
              </button>
            ) : null}
          </div>
        ) : showToggle ? (
          <button
            ref={toggleRef}
            type="button"
            className="cell-toggle"
            aria-expanded="false"
            aria-label={label}
            title="Lihat selengkapnya"
            onClick={toggle}
          >
            <Chevron />
          </button>
        ) : null}
      </div>
    </td>
  );
}
