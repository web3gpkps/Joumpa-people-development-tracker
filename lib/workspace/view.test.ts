import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '../rules';
import type { Workspace } from './index';
import { activeFirst, activeReportGroups, activeStationCodes, changedVia, lastChangedLabel, parseStation, reportGroups, ruleSettings, settingsComplete, stationCodes } from './view';

const ws = {
  scope: 'KPS',
  isKps: true,
  linkId: 'own',
  linkLabels: { other: 'PIC SUB' },
  stations: [
    { code: 'DPS', reportGroup: 'DPS', sort: 2 },
    { code: 'SUB', reportGroup: 'SUB', sort: 1 },
  ],
} as unknown as Workspace;

describe('workspace view', () => {
  test('ruleSettings keeps the Parameter BMI values and falls back to the workbook defaults', () => {
    const s = ruleSettings({ bmiPeriods: 8, bmiNormalMax: 24.9, minHeightFemale: 155 } as Workspace['settings']);
    expect(s.bmiPeriods).toBe(8);
    expect(s.bmiNormalMax).toBe(24.9);
    expect(s.minHeightFemale).toBe(155);
    expect(s.minHeightMale).toBeNull();
    expect(s.bmiFirstCheck).toBe(DEFAULT_SETTINGS.bmiFirstCheck);
    expect(settingsComplete({ bmiPeriods: 8 } as Workspace['settings'])).toBe(false);
    expect(
      settingsComplete({
        bmiFirstCheck: '2026-10-12', bmiIntervalDays: 14, bmiPeriods: 5, bmiUnderweightBelow: 18.5,
        bmiNormalMax: 25, bmiOverweightMax: 27, minHeightFemale: null, minHeightMale: null,
      } as Workspace['settings']),
    ).toBe(true);
  });

  test('report groups in station order, each once', () => {
    const groups = reportGroups({
      stations: [
        { code: 'HLP', reportGroup: 'CGK & HLP', sort: 4 },
        { code: 'CGK', reportGroup: 'CGK & HLP', sort: 3 },
        { code: 'SUB', reportGroup: 'SUB', sort: 1 },
      ],
    } as unknown as Workspace);
    expect(groups).toEqual(['SUB', 'CGK & HLP']);
  });

  test('station order and the KPS filter', () => {
    expect(stationCodes(ws)).toEqual(['SUB', 'DPS']);
    expect(parseStation(ws, 'dps')).toBe('DPS');
    expect(parseStation(ws, 'KNO')).toBeNull();
    expect(parseStation({ ...ws, isKps: false } as Workspace, 'DPS')).toBeNull();
  });

  test('last changed via', () => {
    expect(changedVia({ updatedByLink: 'own' }, ws)).toBe('tautan ini');
    expect(changedVia({ updatedByLink: 'other' }, ws)).toBe('PIC SUB');
    expect(changedVia({ updatedByLink: 'gone' }, ws)).toBe('tautan lain');
    expect(changedVia({ updatedByLink: null }, ws)).toBe('pengelola, akun cabang, atau Google Sheet');
    expect(lastChangedLabel({ updatedByLink: 'own', updatedAt: '2026-10-08T07:05:00Z' }, ws)).toBe(
      'Diubah lewat tautan ini, 8 Okt 14.05',
    );
  });

  test('filters offer the Cabang and stations that hold data, plus the caller\'s own', () => {
    const data = {
      scope: 'KPS',
      isKps: true,
      stations: [
        { code: 'SUB', reportGroup: 'SUB', sort: 1 },
        { code: 'CGK', reportGroup: 'CGK & HLP', sort: 3 },
        { code: 'HLP', reportGroup: 'CGK & HLP', sort: 4 },
        { code: 'AAP', reportGroup: 'AAP', sort: 9 },
        { code: 'BPN', reportGroup: 'BPN', sort: 8 },
      ],
      staff: [{ station: 'HLP', reportGroup: 'CGK & HLP' }],
      actionPlans: [{ reportGroup: 'BPN' }],
      replacements: [],
      monthlyReports: [],
    } as unknown as Workspace;
    expect(activeReportGroups(data)).toEqual(['CGK & HLP', 'BPN']);
    expect(activeStationCodes(data)).toEqual(['HLP']);
    expect(activeReportGroups({ ...data, isKps: false, scope: 'AAP' } as Workspace)).toEqual(['CGK & HLP', 'BPN', 'AAP']);
    expect(activeFirst(['B'], ['A', 'B', 'C'])).toEqual(['B', 'A', 'C']);
  });
});
