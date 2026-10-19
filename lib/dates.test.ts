import { describe, expect, test } from 'bun:test';
import {
  addDays,
  dayOfWeek,
  diffDays,
  formatTanggal,
  formatTanggalPendek,
  isValidIsoDate,
  makeDate,
  toIsoDate,
} from './dates';

describe('isValidIsoDate', () => {
  test('accepts complete calendar dates in 2000..2100', () => {
    expect(isValidIsoDate('2026-10-12')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
  });
  test('rejects half-typed years, impossible days and non-strings without throwing', () => {
    expect(isValidIsoDate('0002-10-25')).toBe(false);
    expect(isValidIsoDate('1999-12-31')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-10-1')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
    expect(isValidIsoDate(20261012)).toBe(false);
  });
});

describe('dates', () => {
  test('toIsoDate keeps ISO dates and reads Date in Asia/Jakarta', () => {
    expect(toIsoDate('2026-10-07')).toBe('2026-10-07');
    // 20:00 UTC on 7 Oct is 03:00 on 8 Oct in Jakarta (UTC+7).
    expect(toIsoDate(new Date('2026-10-07T20:00:00Z'))).toBe('2026-10-08');
    expect(toIsoDate(new Date('2026-10-07T16:59:59Z'))).toBe('2026-10-07');
    expect(toIsoDate('2026-10-07T17:00:00Z')).toBe('2026-10-08');
    expect(() => toIsoDate('2026-02-30')).toThrow();
    expect(() => toIsoDate('07/10/2026x')).toThrow();
  });

  test('day arithmetic', () => {
    expect(addDays('2026-10-12', 63)).toBe('2026-12-14');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-10-10', '2026-10-07')).toBe(3);
    expect(diffDays('2026-10-07', '2026-10-10')).toBe(-3);
    expect(dayOfWeek('2026-10-12')).toBe(1); // Monday
    expect(dayOfWeek('2026-10-16')).toBe(5); // Friday
  });

  test('makeDate rolls over like Excel DATE()', () => {
    expect(makeDate(2026, 13, 5)).toBe('2027-01-05');
    expect(makeDate(2026, 10, 5)).toBe('2026-10-05');
  });

  test('Indonesian formatting', () => {
    expect(formatTanggal('2026-10-12')).toBe('12 Okt 2026');
    expect(formatTanggal('2026-08-01')).toBe('1 Agu 2026');
    expect(formatTanggalPendek('2026-10-31')).toBe('31 Okt');
  });
});
