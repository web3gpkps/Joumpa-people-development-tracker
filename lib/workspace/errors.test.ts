import { describe, expect, test } from 'bun:test';
import { GENERIC_SAVE_ERROR, toLinkError } from './errors';

describe('toLinkError', () => {
  test('invalid input names the field in Indonesian, never the column', () => {
    const e = toLinkError({ message: 'invalid_input', code: '22023', details: 'height_cm' });
    expect(e).toEqual({ code: 'invalid_input', field: 'height_cm', message: 'Tinggi badan tidak valid. Periksa lagi isinya.' });
    expect(toLinkError({ code: '22023', details: 'score_c' }).message).toBe('Nilai C tidak valid. Periksa lagi isinya.');
    expect(toLinkError({ code: '22023', details: 'some_new_column' }).message).not.toContain('some_new_column');
  });

  test('unknown database failures use the generic message, without the raw text', () => {
    const e = toLinkError({ message: 'duplicate key value violates unique constraint "x_pkey"' });
    expect(e).toEqual({ code: 'unknown', message: GENERIC_SAVE_ERROR });
  });

  test('scope errors keep their plain message', () => {
    expect(toLinkError({ message: 'out_of_scope' }).code).toBe('out_of_scope');
    expect(toLinkError({ message: 'forbidden_field' }).message).toBe('Isian ini hanya bisa diubah oleh KPS.');
  });
});
