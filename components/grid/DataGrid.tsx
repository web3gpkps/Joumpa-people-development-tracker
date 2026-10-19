"use client";

/**
 * DataGrid: the spreadsheet for every bulk-entry sheet (docs/UX.md §2). Client component.
 *
 * ── API ───────────────────────────────────────────────────────────────────────────────
 *
 *   const columns = useMemo<GridColumn<Row>[]>(() => [
 *     { key: "code", header: "ID", width: 84, editor: "readonly", frozen: true },
 *     { key: "name", header: "Nama", width: 200, editor: "text", required: true, maxLength: 200, frozen: true },
 *     { key: "score_a", header: "A", label: "A Penampilan", group: "Nilai pelatihan", width: 52,
 *       editor: "score", get: (r) => r.scoreA },
 *     { key: "status", header: "Status", width: 120, editor: "readonly",
 *       render: (_v, r) => <StatusChip label={r.status} /> },
 *   ], [deps]);
 *
 *   <DataGrid
 *     caption="Master SDM, semua stasiun"          // accessible name of the grid
 *     rows={rows} rowKey={(r) => r.code} rowLabel={(r) => `${r.code}, ${r.name}`}
 *     columns={columns}                             // MEMOISE: a new array re-renders every row
 *     onSaveRow={async (key, changes, row) => …}    // per-row autosave, see below
 *     toolbar={<StationSelect …/>} actions={<AddButton/>} summary="75 SDM · 12 sudah dinilai"
 *     search={{ placeholder: "Cari nama atau ID", text: (r) => `${r.code} ${r.name}` }}
 *     rowActions={{ header: "Aksi", width: 88, render: (r) => <Button size="sm">Ubah</Button> }}
 *     confirmClear={{ fields: ["score_a", …], message: (r) => `Hapus nilai ${r.name}?` }}
 *     confirmClear={{ groups: [{ fields: ["tb_1", "bb_1"], label: "ke-1" }, …],   // one entry per group
 *                     message: (r, labels) => `Hapus cek BMI ${labels.join(" dan ")} untuk ${r.name}?` }}
 *     highlightGroup="Cek ke-2 (26 Okt)" highlightNote="periode berjalan"   // highlighted, scrolled into view
 *     focusRowKey="SUB-TL03"                        // deep link: that row becomes active and focused
 *     phone={<StaffCards …/>}                       // cards under 900 px (UX.md §2, phones)
 *   />
 *
 * Column (GridColumn<Row>):
 *   key        field name in `changes` and in server fieldErrors; also the default accessor row[key]
 *   header     short header text; `label` the full name for screen readers ("B Grooming")
 *   group      group header shown over adjacent columns with the same group
 *   width      px (required: fixed layout + freeze panes)
 *   frozen     sticky on the left; frozen columns must come first (ID, Nama)
 *   editor     "text" | "longtext" | "number" | "score" | "date" | "select" | "readonly"
 *              rules: required, maxLength (text), min / max / decimals (number), options (select)
 *   get        value accessor (string | number | null); render: custom display (chips, links)
 *   editable   (row) => boolean, to lock single rows (e.g. KPS-only fields for station links)
 *   validate   (value, row) => message | null, an extra rule after the type rules
 *   align      "end" for numbers (default for number / score)
 *   advance    single-key entry (score columns): a typed character is committed at once, no
 *              editor opens; a valid value moves to the next input cell on the right
 *              (computed cells skipped), an invalid one stays with its message. F2 / Enter
 *              editing and paste work as usual.
 *   derive     read-only computed cells that follow the row as shown now, pending edits
 *              included: (row, value) => value("score_a") … (e.g. a live average and status)
 *
 * confirmClear: a save that would empty a field set (or any of `groups`) holding stored
 * data asks first; "Batal" puts those cells back and the row's other edits still save.
 *
 * Saving: a committed cell marks its row dirty; the row saves `saveDelay` ms (800) after
 * the last commit, and at once when the active cell leaves the row. onSaveRow receives
 * only the fields whose value differs from `row` (merge them for RPCs that write every
 * field) and returns { ok: true } or { ok: false, message?, fieldErrors?: { [key]: msg } }.
 * Invalid cells are shown with their message and never sent; the rest of the row saves.
 * The first column shows each row's state (belum tersimpan / menyimpan / tersimpan /
 * gagal + retry); the toolbar counts unsaved rows, and leaving the page with unsaved rows
 * asks first. Typed values stay until the server data refreshes (call refresh() in the
 * action), so nothing is lost on an error.
 *
 * Keys (lib/grid/navigation.ts): arrows, Shift+arrows, Home/End, Ctrl+Home/End,
 * PageUp/Down, Tab/Shift+Tab (leaves the grid at the row's edge), Enter/F2 edit, typing
 * replaces, Enter commits and moves down, Esc cancels, Delete clears, Ctrl/Cmd+C copies
 * the selection as TSV, Ctrl/Cmd+V pastes a block from Excel / Google Sheets (one value
 * into a selection fills it). Enter on a read-only cell clicks its first button (row actions).
 */

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  changedOnly,
  clearedGroups,
  editsReducer,
  hasInvalid,
  isInvalid,
  pendingValues,
  unsavedRows,
  type CellEdit,
  type EditsAction,
  type EditsState,
  type RowEdits,
} from "@/lib/grid/edits";
import {
  clampNav,
  editorInitialText,
  initialNav,
  navClick,
  navKey,
  selectionBounds,
  type Cell,
  type GridShape,
  type NavState,
} from "@/lib/grid/navigation";
import { parseTsv, toTsv } from "@/lib/grid/tsv";
import {
  displayValue,
  parseCell,
  sameValue,
  valueToText,
  type CellValue,
  type ValueRules,
} from "@/lib/grid/values";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cx } from "@/components/ui/cx";
import { CellEditor, type EditorHandle } from "./CellEditor";
import { useNarrowViewport } from "./useNarrowViewport";
import "./grid.css";

export type { CellValue } from "@/lib/grid/values";

export type GridColumn<Row> = ValueRules & {
  key: string;
  header: string;
  label?: string;
  group?: string;
  width: number;
  frozen?: boolean;
  get?: (row: Row) => CellValue;
  render?: (value: CellValue, row: Row) => ReactNode;
  editable?: (row: Row) => boolean;
  validate?: (value: CellValue, row: Row) => string | null;
  align?: "start" | "end";
  advance?: boolean;
  derive?: (row: Row, value: (key: string) => CellValue) => CellValue;
};

export type SaveRowResult = { ok: true } | { ok: false; message?: string; fieldErrors?: Record<string, string> };

export type ConfirmClear<Row> = {
  /** One field set (a row's whole entry), or `groups` for several entries per row. */
  fields?: string[];
  groups?: Array<{ fields: string[]; label: string }>;
  /** Title of the confirmation; `labels` are the cleared groups' labels. */
  message: (row: Row, labels: string[]) => string;
  description?: string;
  confirmLabel?: string | ((labels: string[]) => string);
};

export type DataGridProps<Row> = {
  caption: string;
  rows: Row[];
  columns: GridColumn<Row>[];
  rowKey: (row: Row) => string;
  rowLabel: (row: Row) => string;
  onSaveRow?: (key: string, changes: Record<string, CellValue>, row: Row) => Promise<SaveRowResult>;
  saveDelay?: number;
  confirmClear?: ConfirmClear<Row>;
  search?: { placeholder?: string; text: (row: Row) => string };
  toolbar?: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  rowActions?: { header: string; width: number; render: (row: Row) => ReactNode };
  highlightGroup?: string;
  /** Spoken after the highlighted group's header, e.g. "periode berjalan" or "periode yang dipilih". */
  highlightNote?: string;
  /** Makes this row active and focused (deep links such as #tl-SUB-TL03). */
  focusRowKey?: string | null;
  /** Shown instead of the body when there are no rows at all (why + next action). */
  emptyState?: ReactNode;
  /** Card view for phones (< 900 px). Without it the grid scrolls on phones too. */
  phone?: ReactNode;
  maxHeight?: string;
};

const STATUS_WIDTH = 44;
const ACTIONS_KEY = "__actions";
const HEADER_ROW_HEIGHT = 36;

type NavColumn<Row> = GridColumn<Row> & { isActions?: boolean };

function readValue<Row>(row: Row, column: GridColumn<Row>): CellValue {
  if (column.get) return column.get(row);
  const value = (row as Record<string, unknown>)[column.key];
  return value === undefined ? null : (value as CellValue);
}

function isNumeric(column: { editor: ValueRules["editor"]; align?: "start" | "end" }): boolean {
  return column.align ? column.align === "end" : column.editor === "number" || column.editor === "score";
}

/** Value of a cell as displayed now: the pending edit if any, else the server value. */
function shownValue<Row>(row: Row, column: GridColumn<Row>, edits: RowEdits | undefined): CellValue {
  const edit = edits?.cells[column.key];
  if (edit && !isInvalid(edit)) return edit.value;
  return readValue(row, column);
}

/** shownValue, or for a `derive` column its value computed from the other cells as shown now. */
function cellValue<Row>(row: Row, column: GridColumn<Row>, edits: RowEdits | undefined, columns: GridColumn<Row>[]): CellValue {
  if (!column.derive) return shownValue(row, column, edits);
  return column.derive(row, (key) => {
    const source = columns.find((c) => c.key === key);
    return source ? shownValue(row, source, edits) : null;
  });
}

export function DataGrid<Row>(props: DataGridProps<Row>) {
  const narrow = useNarrowViewport();
  if (!props.phone) return <Grid {...props} />;
  if (narrow === true) return <>{props.phone}</>;
  if (narrow === false) return <Grid {...props} />;
  // Before hydration: both, CSS decides (no flash, no layout jump).
  return (
    <>
      <div className="grid:hidden">{props.phone}</div>
      <div className="hidden grid:block">
        <Grid {...props} />
      </div>
    </>
  );
}

function Grid<Row>({
  caption,
  rows,
  columns,
  rowKey,
  rowLabel,
  onSaveRow,
  saveDelay = 800,
  confirmClear,
  search,
  toolbar,
  actions,
  summary,
  rowActions,
  highlightGroup,
  highlightNote,
  focusRowKey,
  emptyState,
  maxHeight = "min(72dvh, 820px)",
}: DataGridProps<Row>) {
  const id = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle>(null);

  // ── rows, columns, search ─────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const visibleRows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q || !search) return rows;
    return rows.filter((r) => search.text(r).toLowerCase().includes(q));
  }, [rows, deferredQuery, search]);

  const navColumns = useMemo<NavColumn<Row>[]>(() => {
    const list: NavColumn<Row>[] = [...columns];
    if (rowActions) {
      list.push({ key: ACTIONS_KEY, header: rowActions.header, width: rowActions.width, editor: "readonly", isActions: true });
    }
    return list;
  }, [columns, rowActions]);

  const frozenLeft = useMemo(() => {
    const lefts: Array<number | null> = [];
    let left = STATUS_WIDTH;
    for (const column of navColumns) {
      if (column.frozen) {
        lefts.push(left);
        left += column.width;
      } else lefts.push(null);
    }
    return { lefts, total: left };
  }, [navColumns]);
  const lastFrozen = frozenLeft.lefts.reduce<number>((last, l, i) => (l !== null ? i : last), -1);
  const hasGroups = navColumns.some((c) => c.group);
  const tableWidth = navColumns.reduce((sum, c) => sum + c.width, STATUS_WIDTH);
  const headerHeight = hasGroups ? HEADER_ROW_HEIGHT * 2 : HEADER_ROW_HEIGHT;

  // ── edits store (synchronous ref + state for rendering) ──────────────────────────────
  const [edits, setEdits] = useState<EditsState>({});
  const editsRef = useRef<EditsState>({});
  const apply = useCallback((action: EditsAction) => {
    editsRef.current = editsReducer(editsRef.current, action);
    setEdits(editsRef.current);
  }, []);

  const rowsByKey = useMemo(() => new Map(rows.map((r) => [rowKey(r), r] as const)), [rows, rowKey]);
  const rowsByKeyRef = useRef(rowsByKey);
  useEffect(() => {
    rowsByKeyRef.current = rowsByKey;
    // Fresh server data: saved rows now show the server's values.
    apply({ type: "settle" });
  }, [rowsByKey, apply]);

  // ── navigation ───────────────────────────────────────────────────────────────────────
  const [nav, setNav] = useState<NavState>(initialNav);
  const navRef = useRef(nav);
  useLayoutEffect(() => {
    navRef.current = nav;
  });
  const canEdit = Boolean(onSaveRow);

  const isEditable = useCallback(
    (cell: Cell) => {
      const column = navColumns[cell.col];
      const row = visibleRows[cell.row];
      if (!canEdit || !column || !row || column.editor === "readonly") return false;
      return column.editable ? column.editable(row) : true;
    },
    [navColumns, visibleRows, canEdit],
  );
  const shape = useMemo<GridShape>(
    () => ({ rows: visibleRows.length, cols: navColumns.length, isEditable }),
    [visibleRows.length, navColumns.length, isEditable],
  );
  // Keep the active cell inside the grid when rows are filtered away.
  const clamped = clampNav(nav, shape);
  if (clamped.active.row !== nav.active.row || clamped.active.col !== nav.active.col || clamped.editing !== nav.editing) {
    setNav(clamped);
  }

  // ── autosave ─────────────────────────────────────────────────────────────────────────
  const timers = useRef(new Map<string, number>());
  const confirmed = useRef(new Set<string>());
  const [confirm, setConfirm] = useState<{
    key: string;
    message: string;
    label: string;
    description: string;
    fields: string[];
  } | null>(null);
  const clearGroups = useMemo(
    () => confirmClear?.groups ?? (confirmClear?.fields ? [{ fields: confirmClear.fields, label: "" }] : []),
    [confirmClear],
  );
  const [announcement, setAnnouncement] = useState("");

  const currentValues = useCallback(
    (row: Row) => {
      const out: Record<string, CellValue> = {};
      for (const column of columns) if (column.editor !== "readonly") out[column.key] = readValue(row, column);
      return out;
    },
    [columns],
  );

  const saveRowRef = useRef<(key: string) => Promise<void>>(async () => {});
  const schedule = useCallback((key: string, delay: number) => {
    const existing = timers.current.get(key);
    if (existing !== undefined) window.clearTimeout(existing);
    timers.current.set(
      key,
      window.setTimeout(() => {
        timers.current.delete(key);
        void saveRowRef.current(key);
      }, delay),
    );
  }, []);

  const saveRow = async (key: string) => {
    const rowEdits = editsRef.current[key];
    if (!rowEdits || rowEdits.status === "saving" || rowEdits.status === "saved" || !onSaveRow) return;
    const row = rowsByKeyRef.current.get(key);
    if (!row) {
      apply({ type: "discard", row: key });
      return;
    }
    const current = currentValues(row);
    const pending = pendingValues(rowEdits);
    const changes = changedOnly(current, pending);
    if (Object.keys(changes).length === 0) {
      // Typed back to what is stored: nothing to send.
      apply({ type: "begin", row: key });
      apply({ type: "succeed", row: key });
      return;
    }
    const cleared = confirmClear && !confirmed.current.has(key)
      ? clearedGroups(current, pending, clearGroups.map((g) => g.fields)).map((i) => clearGroups[i])
      : [];
    if (confirmClear && cleared.length > 0) {
      const labels = cleared.map((g) => g.label).filter(Boolean);
      const label = confirmClear.confirmLabel;
      setConfirm({
        key,
        message: confirmClear.message(row, labels),
        label: typeof label === "function" ? label(labels) : (label ?? "Hapus"),
        description:
          confirmClear.description ?? "Semua isian di baris ini kosong. Menyimpan baris kosong akan menghapus datanya.",
        fields: cleared.flatMap((g) => g.fields),
      });
      return;
    }
    confirmed.current.delete(key);
    apply({ type: "begin", row: key });
    const label = rowLabel(row);
    let result: SaveRowResult;
    try {
      result = await onSaveRow(key, changes, row);
    } catch {
      result = { ok: false, message: "Koneksi ke server terputus. Isian tetap ada; coba simpan lagi." };
    }
    if (result.ok) {
      apply({ type: "succeed", row: key });
      setAnnouncement(`${label} tersimpan.`);
      if (editsRef.current[key]?.status === "dirty") schedule(key, saveDelay);
    } else {
      apply({ type: "fail", row: key, message: result.message ?? "Gagal menyimpan.", fieldErrors: result.fieldErrors });
      setAnnouncement(`Gagal menyimpan ${label}: ${result.message ?? "coba lagi"}.`);
    }
  };
  useLayoutEffect(() => {
    saveRowRef.current = saveRow;
  });

  useEffect(() => {
    const pendingTimers = timers.current;
    return () => {
      for (const t of pendingTimers.values()) window.clearTimeout(t);
    };
  }, []);

  // Leaving a row saves it at once.
  const lastRowKey = useRef<string | null>(null);
  const activeRowKey = visibleRows[nav.active.row] ? rowKey(visibleRows[nav.active.row]) : null;
  useEffect(() => {
    const previous = lastRowKey.current;
    lastRowKey.current = activeRowKey;
    if (previous && previous !== activeRowKey && editsRef.current[previous]?.status === "dirty") schedule(previous, 0);
  }, [activeRowKey, schedule]);

  /** Parses typed or pasted text into the cell. Returns what happened, for paste summaries. */
  const commitText = useCallback(
    (cell: Cell, text: string): "saved" | "invalid" | "unchanged" | "locked" => {
      const row = visibleRows[cell.row];
      const column = navColumns[cell.col];
      if (!row || !column || !isEditable(cell)) return "locked";
      const key = rowKey(row);
      const parsed = parseCell(column, text);
      let edit: CellEdit;
      if (parsed.ok) {
        const extra = column.validate?.(parsed.value, row) ?? null;
        edit = extra ? { raw: text, error: extra } : { value: parsed.value };
      } else {
        edit = { raw: text, error: parsed.message };
      }
      const previous = editsRef.current[key]?.cells[column.key];
      if ("value" in edit) {
        const same = previous
          ? !isInvalid(previous) && sameValue(previous.value, edit.value)
          : sameValue(edit.value, readValue(row, column));
        if (same) return "unchanged";
      }
      apply({ type: "edit", row: key, field: column.key, edit });
      schedule(key, saveDelay);
      return "value" in edit ? "saved" : "invalid";
    },
    [visibleRows, navColumns, isEditable, rowKey, apply, schedule, saveDelay],
  );

  const retry = useCallback(
    (key: string) => {
      apply({ type: "retry", row: key });
      schedule(key, 0);
    },
    [apply, schedule],
  );

  /** "Batal" on the delete confirmation: the cleared cells come back; other edits still save. */
  const cancelClear = () => {
    if (confirm) {
      apply({ type: "revert", row: confirm.key, fields: confirm.fields });
      if (editsRef.current[confirm.key]) schedule(confirm.key, 0);
    }
    setConfirm(null);
  };

  const unsaved = unsavedRows(edits);
  const failed = unsaved.filter((k) => edits[k]?.status === "error");

  // Leaving with unsaved rows asks first: tab close / reload, and in-app links.
  useEffect(() => {
    if (unsaved.length === 0) return;
    const message = `Ada ${unsaved.length} baris belum tersimpan. Tinggalkan halaman ini?`;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: globalThis.MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || event.defaultPrevented) return;
      if (new URL(link.href, window.location.href).origin !== window.location.origin) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [unsaved.length]);

  // ── focus follows the active cell once the grid has been used ───────────────────────
  const engaged = useRef(false);
  useEffect(() => {
    if (!engaged.current || nav.editing) return;
    const cell = tableRef.current?.querySelector<HTMLElement>(`[data-r="${nav.active.row}"][data-c="${nav.active.col}"]`);
    if (!cell) return;
    if (document.activeElement !== cell) cell.focus({ preventScroll: true });
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [nav]);

  // Deep link: make the requested row active; the effect above focuses and scrolls to it.
  useEffect(() => {
    if (!focusRowKey) return;
    const row = visibleRows.findIndex((r) => rowKey(r) === focusRowKey);
    if (row < 0) return;
    const frame = window.requestAnimationFrame(() => {
      engaged.current = true;
      setNav({ active: { row, col: 0 }, anchor: null, editing: null });
    });
    return () => window.cancelAnimationFrame(frame);
    // Only when the requested key changes, not on every refresh of the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRowKey]);

  // Current period: scroll its group into view once.
  useEffect(() => {
    if (!highlightGroup) return;
    const index = navColumns.findIndex((c) => c.group === highlightGroup);
    const scroller = scrollRef.current;
    if (index < 0 || !scroller) return;
    const offset = navColumns.slice(0, index).reduce((sum, c) => sum + c.width, STATUS_WIDTH);
    scroller.scrollLeft = Math.max(0, offset - frozenLeft.total);
  }, [highlightGroup, navColumns, frozenLeft.total]);

  // ── events ───────────────────────────────────────────────────────────────────────────
  const cellFrom = (target: EventTarget | null): Cell | null => {
    const el = (target as HTMLElement | null)?.closest?.("[data-cell]") as HTMLElement | null;
    if (!el || !tableRef.current?.contains(el)) return null;
    return { row: Number(el.dataset.r), col: Number(el.dataset.c) };
  };

  const commitEditor = useCallback(() => {
    const state = navRef.current;
    // No editor handle: it is unmounting after a keyboard commit (a late blur); nothing to do.
    if (!state.editing || !editorRef.current) return;
    commitText(state.active, editorRef.current?.text() ?? "");
    setNav({ ...state, editing: null });
    engaged.current = true;
  }, [commitText]);

  const cancelEditor = useCallback(() => {
    setNav((s) => ({ ...s, editing: null }));
  }, []);

  const activateCell = (cell: Cell) => {
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-r="${cell.row}"][data-c="${cell.col}"]`);
    el?.querySelector<HTMLElement>("button, a[href]")?.click();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    // Controls inside a cell (row actions) keep their own keys; Escape returns to the cell.
    if (target.closest("[data-grid-control]")) {
      if (event.key === "Escape") {
        event.preventDefault();
        target.closest<HTMLElement>("[data-cell]")?.focus();
      }
      return;
    }
    engaged.current = true;
    const result = navKey(nav, event, shape);
    if (!result.handled) return;
    event.preventDefault();
    const effect = result.effect;

    if (result.state.editing && !nav.editing) {
      const column = navColumns[nav.active.col];
      const initial = result.state.editing.initial;
      // A dropdown opens with the typed key as its type-ahead (CellEditor), so "DPS-01" or a
      // name typed in full picks the right option.
      // Single-key entry: commit the typed character now; a valid value moves one cell right.
      if (column.advance && initial !== null) {
        const outcome = commitText(nav.active, initial);
        let col = nav.active.col;
        if (outcome !== "invalid") {
          // Next input cell to the right (computed cells are skipped); stay at the row's end.
          for (let c = col + 1; c < shape.cols; c++) {
            if (shape.isEditable({ row: nav.active.row, col: c })) {
              col = c;
              break;
            }
          }
        }
        setNav({ active: { row: nav.active.row, col }, anchor: null, editing: null });
        return;
      }
      // Long text always edits in place (arrows move the caret).
      if (column.editor === "longtext") {
        setNav({ ...result.state, editing: { mode: "edit", initial } });
        return;
      }
    }

    if (effect.type === "commit") commitText(nav.active, editorRef.current?.text() ?? "");
    if (effect.type === "clear") {
      for (const cell of effect.cells) commitText(cell, "");
      setAnnouncement(`${effect.cells.length} sel dikosongkan.`);
    }
    if (effect.type === "activate") activateCell(nav.active);
    setNav(result.state);
  };

  const dragging = useRef(false);
  const onMouseDown = (event: MouseEvent<HTMLTableElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".dg-editor, .dg-popover")) return;
    const cell = cellFrom(target);
    if (!cell) return;
    engaged.current = true;
    if (nav.editing && (cell.row !== nav.active.row || cell.col !== nav.active.col)) {
      commitText(nav.active, editorRef.current?.text() ?? "");
    }
    if (target.closest("[data-grid-control]")) {
      setNav(navClick(nav, cell, shape));
      return;
    }
    setNav(navClick({ ...nav, editing: null }, cell, shape, { shift: event.shiftKey }));
    dragging.current = !event.shiftKey;
  };
  const onMouseOver = (event: MouseEvent<HTMLTableElement>) => {
    if (!dragging.current || event.buttons !== 1) return;
    const cell = cellFrom(event.target);
    if (cell && (cell.row !== nav.active.row || cell.col !== nav.active.col)) {
      setNav((s) => ({ active: cell, anchor: s.anchor ?? s.active, editing: null }));
    }
  };
  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);
  const onDoubleClick = (event: MouseEvent<HTMLTableElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".dg-editor, .dg-popover, [data-grid-control]")) return;
    const cell = cellFrom(target);
    if (cell) setNav(navClick(nav, cell, shape, { double: true }));
  };

  const textOf = (cell: Cell): string => {
    const row = visibleRows[cell.row];
    const column = navColumns[cell.col];
    if (!row || !column || column.isActions) return "";
    const edit = edits[rowKey(row)]?.cells[column.key];
    if (edit && isInvalid(edit)) return edit.raw;
    const value = cellValue(row, column, edits[rowKey(row)], navColumns);
    return column.editor === "readonly" ? displayValue(column, value) : valueToText(column, value);
  };

  const onCopy = (event: ClipboardEvent<HTMLTableElement>) => {
    if (nav.editing) return;
    const { top, bottom, left, right } = selectionBounds(nav);
    const lines: string[][] = [];
    for (let r = top; r <= bottom; r++) {
      const line: string[] = [];
      for (let c = left; c <= right; c++) line.push(textOf({ row: r, col: c }));
      lines.push(line);
    }
    event.clipboardData.setData("text/plain", toTsv(lines));
    event.preventDefault();
    const count = (bottom - top + 1) * (right - left + 1);
    setAnnouncement(`${count} sel disalin.`);
  };

  const onPaste = (event: ClipboardEvent<HTMLTableElement>) => {
    if (nav.editing || !canEdit) return;
    const block = parseTsv(event.clipboardData.getData("text/plain"));
    if (block.length === 0) return;
    event.preventDefault();
    engaged.current = true;
    let pasted = 0;
    let skipped = 0;
    let invalid = 0;
    const put = (cell: Cell, text: string) => {
      if (cell.row >= shape.rows || cell.col >= shape.cols) return;
      const outcome = commitText(cell, text);
      if (outcome === "locked") skipped += 1;
      else pasted += 1;
      if (outcome === "invalid") invalid += 1;
    };
    const bounds = selectionBounds(nav);
    const single = block.length === 1 && block[0].length === 1;
    const multiSelection = bounds.bottom > bounds.top || bounds.right > bounds.left;
    if (single && multiSelection) {
      for (let r = bounds.top; r <= bounds.bottom; r++) for (let c = bounds.left; c <= bounds.right; c++) put({ row: r, col: c }, block[0][0]);
    } else {
      block.forEach((line, i) => line.forEach((text, j) => put({ row: nav.active.row + i, col: nav.active.col + j }, text)));
    }
    const parts = [`${pasted} sel ditempel`];
    if (invalid > 0) parts.push(`${invalid} tidak valid (ditandai merah, tidak disimpan)`);
    if (skipped > 0) parts.push(`${skipped} dilewati karena tidak bisa diubah`);
    setAnnouncement(`${parts.join(", ")}.`);
  };

  // ── render ───────────────────────────────────────────────────────────────────────────
  const selection = selectionBounds(nav);
  const multi = selection.bottom > selection.top || selection.right > selection.left;
  const anyEditable = canEdit && columns.some((c) => c.editor !== "readonly");

  const groups: Array<{ group: string | null; span: number; start: number }> = [];
  navColumns.forEach((column, i) => {
    const last = groups[groups.length - 1];
    const group = column.group ?? null;
    if (last && group !== null && last.group === group) last.span += 1;
    else groups.push({ group, span: 1, start: i });
  });

  const stickyHead = (i: number, top: number) => {
    const left = frozenLeft.lefts[i];
    return left !== null ? { top, left } : { top };
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-3 grid:flex-row grid:flex-wrap grid:items-end grid:justify-between" data-print="hide">
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          {toolbar}
          {search ? (
            <label className="flex flex-col gap-1">
              <span className="section-label">Cari</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={search.placeholder ?? "Cari nama atau ID"}
                className="min-h-10 w-56 rounded-control border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-muted hover:border-ink"
              />
            </label>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {summary ? <p className="text-sm text-ink-muted">{summary}</p> : null}
          <p className={cx("text-sm font-semibold", failed.length > 0 ? "text-critical" : "text-ink")} aria-live="polite">
            {unsaved.length > 0 ? `Belum tersimpan: ${unsaved.length} baris` : ""}
          </p>
          {failed.length > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => failed.forEach(retry)}>
              Simpan ulang {failed.length} baris
            </Button>
          ) : null}
          {actions}
        </div>
      </div>

      {anyEditable ? <GridLegend /> : null}

      <div
        ref={scrollRef}
        className="dg-scroll rounded-panel border border-line"
        style={{ maxHeight, scrollPaddingLeft: frozenLeft.total, scrollPaddingTop: headerHeight }}
      >
        <table
          ref={tableRef}
          role="grid"
          aria-label={caption}
          aria-rowcount={visibleRows.length + (hasGroups ? 2 : 1)}
          aria-colcount={navColumns.length + 1}
          aria-multiselectable={multi || undefined}
          aria-describedby={`${id}-help`}
          className="dg"
          data-editable-grid={anyEditable ? "" : undefined}
          style={{ width: tableWidth }}
          onKeyDown={onKeyDown}
          onMouseDown={onMouseDown}
          onMouseOver={onMouseOver}
          onDoubleClick={onDoubleClick}
          onCopy={onCopy}
          onPaste={onPaste}
          onFocus={() => {
            engaged.current = true;
          }}
        >
          <colgroup>
            <col style={{ width: STATUS_WIDTH }} />
            {navColumns.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr role="row" aria-rowindex={1}>
              <th
                role="columnheader"
                aria-colindex={1}
                rowSpan={hasGroups ? 2 : 1}
                data-frozen=""
                className="dg-status"
                style={{ top: 0, left: 0 }}
              >
                <span className="sr-only">Status simpan</span>
              </th>
              {hasGroups
                ? groups.map((g) =>
                    g.group === null ? (
                      <HeaderCell
                        key={navColumns[g.start].key}
                        column={navColumns[g.start]}
                        index={g.start}
                        rowSpan={2}
                        style={stickyHead(g.start, 0)}
                        frozenLast={g.start === lastFrozen}
                        highlight={false}
                      />
                    ) : (
                      <th
                        key={`g-${g.start}`}
                        role="columnheader"
                        colSpan={g.span}
                        data-group=""
                        data-highlight={g.group === highlightGroup ? "" : undefined}
                        style={{ top: 0 }}
                      >
                        {g.group}
                        {g.group === highlightGroup && highlightNote ? <span className="sr-only"> ({highlightNote})</span> : null}
                      </th>
                    ),
                  )
                : navColumns.map((c, i) => (
                    <HeaderCell
                      key={c.key}
                      column={c}
                      index={i}
                      rowSpan={1}
                      style={stickyHead(i, 0)}
                      frozenLast={i === lastFrozen}
                      highlight={false}
                    />
                  ))}
            </tr>
            {hasGroups ? (
              <tr role="row" aria-rowindex={2}>
                {navColumns.map((c, i) =>
                  c.group ? (
                    <HeaderCell
                      key={c.key}
                      column={c}
                      index={i}
                      rowSpan={1}
                      style={stickyHead(i, HEADER_ROW_HEIGHT)}
                      frozenLast={i === lastFrozen}
                      highlight={c.group === highlightGroup}
                    />
                  ) : null,
                )}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr role="row">
                <td role="gridcell" colSpan={navColumns.length + 1} className="!h-auto !whitespace-normal">
                  <div className="sticky left-0 max-w-[calc(100vw-4rem)] py-6">
                    {rows.length === 0 ? (
                      emptyState
                    ) : (
                      <p className="text-sm text-ink">
                        Tidak ada baris yang cocok dengan &ldquo;{deferredQuery}&rdquo;. Ubah kata pencarian.
                      </p>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              visibleRows.map((row, r) => {
                const key = rowKey(row);
                const isActiveRow = nav.active.row === r;
                const inSelection = r >= selection.top && r <= selection.bottom;
                return (
                  <GridRow
                    key={key}
                    row={row}
                    rowIndex={r}
                    rowLabelText={isActiveRow ? rowLabel(row) : ""}
                    columns={navColumns}
                    frozenLefts={frozenLeft.lefts}
                    lastFrozen={lastFrozen}
                    edits={edits[key]}
                    activeCol={isActiveRow ? nav.active.col : -1}
                    selLeft={inSelection && multi ? selection.left : -1}
                    selRight={inSelection && multi ? selection.right : -1}
                    editingMode={isActiveRow && nav.editing ? nav.editing.mode : null}
                    editingInitial={isActiveRow && nav.editing ? nav.editing.initial : null}
                    canEdit={canEdit}
                    headerRows={hasGroups ? 2 : 1}
                    highlightGroup={highlightGroup ?? null}
                    rowActions={rowActions?.render}
                    editorRef={editorRef}
                    onCommitEditor={commitEditor}
                    onCancelEditor={cancelEditor}
                    onRetry={retry}
                    rowKeyValue={key}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p id={`${id}-help`} className="sr-only">
        Tabel isian. Panah untuk pindah sel, ketik atau Enter untuk mengisi, Enter untuk menyimpan sel dan turun, Escape
        untuk batal, Tab di kolom terakhir keluar dari tabel.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <Dialog
        open={confirm !== null}
        onClose={cancelClear}
        title={confirm?.message ?? ""}
        description={confirm?.description}
        footer={
          <>
            <Button variant="secondary" onClick={cancelClear}>
              Batal, kembalikan isian
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!confirm) return;
                confirmed.current.add(confirm.key);
                const key = confirm.key;
                setConfirm(null);
                void saveRowRef.current(key);
              }}
            >
              {confirm?.label ?? "Hapus"}
            </Button>
          </>
        }
      />
    </div>
  );
}

function HeaderCell<Row>({
  column,
  index,
  rowSpan,
  style,
  frozenLast,
  highlight,
}: {
  column: NavColumn<Row>;
  index: number;
  rowSpan: number;
  style: React.CSSProperties;
  frozenLast: boolean;
  highlight: boolean;
}) {
  return (
    <th
      role="columnheader"
      aria-colindex={index + 2}
      rowSpan={rowSpan}
      title={column.label ?? undefined}
      data-frozen={column.frozen ? "" : undefined}
      data-frozen-last={frozenLast ? "" : undefined}
      data-numeric={isNumeric(column) ? "" : undefined}
      data-highlight={highlight ? "" : undefined}
      style={style}
    >
      {column.header}
      {column.label && column.label !== column.header ? <span className="sr-only">, {column.label}</span> : null}
    </th>
  );
}

type GridRowProps<Row> = {
  row: Row;
  rowIndex: number;
  rowLabelText: string;
  columns: NavColumn<Row>[];
  frozenLefts: Array<number | null>;
  lastFrozen: number;
  edits: RowEdits | undefined;
  activeCol: number;
  selLeft: number;
  selRight: number;
  editingMode: "enter" | "edit" | null;
  editingInitial: string | null;
  canEdit: boolean;
  headerRows: number;
  highlightGroup: string | null;
  rowActions?: (row: Row) => ReactNode;
  editorRef: React.RefObject<EditorHandle | null>;
  onCommitEditor: () => void;
  onCancelEditor: () => void;
  onRetry: (key: string) => void;
  rowKeyValue: string;
};

/**
 * The two-item cell legend of an editable grid (DESIGN.md Tokens): white cells are input,
 * sunken cells are computed. Shown in the toolbar row under the filters.
 */
export function GridLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted" data-print="hide">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block size-3.5 rounded-status border border-line-strong bg-surface" />
        Isian
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block size-3.5 rounded-status border border-line bg-surface-sunken" />
        Dihitung otomatis
      </span>
    </p>
  );
}

const STATUS_VIEW: Record<RowEdits["status"], { mark: string; text: string; tone: string }> = {
  dirty: { mark: "•", text: "Belum tersimpan", tone: "text-ink-muted" },
  saving: { mark: "…", text: "Menyimpan", tone: "text-ink-muted" },
  saved: { mark: "✓", text: "Tersimpan", tone: "text-good" },
  error: { mark: "!", text: "Gagal menyimpan", tone: "text-critical" },
};

function GridRowImpl<Row>({
  row,
  rowIndex,
  rowLabelText,
  columns,
  frozenLefts,
  lastFrozen,
  edits,
  activeCol,
  selLeft,
  selRight,
  editingMode,
  editingInitial,
  canEdit,
  headerRows,
  highlightGroup,
  rowActions,
  editorRef,
  onCommitEditor,
  onCancelEditor,
  onRetry,
  rowKeyValue,
}: GridRowProps<Row>) {
  const status = edits ? STATUS_VIEW[edits.status] : null;
  const invalidCells = hasInvalid(edits);
  return (
    <tr role="row" aria-rowindex={rowIndex + headerRows + 1}>
      <td role="gridcell" aria-colindex={1} className="dg-status" data-frozen="" style={{ left: 0 }}>
        {edits?.status === "error" ? (
          <button
            type="button"
            tabIndex={-1}
            title={`${edits.message ?? "Gagal menyimpan"}. Klik untuk simpan ulang.`}
            onClick={() => onRetry(rowKeyValue)}
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-control bg-critical-tint px-1 text-xs font-semibold text-critical hover:bg-critical hover:text-white"
          >
            <span aria-hidden="true">!</span>
            <span className="sr-only">Gagal menyimpan: {edits.message}. Simpan ulang</span>
          </button>
        ) : status ? (
          <span className={cx("text-sm font-semibold", invalidCells ? "text-critical" : status.tone)} title={invalidCells ? "Ada isian tidak valid" : status.text}>
            <span aria-hidden="true">{invalidCells ? "!" : status.mark}</span>
            <span className="sr-only">{invalidCells ? "Ada isian tidak valid" : status.text}</span>
          </span>
        ) : null}
      </td>
      {columns.map((column, c) => {
        const isActive = c === activeCol;
        const selected = selLeft >= 0 && c >= selLeft && c <= selRight;
        const editable =
          canEdit && column.editor !== "readonly" && !column.isActions && (column.editable ? column.editable(row) : true);
        const edit = edits?.cells[column.key];
        const invalidEdit = edit && isInvalid(edit) ? edit : null;
        const value = cellValue(row, column, edits, columns);
        const message = invalidEdit?.error ?? edits?.fieldErrors[column.key] ?? null;
        const editing = isActive && editingMode !== null && editable;
        const left = frozenLefts[c];
        const text = invalidEdit ? invalidEdit.raw : displayValue(column, value);
        const Tag = c === 0 && column.frozen ? "th" : "td";
        const spoken =
          isActive && rowLabelText
            ? `${rowLabelText}, ${column.label ?? column.header}: ${text || "kosong"}${message ? `, tidak valid: ${message}` : ""}${
                editable ? "" : column.isActions ? "" : ", hanya baca"
              }`
            : undefined;

        return (
          <Tag
            key={column.key}
            role={Tag === "th" ? "rowheader" : "gridcell"}
            scope={Tag === "th" ? "row" : undefined}
            aria-colindex={c + 2}
            aria-selected={selected || isActive ? true : undefined}
            aria-readonly={!editable && !column.isActions ? true : undefined}
            aria-invalid={message ? true : undefined}
            aria-label={spoken}
            tabIndex={isActive ? 0 : -1}
            data-cell=""
            data-r={rowIndex}
            data-c={c}
            data-active={isActive ? "" : undefined}
            data-selected={selected ? "" : undefined}
            data-editable={editable ? "" : undefined}
            data-invalid={message ? "" : undefined}
            data-numeric={isNumeric(column) ? "" : undefined}
            data-frozen={left !== null ? "" : undefined}
            data-frozen-last={c === lastFrozen ? "" : undefined}
            data-group-current={highlightGroup && column.group === highlightGroup ? "" : undefined}
            title={message ?? (column.editor === "longtext" && text.length > 24 ? text : undefined)}
            style={left !== null ? { left } : undefined}
            className={Tag === "th" ? "font-semibold" : undefined}
          >
            {column.isActions ? (
              <span data-grid-control="" className="flex items-center gap-1">
                {rowActions?.(row)}
              </span>
            ) : (
              <span className="dg-text">{column.render && !invalidEdit ? column.render(value, row) : text}</span>
            )}
            {editing ? (
              <CellEditor
                ref={editorRef}
                rules={column}
                initialText={editorInitialText(
                  editingMode ? { mode: editingMode, initial: editingInitial } : null,
                  valueToText(column, value),
                )}
                label={spoken ?? column.header}
                onCommit={onCommitEditor}
                onCancel={onCancelEditor}
              />
            ) : null}
            {isActive && message && !editing ? (
              <span className="dg-message" role="tooltip">
                {message}
              </span>
            ) : null}
          </Tag>
        );
      })}
    </tr>
  );
}

const GridRow = memo(GridRowImpl) as <Row>(props: GridRowProps<Row>) => ReactElement;
