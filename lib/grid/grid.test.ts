import { describe, expect, test } from 'bun:test';
import { changedOnly, clearedGroups, clearsAll, editsReducer, pendingValues, unsavedRows, type EditsState } from './edits';
import { clampNav, editorInitialText, initialNav, navClick, navKey, selectedCells, type GridShape, type NavState } from './navigation';
import { parseTsv, toTsv } from './tsv';
import { displayValue, matchOption, parseCell, parseDateInput, sameValue, validateValue, valueToText } from './values';

describe('cell values', () => {
  test('score accepts whole numbers 1 to 5 only', () => {
    expect(parseCell({ editor: 'score' }, ' 4 ')).toEqual({ ok: true, value: 4 });
    expect(parseCell({ editor: 'score' }, '')).toEqual({ ok: true, value: null });
    for (const bad of ['0', '6', '3,5', 'x', '-1']) expect(parseCell({ editor: 'score' }, bad).ok).toBe(false);
  });

  test('number takes a decimal comma and checks range and decimals', () => {
    const tb = { editor: 'number' as const, min: 120, max: 210, decimals: 1 };
    expect(parseCell(tb, '165,5')).toEqual({ ok: true, value: 165.5 });
    expect(parseCell(tb, '165.5')).toEqual({ ok: true, value: 165.5 });
    expect(parseCell(tb, '300')).toEqual({ ok: false, message: 'Isi 120 sampai 210.' });
    expect(parseCell(tb, '165,55').ok).toBe(false);
    expect(parseCell(tb, '1.650').ok).toBe(false); // 3 decimals, not a thousands separator
    expect(parseCell({ editor: 'number', min: 0, max: 100, decimals: 0 }, '50')).toEqual({ ok: true, value: 50 });
    expect(parseCell({ editor: 'number', decimals: 0 }, '50,5')).toEqual({ ok: false, message: 'Isi bilangan bulat.' });
  });

  test('dates in Indonesian order or ISO, real calendar days only', () => {
    expect(parseDateInput('12/10/2026')).toBe('2026-10-12');
    expect(parseDateInput('1-2-2027')).toBe('2027-02-01');
    expect(parseDateInput('12.10.2026')).toBe('2026-10-12');
    expect(parseDateInput('2026-10-12')).toBe('2026-10-12');
    expect(parseDateInput('31/02/2026')).toBeNull();
    expect(parseDateInput('10/12')).toBeNull();
    expect(parseCell({ editor: 'date' }, '31/02/2026').ok).toBe(false);
  });

  test('select matches value or label, case-insensitive', () => {
    const lp = { editor: 'select' as const, options: [{ value: 'L', label: 'L' }, { value: 'P', label: 'P' }] };
    expect(parseCell(lp, 'l')).toEqual({ ok: true, value: 'L' });
    expect(parseCell(lp, 'X')).toEqual({ ok: false, message: 'Pilih salah satu: L, P.' });
    const status = { editor: 'select' as const, options: [{ value: 'On Progress' }, { value: 'Selesai' }] };
    expect(parseCell(status, 'selesai')).toEqual({ ok: true, value: 'Selesai' });
  });

  test('text trims, collapses spaces, checks length; longtext keeps line breaks', () => {
    expect(parseCell({ editor: 'text', maxLength: 5 }, '  a   b ')).toEqual({ ok: true, value: 'a b' });
    expect(parseCell({ editor: 'text', maxLength: 3 }, 'abcd').ok).toBe(false);
    expect(parseCell({ editor: 'longtext' }, 'baris 1\nbaris 2')).toEqual({ ok: true, value: 'baris 1\nbaris 2' });
    expect(parseCell({ editor: 'text', required: true }, ' ')).toEqual({ ok: false, message: 'Wajib diisi.' });
    expect(parseCell({ editor: 'readonly' }, 'x').ok).toBe(false);
  });

  test('values round-trip through their edit text and read nicely', () => {
    expect(valueToText({ editor: 'number', decimals: 1 }, 165.5)).toBe('165,5');
    expect(valueToText({ editor: 'date' }, '2026-10-12')).toBe('12/10/2026');
    expect(parseCell({ editor: 'date' }, valueToText({ editor: 'date' }, '2026-10-12'))).toEqual({ ok: true, value: '2026-10-12' });
    expect(displayValue({ editor: 'date' }, '2026-10-12')).toBe('12 Okt 2026');
    expect(displayValue({ editor: 'select', options: [{ value: 'L', label: 'Laki-laki' }] }, 'L')).toBe('Laki-laki');
    expect(displayValue({ editor: 'number' }, null)).toBe('');
    expect(validateValue({ editor: 'score' }, 7)).toBe('Isi angka bulat 1 sampai 5.');
    expect(validateValue({ editor: 'score' }, 3)).toBeNull();
    expect(sameValue(4, '4')).toBe(true);
    expect(sameValue(null, '')).toBe(true);
    expect(sameValue('a', null)).toBe(false);
  });
});

describe('clipboard TSV', () => {
  test('parses Excel / Sheets copies', () => {
    expect(parseTsv('4\t5\t3\n2\t\t1\n')).toEqual([
      ['4', '5', '3'],
      ['2', '', '1'],
    ]);
    expect(parseTsv('a\r\nb')).toEqual([['a'], ['b']]);
    expect(parseTsv('"baris 1\nbaris 2"\tx')).toEqual([['baris 1\nbaris 2', 'x']]);
    expect(parseTsv('"kata ""kutip"""')).toEqual([['kata "kutip"']]);
    expect(parseTsv('5" layar\tok')).toEqual([['5" layar', 'ok']]);
    expect(parseTsv('')).toEqual([]);
    expect(parseTsv('a\t')).toEqual([['a', '']]);
  });

  test('serialises so it pastes back cell by cell', () => {
    const rows = [
      ['165,5', 'catatan\ndua baris'],
      ['', 'tab\there "kutip"'],
    ];
    const text = toTsv(rows);
    expect(text).toBe('165,5\t"catatan\ndua baris"\n\t"tab\there ""kutip"""');
    expect(parseTsv(text)).toEqual(rows);
  });
});

describe('keyboard navigation', () => {
  // 3 rows x 4 columns; column 0 is read-only (ID), the rest editable.
  const shape: GridShape = { rows: 3, cols: 4, isEditable: (c) => c.col > 0 };
  const at = (row: number, col: number): NavState => ({ active: { row, col }, anchor: null, editing: null });

  test('arrows move and stop at the edges; Shift extends the selection', () => {
    expect(navKey(at(0, 0), { key: 'ArrowRight' }, shape).state.active).toEqual({ row: 0, col: 1 });
    expect(navKey(at(0, 0), { key: 'ArrowUp' }, shape).state.active).toEqual({ row: 0, col: 0 });
    const ext = navKey(navKey(at(0, 1), { key: 'ArrowDown', shiftKey: true }, shape).state, { key: 'ArrowRight', shiftKey: true }, shape).state;
    expect(ext.anchor).toEqual({ row: 0, col: 1 });
    expect(selectedCells(ext)).toHaveLength(4);
    expect(navKey(ext, { key: 'Escape' }, shape).state.anchor).toBeNull();
  });

  test('Home, End, Ctrl+End and PageDown', () => {
    expect(navKey(at(1, 2), { key: 'Home' }, shape).state.active).toEqual({ row: 1, col: 0 });
    expect(navKey(at(1, 2), { key: 'End' }, shape).state.active).toEqual({ row: 1, col: 3 });
    expect(navKey(at(0, 0), { key: 'End', ctrlKey: true }, shape).state.active).toEqual({ row: 2, col: 3 });
    expect(navKey(at(0, 1), { key: 'PageDown' }, shape).state.active).toEqual({ row: 2, col: 1 });
  });

  test('Tab moves within the row and lets the browser leave at the edge', () => {
    const r = navKey(at(0, 1), { key: 'Tab' }, shape);
    expect(r.state.active).toEqual({ row: 0, col: 2 });
    expect(r.handled).toBe(true);
    expect(navKey(at(0, 3), { key: 'Tab' }, shape).handled).toBe(false);
    expect(navKey(at(0, 0), { key: 'Tab', shiftKey: true }, shape).handled).toBe(false);
  });

  test('typing starts enter mode with the key; F2 and Enter start edit mode', () => {
    const typed = navKey(at(0, 1), { key: '4' }, shape).state;
    expect(typed.editing).toEqual({ mode: 'enter', initial: '4' });
    expect(navKey(at(0, 1), { key: 'F2' }, shape).state.editing).toEqual({ mode: 'edit', initial: null });
    expect(navKey(at(0, 1), { key: 'Enter' }, shape).state.editing?.mode).toBe('edit');
    // Read-only cells do not edit; Enter activates (e.g. a button in the cell).
    expect(navKey(at(0, 0), { key: '4' }, shape).state.editing).toBeNull();
    expect(navKey(at(0, 0), { key: 'Enter' }, shape).effect).toEqual({ type: 'activate' });
    // Modifier shortcuts are not typing.
    expect(navKey(at(0, 1), { key: 'c', ctrlKey: true }, shape).handled).toBe(false);
  });

  test('while editing: Enter commits down, Tab commits right, Escape cancels', () => {
    const editing: NavState = { ...at(0, 1), editing: { mode: 'edit', initial: null } };
    expect(navKey(editing, { key: 'Enter' }, shape)).toMatchObject({
      state: { active: { row: 1, col: 1 }, editing: null },
      effect: { type: 'commit', then: { row: 1, col: 1 } },
    });
    expect(navKey(editing, { key: 'Tab' }, shape).effect).toEqual({ type: 'commit', then: { row: 0, col: 2 } });
    expect(navKey(editing, { key: 'Escape' }, shape)).toMatchObject({ state: { editing: null }, effect: { type: 'cancel' } });
    // Edit mode: arrows belong to the caret. Enter mode: arrows commit and move.
    expect(navKey(editing, { key: 'ArrowLeft' }, shape).handled).toBe(false);
    const entering: NavState = { ...at(0, 1), editing: { mode: 'enter', initial: '4' } };
    expect(navKey(entering, { key: 'ArrowDown' }, shape).effect).toEqual({ type: 'commit', then: { row: 1, col: 1 } });
    // Enter on the last row commits and stays inside the grid.
    expect(navKey({ ...at(2, 1), editing: { mode: 'edit', initial: null } }, { key: 'Enter' }, shape).state.active).toEqual({ row: 2, col: 1 });
  });

  test('Delete clears only the editable cells of the selection', () => {
    const sel: NavState = { active: { row: 1, col: 1 }, anchor: { row: 0, col: 0 }, editing: null };
    const r = navKey(sel, { key: 'Delete' }, shape);
    expect(r.effect).toEqual({ type: 'clear', cells: [{ row: 0, col: 1 }, { row: 1, col: 1 }] });
  });

  test('clicks select, Shift+click extends, double click edits', () => {
    expect(navClick(initialNav(), { row: 2, col: 2 }, shape).active).toEqual({ row: 2, col: 2 });
    expect(navClick(at(0, 1), { row: 1, col: 2 }, shape, { shift: true }).anchor).toEqual({ row: 0, col: 1 });
    expect(navClick(at(0, 1), { row: 1, col: 2 }, shape, { double: true }).editing?.mode).toBe('edit');
    expect(navClick(at(0, 1), { row: 1, col: 0 }, shape, { double: true }).editing).toBeNull();
  });

  test('clampNav keeps the active cell inside a filtered grid', () => {
    const s = clampNav(at(2, 3), { ...shape, rows: 1 });
    expect(s.active).toEqual({ row: 0, col: 3 });
    expect(clampNav({ ...at(2, 3), editing: { mode: 'edit', initial: null } }, { ...shape, rows: 0 }).editing).toBeNull();
  });
});

describe('edits and autosave', () => {
  const edit = (s: EditsState, field: string, value: number | null) =>
    editsReducer(s, { type: 'edit', row: 'SUB-01', field, edit: { value } });

  test('edit, save, succeed, settle', () => {
    let s = edit({}, 'score_a', 4);
    expect(s['SUB-01'].status).toBe('dirty');
    expect(unsavedRows(s)).toEqual(['SUB-01']);
    s = editsReducer(s, { type: 'begin', row: 'SUB-01' });
    expect(s['SUB-01'].status).toBe('saving');
    s = editsReducer(s, { type: 'succeed', row: 'SUB-01' });
    expect(s['SUB-01'].status).toBe('saved');
    expect(unsavedRows(s)).toEqual([]);
    expect(editsReducer(s, { type: 'settle' })).toEqual({});
  });

  test('an edit during a save is saved next, not lost', () => {
    let s = editsReducer(edit({}, 'score_a', 4), { type: 'begin', row: 'SUB-01' });
    s = edit(s, 'score_b', 5);
    expect(s['SUB-01']).toMatchObject({ status: 'saving', again: true });
    s = editsReducer(s, { type: 'succeed', row: 'SUB-01' });
    expect(s['SUB-01'].status).toBe('dirty');
    expect(pendingValues(s['SUB-01'])).toEqual({ score_a: 4, score_b: 5 });
  });

  test('failure keeps what was typed and the server field errors; a new edit clears that field error', () => {
    let s = editsReducer(edit({}, 'height_cm', 300), { type: 'begin', row: 'SUB-01' });
    s = editsReducer(s, { type: 'fail', row: 'SUB-01', message: 'Ditolak', fieldErrors: { height_cm: 'Isi 120 sampai 210.' } });
    expect(s['SUB-01']).toMatchObject({ status: 'error', message: 'Ditolak', fieldErrors: { height_cm: 'Isi 120 sampai 210.' } });
    expect(pendingValues(s['SUB-01'])).toEqual({ height_cm: 300 });
    expect(unsavedRows(s)).toEqual(['SUB-01']);
    const retried = editsReducer(s, { type: 'retry', row: 'SUB-01' });
    expect(retried['SUB-01']).toMatchObject({ status: 'dirty', message: null });
    expect(pendingValues(retried['SUB-01'])).toEqual({ height_cm: 300 });
    s = edit(s, 'height_cm', 165);
    expect(s['SUB-01'].fieldErrors).toEqual({});
    expect(s['SUB-01'].status).toBe('dirty');
    expect(editsReducer(s, { type: 'retry', row: 'SUB-01' })).toBe(s); // only failed rows retry
  });

  test('invalid cells are shown, never sent, and keep the row unsaved after settle', () => {
    let s = edit({}, 'score_a', 4);
    s = editsReducer(s, { type: 'edit', row: 'SUB-01', field: 'score_b', edit: { raw: '7', error: 'Isi angka bulat 1 sampai 5.' } });
    expect(pendingValues(s['SUB-01'])).toEqual({ score_a: 4 });
    s = editsReducer(editsReducer(s, { type: 'begin', row: 'SUB-01' }), { type: 'succeed', row: 'SUB-01' });
    s = editsReducer(s, { type: 'settle' });
    expect(Object.keys(s)).toEqual(['SUB-01']);
    expect(unsavedRows(s)).toEqual(['SUB-01']);
    expect(editsReducer(s, { type: 'discard', row: 'SUB-01' })).toEqual({});
  });

  test('clearsAll and changedOnly', () => {
    const current = { tb: 165, bb: 60 };
    expect(clearsAll(current, { tb: null, bb: null }, ['tb', 'bb'])).toBe(true);
    expect(clearsAll(current, { tb: null }, ['tb', 'bb'])).toBe(false);
    expect(clearsAll({}, {}, [])).toBe(false);
    expect(changedOnly(current, { tb: 165, bb: 61 })).toEqual({ bb: 61 });
  });
});

describe('phase 2 fixes', () => {
  test('typing on a dropdown matches the ID first, then the name', () => {
    const staff = [
      { value: 'SUB-01', label: 'Dimas (SUB-01)' },
      { value: 'DPS-01', label: 'Ayu (DPS-01)' },
    ];
    expect(matchOption(staff, 'D')?.value).toBe('DPS-01');
    expect(matchOption(staff, 'dps-01')?.value).toBe('DPS-01');
    expect(matchOption(staff, 'Dim')?.value).toBe('SUB-01');
    expect(matchOption(staff, 'ayu')?.value).toBe('DPS-01');
    expect(matchOption(staff, 'x')).toBeNull();
    expect(matchOption([{ value: 'L' }, { value: 'P' }], 'p')?.value).toBe('P');
  });

  test('the first typed key reaches the editor, long text included', () => {
    const shape: GridShape = { rows: 2, cols: 2, isEditable: () => true };
    const typed = navKey(initialNav(), { key: 'Q' }, shape).state.editing;
    expect(editorInitialText(typed, 'lama')).toBe('Q');
    // Long text switches to "edit" mode (arrows move the caret) but keeps the typed key.
    expect(editorInitialText({ mode: 'edit', initial: 'Q' }, 'lama')).toBe('Q');
    expect(editorInitialText({ mode: 'edit', initial: null }, 'lama')).toBe('lama');
  });

  test('cleared groups and reverting a cancelled delete', () => {
    const current = { tb_1: 165, bb_1: 60, tb_2: 170, bb_2: 70, note: null };
    const groups = [['tb_1', 'bb_1'], ['tb_2', 'bb_2']];
    expect(clearedGroups(current, { tb_1: null, bb_1: null, note: 'x' }, groups)).toEqual([0]);
    expect(clearedGroups(current, { tb_1: null }, groups)).toEqual([]);
    expect(clearedGroups({ tb_1: null, bb_1: null }, { tb_1: null, bb_1: null }, [['tb_1', 'bb_1']])).toEqual([]);

    let state: EditsState = {};
    for (const [field, value] of [['tb_1', null], ['bb_1', null], ['note', 'x']] as const) {
      state = editsReducer(state, { type: 'edit', row: 'SUB-01', field, edit: { value } });
    }
    state = editsReducer(state, { type: 'revert', row: 'SUB-01', fields: ['tb_1', 'bb_1'] });
    expect(pendingValues(state['SUB-01'])).toEqual({ note: 'x' });
    expect(state['SUB-01'].status).toBe('dirty');
    state = editsReducer(state, { type: 'revert', row: 'SUB-01', fields: ['note'] });
    expect(state['SUB-01']).toBeUndefined();
  });
});
