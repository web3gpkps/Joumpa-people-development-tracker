import { describe, expect, test } from 'bun:test';
import { formatHariTanggal, formatJam } from './dates';
import {
  formatDecimal,
  formatProgress,
  formatRatio,
  formatScore,
  formatSignedKg,
  formatSignedScore,
  relativeDays,
  toInputText,
} from './format';

describe('format', () => {
  test('Indonesian decimal comma, blank for no value', () => {
    expect(formatScore(3.8333)).toBe('3,83');
    expect(formatScore(null)).toBe('');
    expect(formatDecimal(165.5, 1)).toBe('165,5');
    expect(formatDecimal(82, 0, 2)).toBe('82');
    expect(formatDecimal(1234.5, 1)).toBe('1234,5');
    expect(formatRatio(0.4)).toBe('40%');
    expect(formatProgress(12.5)).toBe('12,5%');
    expect(toInputText(165.5)).toBe('165,5');
    expect(toInputText(null)).toBe('');
  });

  test('signed values', () => {
    expect(formatSignedScore(0.5)).toBe('+0,50');
    expect(formatSignedScore(0)).toBe('0,00');
    expect(formatSignedKg(-0.5)).toBe('-0,5');
    expect(formatSignedKg(1.2)).toBe('+1,2');
  });

  test('relative days and dates', () => {
    expect(relativeDays(-3)).toBe('lewat 3 hari');
    expect(relativeDays(0)).toBe('hari ini');
    expect(relativeDays(1)).toBe('besok');
    expect(relativeDays(5)).toBe('5 hari lagi');
    expect(formatHariTanggal('2026-10-12')).toBe('Senin, 12 Okt 2026');
    expect(formatJam('2026-10-08T17:05:00Z')).toBe('00.05');
  });
});
