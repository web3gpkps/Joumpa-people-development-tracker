/*
 * Edits and per-row autosave state of the spreadsheet grid (docs/UX.md §2), as a pure
 * reducer. The component owns the timers and calls the save function; this file decides
 * what is pending, what is sent, and what the status column shows.
 *
 * Rules:
 * - Every committed cell is kept as typed: a valid value, or the raw text plus a message.
 *   Invalid cells are shown and never sent; the row's other cells still save.
 * - A row is "dirty" after an edit, "saving" while its save runs, "saved" after success,
 *   "error" after a failure (nothing typed is lost; retry resends everything pending).
 * - Edits made while a save runs are kept and saved next ("again" flag).
 * - After the server data refreshes, "saved" rows are dropped: the server rows show the
 *   saved values from then on.
 */
import { sameValue, type CellValue } from "./values";

export type CellEdit = { value: CellValue } | { raw: string; error: string };

export type RowStatus = "dirty" | "saving" | "saved" | "error";

export type RowEdits = {
  cells: Record<string, CellEdit>;
  status: RowStatus;
  /** A newer edit arrived while saving: save again when this save ends. */
  again: boolean;
  /** Row-level failure message (status "error"). */
  message: string | null;
  /** Messages from the server per field (e.g. a database range check). */
  fieldErrors: Record<string, string>;
};

export type EditsState = Record<string, RowEdits>;

export type EditsAction =
  | { type: "edit"; row: string; field: string; edit: CellEdit }
  | { type: "begin"; row: string }
  | { type: "succeed"; row: string }
  | { type: "fail"; row: string; message: string; fieldErrors?: Record<string, string> }
  | { type: "retry"; row: string }
  | { type: "discard"; row: string }
  /** Drops some pending cells of a row (e.g. a cancelled delete), keeping the others. */
  | { type: "revert"; row: string; fields: readonly string[] }
  | { type: "settle" };

export function isInvalid(edit: CellEdit): edit is { raw: string; error: string } {
  return "error" in edit;
}

/** The valid values of a row that a save sends (field → value). */
export function pendingValues(row: RowEdits | undefined): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  if (!row) return out;
  for (const [field, edit] of Object.entries(row.cells)) {
    if (!isInvalid(edit)) out[field] = edit.value;
  }
  return out;
}

export function hasInvalid(row: RowEdits | undefined): boolean {
  return Boolean(row && Object.values(row.cells).some(isInvalid));
}

export function editsReducer(state: EditsState, action: EditsAction): EditsState {
  switch (action.type) {
    case "edit": {
      const prev = state[action.row];
      const fieldErrors = { ...(prev?.fieldErrors ?? {}) };
      delete fieldErrors[action.field];
      const next: RowEdits = {
        cells: { ...(prev?.cells ?? {}), [action.field]: action.edit },
        status: prev?.status === "saving" ? "saving" : "dirty",
        again: prev?.status === "saving" ? true : false,
        message: null,
        fieldErrors,
      };
      return { ...state, [action.row]: next };
    }
    case "begin": {
      const prev = state[action.row];
      if (!prev) return state;
      return { ...state, [action.row]: { ...prev, status: "saving", again: false, message: null } };
    }
    case "succeed": {
      const prev = state[action.row];
      if (!prev) return state;
      return { ...state, [action.row]: { ...prev, status: prev.again ? "dirty" : "saved", again: false, message: null } };
    }
    case "fail": {
      const prev = state[action.row];
      if (!prev) return state;
      return {
        ...state,
        [action.row]: {
          ...prev,
          status: "error",
          again: false,
          message: action.message,
          fieldErrors: { ...prev.fieldErrors, ...(action.fieldErrors ?? {}) },
        },
      };
    }
    case "retry": {
      const prev = state[action.row];
      if (!prev || prev.status !== "error") return state;
      return { ...state, [action.row]: { ...prev, status: "dirty", message: null } };
    }
    case "discard": {
      if (!state[action.row]) return state;
      const next = { ...state };
      delete next[action.row];
      return next;
    }
    case "revert": {
      const prev = state[action.row];
      if (!prev) return state;
      const cells = { ...prev.cells };
      const fieldErrors = { ...prev.fieldErrors };
      for (const field of action.fields) {
        delete cells[field];
        delete fieldErrors[field];
      }
      const next = { ...state };
      if (Object.keys(cells).length === 0) delete next[action.row];
      else next[action.row] = { ...prev, cells, fieldErrors, status: prev.status === "saving" ? "saving" : "dirty" };
      return next;
    }
    case "settle": {
      let changed = false;
      const next: EditsState = {};
      for (const [key, row] of Object.entries(state)) {
        if (row.status === "saved" && !hasInvalid(row)) {
          changed = true;
          continue;
        }
        next[key] = row;
      }
      return changed ? next : state;
    }
  }
}

/** Rows with something not yet in the database: pending, saving, failed, or invalid cells. */
export function unsavedRows(state: EditsState): string[] {
  return Object.entries(state)
    .filter(([, row]) => row.status !== "saved" || hasInvalid(row))
    .map(([key]) => key);
}

/** True when every given field ends up blank after the row's pending values are applied. */
export function clearsAll(
  current: Record<string, CellValue>,
  pending: Record<string, CellValue>,
  fields: readonly string[],
): boolean {
  if (fields.length === 0) return false;
  return fields.every((f) => sameValue(f in pending ? pending[f] : (current[f] ?? null), null));
}

/**
 * Field groups a save would empty that hold a stored value now (each group is one entry,
 * e.g. TB + BB of one BMI period). Clearing them deletes data, so the grid asks first.
 */
export function clearedGroups(
  current: Record<string, CellValue>,
  pending: Record<string, CellValue>,
  groups: ReadonlyArray<readonly string[]>,
): number[] {
  const out: number[] = [];
  groups.forEach((fields, i) => {
    const hadValue = fields.some((f) => !sameValue(current[f] ?? null, null));
    const touched = fields.some((f) => f in pending);
    if (hadValue && touched && clearsAll(current, pending, fields)) out.push(i);
  });
  return out;
}

/** Drops pending values equal to what the server already has (nothing to send). */
export function changedOnly(
  current: Record<string, CellValue>,
  pending: Record<string, CellValue>,
): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const [field, value] of Object.entries(pending)) {
    if (!sameValue(value, current[field] ?? null)) out[field] = value;
  }
  return out;
}
