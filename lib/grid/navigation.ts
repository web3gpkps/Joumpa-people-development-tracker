/*
 * Keyboard model of the spreadsheet grid (docs/UX.md §2) as a pure reducer.
 *
 * Not editing:
 *   arrows move; Shift+arrows extend the selection; Home / End jump within the row;
 *   Ctrl/Cmd+Home / End go to the first / last cell; PageUp / PageDown move 10 rows;
 *   Tab / Shift+Tab move right / left within the row (at the row's edge the browser takes
 *   Tab, so focus can leave the grid); Enter or F2 starts editing; a printable key starts
 *   editing and replaces the value; Delete / Backspace clears the selection; Escape
 *   collapses the selection.
 * Editing:
 *   Enter commits and moves down (Shift+Enter up); Tab / Shift+Tab commit and move;
 *   Escape cancels. In "enter" mode (started by typing) arrows commit and move, as in
 *   Excel; in "edit" mode (F2, Enter, double click) arrows move the caret.
 *
 * The reducer decides; the component performs (focus, commit to the edits store, clear).
 */

export type Cell = { row: number; col: number };

export type NavState = {
  active: Cell;
  /** Other corner of a range selection; null = just the active cell. */
  anchor: Cell | null;
  /** null when not editing. */
  editing: { mode: "enter" | "edit"; initial: string | null } | null;
};

export type GridShape = {
  rows: number;
  cols: number;
  /** Whether a cell may be edited (readonly columns, locked rows). */
  isEditable: (cell: Cell) => boolean;
};

export type KeyInput = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

/** What the component must do after a key. `handled: false` lets the browser act (e.g. Tab out). */
export type NavEffect =
  | { type: "none" }
  | { type: "commit"; then: Cell | null }
  | { type: "cancel" }
  | { type: "clear"; cells: Cell[] }
  | { type: "activate" };

export type NavResult = { state: NavState; effect: NavEffect; handled: boolean };

export const PAGE_ROWS = 10;

export function initialNav(): NavState {
  return { active: { row: 0, col: 0 }, anchor: null, editing: null };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampCell(cell: Cell, shape: GridShape): Cell {
  return { row: clamp(cell.row, 0, Math.max(0, shape.rows - 1)), col: clamp(cell.col, 0, Math.max(0, shape.cols - 1)) };
}

/** Rows and columns covered by the selection, inclusive. */
export function selectionBounds(state: Pick<NavState, "active" | "anchor">): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const a = state.active;
  const b = state.anchor ?? state.active;
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.col, b.col),
    right: Math.max(a.col, b.col),
  };
}

export function selectedCells(state: Pick<NavState, "active" | "anchor">): Cell[] {
  const { top, bottom, left, right } = selectionBounds(state);
  const cells: Cell[] = [];
  for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) cells.push({ row, col });
  return cells;
}

/** A single printable character (what starts "enter" mode). */
export function isPrintable(input: KeyInput): boolean {
  return input.key.length === 1 && !input.ctrlKey && !input.metaKey && !input.altKey;
}

function moveTo(state: NavState, next: Cell, shape: GridShape, extend: boolean): NavState {
  const active = clampCell(next, shape);
  return { active, anchor: extend ? (state.anchor ?? state.active) : null, editing: null };
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/** Applies one key press. */
export function navKey(state: NavState, input: KeyInput, shape: GridShape): NavResult {
  const none = (s: NavState, handled = true): NavResult => ({ state: s, effect: { type: "none" }, handled });
  if (shape.rows === 0 || shape.cols === 0) return none(state, false);
  const { active } = state;
  const ctrl = Boolean(input.ctrlKey || input.metaKey);

  if (state.editing) {
    const commitTo = (target: Cell | null): NavResult => ({
      state: { active: target ? clampCell(target, shape) : active, anchor: null, editing: null },
      effect: { type: "commit", then: target ? clampCell(target, shape) : null },
      handled: true,
    });
    switch (input.key) {
      case "Escape":
        return { state: { ...state, editing: null }, effect: { type: "cancel" }, handled: true };
      case "Enter":
        return commitTo({ row: active.row + (input.shiftKey ? -1 : 1), col: active.col });
      case "Tab":
        return commitTo({ row: active.row, col: active.col + (input.shiftKey ? -1 : 1) });
      default:
        if (state.editing.mode === "enter" && ARROWS[input.key]) {
          const [dr, dc] = ARROWS[input.key];
          return commitTo({ row: active.row + dr, col: active.col + dc });
        }
        // Everything else is typing inside the editor.
        return none(state, false);
    }
  }

  if (ARROWS[input.key]) {
    const [dr, dc] = ARROWS[input.key];
    if (ctrl) {
      const edge: Cell = {
        row: dr === 0 ? active.row : dr < 0 ? 0 : shape.rows - 1,
        col: dc === 0 ? active.col : dc < 0 ? 0 : shape.cols - 1,
      };
      return none(moveTo(state, edge, shape, Boolean(input.shiftKey)));
    }
    return none(moveTo(state, { row: active.row + dr, col: active.col + dc }, shape, Boolean(input.shiftKey)));
  }

  switch (input.key) {
    case "Home":
      return none(moveTo(state, ctrl ? { row: 0, col: 0 } : { row: active.row, col: 0 }, shape, Boolean(input.shiftKey)));
    case "End":
      return none(
        moveTo(
          state,
          ctrl ? { row: shape.rows - 1, col: shape.cols - 1 } : { row: active.row, col: shape.cols - 1 },
          shape,
          Boolean(input.shiftKey),
        ),
      );
    case "PageDown":
      return none(moveTo(state, { row: active.row + PAGE_ROWS, col: active.col }, shape, Boolean(input.shiftKey)));
    case "PageUp":
      return none(moveTo(state, { row: active.row - PAGE_ROWS, col: active.col }, shape, Boolean(input.shiftKey)));
    case "Tab": {
      const col = active.col + (input.shiftKey ? -1 : 1);
      // At the row's edge, let the browser move focus out of the grid (no keyboard trap).
      if (col < 0 || col >= shape.cols) return none({ ...state, anchor: null }, false);
      return none(moveTo(state, { row: active.row, col }, shape, false));
    }
    case "Escape":
      return state.anchor ? none({ ...state, anchor: null }) : none(state, false);
    case "Enter":
    case "F2":
      if (!shape.isEditable(active)) {
        return { state, effect: { type: "activate" }, handled: true };
      }
      return none({ ...state, anchor: null, editing: { mode: "edit", initial: null } });
    case "Delete":
    case "Backspace": {
      const cells = selectedCells(state).filter(shape.isEditable);
      return { state, effect: cells.length > 0 ? { type: "clear", cells } : { type: "none" }, handled: true };
    }
    default:
      if (isPrintable(input) && input.key !== " " && shape.isEditable(active)) {
        return none({ ...state, anchor: null, editing: { mode: "enter", initial: input.key } });
      }
      if (input.key === " " && !shape.isEditable(active)) {
        return { state, effect: { type: "activate" }, handled: true };
      }
      return none(state, false);
  }
}

/**
 * Text an editor opens with: the typed key when editing started by typing (whatever the
 * mode, so long text keeps its first character), else the cell's current text.
 */
export function editorInitialText(editing: NavState["editing"], current: string): string {
  return editing && editing.initial !== null ? editing.initial : current;
}

/** A click: select the cell (Shift extends), double click starts editing. */
export function navClick(state: NavState, cell: Cell, shape: GridShape, opts: { shift?: boolean; double?: boolean } = {}): NavState {
  const next = moveTo(state, cell, shape, Boolean(opts.shift));
  if (opts.double && shape.isEditable(next.active)) {
    return { ...next, anchor: null, editing: { mode: "edit", initial: null } };
  }
  return next;
}

/** Keeps the state inside the grid after rows are filtered or removed. */
export function clampNav(state: NavState, shape: GridShape): NavState {
  return {
    active: clampCell(state.active, shape),
    anchor: state.anchor ? clampCell(state.anchor, shape) : null,
    editing: state.editing && shape.rows > 0 ? state.editing : null,
  };
}
