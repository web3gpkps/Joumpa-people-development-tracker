"use client";

import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { matchOption, parseDateInput, valueToText, type CellValue, type ValueRules } from "@/lib/grid/values";
import { Button } from "@/components/ui/Button";

/** What the grid reads from an open editor when it commits. */
export type EditorHandle = { text: () => string };

type CellEditorProps = {
  ref: Ref<EditorHandle>;
  rules: ValueRules;
  /** Text to start from: the typed key ("enter" mode) or the current value as text. */
  initialText: string;
  /** Spoken label: "SUB-01, Petugas Contoh, B Grooming". */
  label: string;
  /** Commit what is typed and stay on the cell (blur, Simpan button, a picked date). */
  onCommit: () => void;
  onCancel: () => void;
};

/**
 * The inline editor inside the active cell. Keys that move or commit (Enter, Tab,
 * Escape, arrows in "enter" mode) bubble to the grid, which reads text() and commits.
 * Client component, rendered only for the one cell being edited.
 */
export function CellEditor({ ref, rules, initialText, label, onCommit, onCancel }: CellEditorProps) {
  if (rules.editor === "longtext") {
    return <LongTextEditor ref={ref} initialText={initialText} label={label} onCommit={onCommit} onCancel={onCancel} />;
  }
  if (rules.editor === "select") {
    return <SelectEditor ref={ref} rules={rules} initialText={initialText} label={label} onCommit={onCommit} />;
  }
  return <TextEditor ref={ref} rules={rules} initialText={initialText} label={label} onCommit={onCommit} />;
}

/** Commit when focus leaves the editor for somewhere outside it. */
function useCommitOnLeave(onCommit: () => void) {
  return (event: React.FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    onCommit();
  };
}

function TextEditor({
  ref,
  rules,
  initialText,
  label,
  onCommit,
}: Omit<CellEditorProps, "onCancel">) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText);
  useImperativeHandle(ref, () => ({ text: () => inputRef.current?.value ?? text }), [text]);
  const onLeave = useCommitOnLeave(onCommit);

  // Layout effect: focus moves before the next keystroke arrives, so no character is lost.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    // Caret at the end, as in Excel after typing or F2.
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const isDate = rules.editor === "date";
  const inputMode = rules.editor === "score" ? "numeric" : rules.editor === "number" ? "decimal" : "text";

  return (
    <span className="contents" onBlur={onLeave}>
      <input
        ref={inputRef}
        className="dg-editor"
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={rules.editor === "text"}
        placeholder={isDate ? "dd/mm/yyyy" : undefined}
        maxLength={rules.editor === "score" ? 1 : undefined}
        onKeyDown={(e) => {
          // Alt+ArrowDown opens the date picker, as for a native select.
          if (isDate && e.altKey && e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            pickerRef.current?.showPicker?.();
          }
        }}
        style={isDate ? { paddingRight: "3.25rem" } : undefined}
      />
      {isDate ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Pilih dari kalender"
            className="absolute top-1/2 right-1 z-[5] -translate-y-1/2 rounded-control border border-line-strong bg-surface px-1.5 text-xs font-semibold text-ink hover:bg-neutral-tint"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pickerRef.current?.showPicker?.()}
          >
            Pilih
          </button>
          <input
            ref={pickerRef}
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none absolute right-0 bottom-0 h-px w-px opacity-0"
            defaultValue={parseDateInput(initialText) ?? undefined}
            onChange={(e) => {
              if (!e.target.value) return;
              setText(valueToText({ editor: "date" }, e.target.value));
              inputRef.current?.focus({ preventScroll: true });
            }}
          />
        </>
      ) : null}
    </span>
  );
}

function SelectEditor({
  ref,
  rules,
  initialText,
  label,
  onCommit,
}: Omit<CellEditorProps, "onCancel">) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const options = rules.options ?? [];
  // initialText is the stored value (F2, Enter) or the key that started the edit.
  const exact = options.find((o) => o.value === initialText);
  const [value, setValue] = useState(() => exact?.value ?? matchOption(options, initialText)?.value ?? "");
  // Our own type-ahead, seeded with that first key: the native one would start over without it.
  const typed = useRef({ text: exact ? "" : initialText, at: 0 });
  useImperativeHandle(ref, () => ({ text: () => selectRef.current?.value ?? value }), [value]);
  const onLeave = useCommitOnLeave(onCommit);

  useLayoutEffect(() => {
    selectRef.current?.focus({ preventScroll: true });
    typed.current.at = Date.now();
  }, []);

  return (
    <select
      ref={selectRef}
      className="dg-editor select-control"
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.key === " ") return;
        e.preventDefault();
        const now = Date.now();
        const text = (now - typed.current.at < 1000 ? typed.current.text : "") + e.key;
        typed.current = { text, at: now };
        const match = matchOption(options, text);
        if (match) setValue(match.value);
      }}
      onBlur={onLeave}
    >
      {!rules.required ? <option value="">(kosong)</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label ?? o.value}
        </option>
      ))}
    </select>
  );
}

const POPOVER_GAP = 8;

/**
 * Fixed position next to the cell, so the grid's scroll box never clips it: below the cell,
 * or above it when the viewport has no room below (the last rows of a short grid). Placed
 * by writing the style directly, so the popover is never hidden while the editor takes focus.
 */
function usePopoverPosition(popoverRef: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const place = () => {
      const popover = popoverRef.current;
      const cell = popover?.parentElement;
      if (!popover || !cell) return;
      const rect = cell.getBoundingClientRect();
      const width = Math.max(rect.width, Math.min(320, window.innerWidth - 2 * POPOVER_GAP));
      popover.style.width = `${width}px`;
      const height = popover.offsetHeight;
      const below = rect.bottom + height + POPOVER_GAP <= window.innerHeight;
      const top = below || rect.top - height < POPOVER_GAP ? rect.bottom : rect.top - height;
      const left = Math.max(POPOVER_GAP, Math.min(rect.left, window.innerWidth - width - POPOVER_GAP));
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [popoverRef]);
}

function LongTextEditor({ ref, initialText, label, onCommit, onCancel }: Omit<CellEditorProps, "rules">) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(initialText);
  useImperativeHandle(ref, () => ({ text: () => areaRef.current?.value ?? text }), [text]);
  const onLeave = useCommitOnLeave(onCommit);
  usePopoverPosition(popoverRef);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(area.value.length, area.value.length);
  }, []);

  return (
    <div
      ref={popoverRef}
      className="dg-popover"
      onBlur={onLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <textarea
        ref={areaRef}
        aria-label={label}
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter is a new line here; Ctrl/Cmd+Enter (handled by the grid) saves.
          if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) e.stopPropagation();
        }}
        className="block w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">Ctrl+Enter menyimpan, Esc membatalkan.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel}>
            Batal
          </Button>
          <Button size="sm" onClick={onCommit}>
            Simpan
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Current value as editor text (decimal comma, dd/mm/yyyy). */
export function editorText(rules: ValueRules, value: CellValue): string {
  return valueToText(rules, value);
}
