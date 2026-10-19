import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SETTINGS as S,
  actionDaysLeft,
  actionFlag,
  bmi,
  bmiCategory,
  bmiCheckDate,
  bmiPeriodForWeek,
  bmiSummary,
  camelize,
  consistency,
  criteriaStatus,
  daysLeft,
  deltaVsBaseline,
  effectiveDueDate,
  excelRound,
  heightRequirement,
  inferDueRule,
  practiceAvg,
  replacementPass,
  replacementTimeliness,
  reportGroupOf,
  rollingDueDate,
  staffBaseline,
  staffRekap,
  weekEnd,
  weekOfDate,
  weekStart,
  weeklyStatus,
  type ActionItemRow,
  type ScoreFields,
  type Settings,
  type WeeklyScoreRow,
} from './rules';

const sc = (...s: Array<number | null>): ScoreFields => ({
  scoreA: s[0] ?? null,
  scoreB: s[1] ?? null,
  scoreC: s[2] ?? null,
  scoreD: s[3] ?? null,
  scoreE: s[4] ?? null,
  scoreF: s[5] ?? null,
});

// The three rolling schedules exactly as written in the workbook (TL10, TL12, TL13).
const SCHEDULE_TL10 = 'Tanggal 5 setiap bulan (batas = jatuh tempo berikutnya)';
const SCHEDULE_TL12 = 'Per 2 minggu: 12 Okt, 26 Okt, 9 Nov, 23 Nov, 7 Des 2026 (batas = cek berikutnya)';
const SCHEDULE_TL13 = 'Setiap Jumat, 16 Okt – 18 Des 2026 (batas = Jumat berikutnya)';

describe('excelRound (Excel ROUND: half away from zero, 15 significant digits)', () => {
  test('ties that binary floating point gets wrong', () => {
    expect(excelRound(3.335, 2)).toBe(3.34);
    expect((3.335).toFixed(2)).toBe('3.33'); // why this function exists
    expect(excelRound(1.005, 2)).toBe(1.01);
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(excelRound(2.675, 2)).toBe(2.68);
    expect(excelRound(18.45, 1)).toBe(18.5);
    expect(excelRound(73.8 / 4, 1)).toBe(18.5); // BMI of 73.8 kg at 200 cm
    expect((73.8 / 4).toFixed(1)).toBe('18.4');
  });
  test('negative ties go away from zero', () => {
    expect(excelRound(-2.5)).toBe(-3);
    expect(Math.round(-2.5)).toBe(-2);
    expect(excelRound(-1.005, 2)).toBe(-1.01);
    expect(excelRound(-0.004, 2)).toBe(0);
    expect(Object.is(excelRound(-0.004, 2), -0)).toBe(false);
  });
  test('ordinary values', () => {
    expect(excelRound(2.5)).toBe(3);
    expect(excelRound(20 / 6, 2)).toBe(3.33);
    expect(excelRound(23 / 6, 2)).toBe(3.83);
    expect(excelRound(25 / 6, 2)).toBe(4.17);
    expect(excelRound(25.78125, 1)).toBe(25.8);
    expect(excelRound(1234.5, -1)).toBe(1230);
    expect(excelRound(0)).toBe(0);
  });
});

describe('practiceAvg (Master SDM P, Log L)', () => {
  test('mean of non-empty scores, 2 dp; null when none', () => {
    expect(practiceAvg(sc())).toBeNull();
    expect(practiceAvg([])).toBeNull();
    expect(practiceAvg(sc(4, 2, 2, 2, 3, 2))).toBe(2.5);
    expect(practiceAvg(sc(4, 3, 3, 4, 3, 3))).toBe(3.33);
    expect(practiceAvg(sc(4, 4, 4, 4, 4, 3))).toBe(3.83); // Petunjuk example
    expect(practiceAvg(sc(4, 4, 4, null, null, null))).toBe(4); // AVERAGE ignores blanks
    expect(practiceAvg([5, null, undefined, 4])).toBe(4.5);
  });
});

describe('criteriaStatus (Master SDM R, Rekap S)', () => {
  test('thresholds on the rounded average', () => {
    expect(criteriaStatus(null, 90, S)).toBeNull();
    expect(criteriaStatus(2.99, 90, S)).toBe('Tidak Sesuai');
    expect(criteriaStatus(3, 90, S)).toBe('Perlu Perbaikan');
    expect(criteriaStatus(3.99, 90, S)).toBe('Perlu Perbaikan');
    expect(criteriaStatus(4, 80, S)).toBe('Sesuai');
    expect(criteriaStatus(4, 100, S)).toBe('Sesuai');
  });
  test('post-test only matters for Sesuai; missing post-test passes (SUB)', () => {
    expect(criteriaStatus(4, null, S)).toBe('Sesuai');
    expect(criteriaStatus(4, undefined, S)).toBe('Sesuai');
    expect(criteriaStatus(4.5, 79, S)).toBe('Perlu Perbaikan');
    expect(criteriaStatus(2.5, 100, S)).toBe('Tidak Sesuai');
    expect(criteriaStatus(3, 72, S)).toBe('Perlu Perbaikan'); // KNO case: report says Tidak Sesuai
  });
  test('weeklyStatus ignores the post-test', () => {
    expect(weeklyStatus(null, S)).toBeNull();
    expect(weeklyStatus(4, S)).toBe('Sesuai');
    expect(weeklyStatus(3.83, S)).toBe('Perlu Perbaikan');
    expect(weeklyStatus(2.17, S)).toBe('Tidak Sesuai');
  });
  test('thresholds come from settings', () => {
    const strict: Settings = { ...S, passAvgMin: 4.5, improveAvgMin: 3.5, posttestMin: 90 };
    expect(criteriaStatus(4.33, null, strict)).toBe('Perlu Perbaikan');
    expect(criteriaStatus(3.33, null, strict)).toBe('Tidak Sesuai');
    expect(criteriaStatus(4.5, 85, strict)).toBe('Perlu Perbaikan');
  });
});

describe('consistency (Master SDM S: LEFT(x,6) comparison)', () => {
  test('report conclusion vs criteria', () => {
    expect(consistency('Sesuai dengan Catatan', 'Sesuai')).toBe('OK');
    expect(consistency('Sesuai dengan Catatan', 'Perlu Perbaikan')).toBe('Beda – verifikasi');
    expect(consistency('Tidak Sesuai', 'Perlu Perbaikan')).toBe('Beda – verifikasi');
    expect(consistency('Perlu Perbaikan', 'Perlu Perbaikan')).toBe('OK');
    expect(consistency('perlu perbaikan', 'Perlu Perbaikan')).toBe('OK'); // Excel = is case-insensitive
  });
  test('either side missing → null', () => {
    expect(consistency(null, 'Sesuai')).toBeNull();
    expect(consistency('', 'Sesuai')).toBeNull();
    expect(consistency('Sesuai', null)).toBeNull();
  });
  test('staffBaseline bundles P, R, S', () => {
    expect(staffBaseline({ ...sc(4, 3, 4, 4, 3, 3), postTest: 90, reportConclusion: 'Sesuai' }, S)).toEqual({
      practiceAvg: 3.5,
      criteriaStatus: 'Perlu Perbaikan',
      consistency: 'Beda – verifikasi',
    });
  });
});

describe('weeks', () => {
  test('weekStart / weekEnd / weekOfDate', () => {
    expect(weekStart(1, S)).toBe('2026-10-12');
    expect(weekStart(10, S)).toBe('2026-12-14');
    expect(weekEnd(1, S)).toBe('2026-10-18');
    expect(weekOfDate('2026-10-11', S)).toBeNull();
    expect(weekOfDate('2026-10-12', S)).toBe(1);
    expect(weekOfDate('2026-10-18', S)).toBe(1);
    expect(weekOfDate('2026-11-02', S)).toBe(4);
    expect(weekOfDate('2026-12-20', S)).toBe(10);
    expect(weekOfDate('2026-12-21', S)).toBeNull();
  });
  test('deltaVsBaseline (Log N)', () => {
    expect(deltaVsBaseline(3.83, 3.33)).toBe(0.5);
    expect(deltaVsBaseline(null, 3.33)).toBeNull();
    expect(deltaVsBaseline(3.83, null)).toBeNull();
  });
});

describe('staffRekap (Rekap Performa)', () => {
  const st = { code: 'X-01', postTest: 90, ...sc(4, 3, 3, 4, 3, 3) }; // baseline 3.33
  const w = (week: number, ...s: Array<number | null>): WeeklyScoreRow => ({ staffCode: 'X-01', week, ...sc(...s) });

  test('no weekly scores', () => {
    const r = staffRekap(st, [], S);
    expect(r).toMatchObject({ baselineAvg: 3.33, latest: null, latestWeek: null, gain: null, weeksAssessed: 0, currentStatus: null, trend: null });
    expect(r.weekly).toHaveLength(10);
  });
  test('latest = last week with a score (LOOKUP 9.99E+307), gaps allowed', () => {
    const r = staffRekap(st, [w(1, 3, 3, 3, 3, 3, 3), w(3, 4, 4, 4, 4, 4, 4), w(5), { ...w(2, 5, 5, 5, 5, 5, 5), staffCode: 'OTHER' }], S);
    expect(r.weekly.slice(0, 5)).toEqual([3, null, 4, null, null]);
    expect(r.latest).toBe(4);
    expect(r.latestWeek).toBe(3);
    expect(r.weeksAssessed).toBe(2);
    expect(r.gain).toBe(0.67);
    expect(r.trend).toBe('▲ Naik');
    expect(r.currentStatus).toBe('Sesuai');
  });
  test('current status uses the training post-test; trend down / same', () => {
    expect(staffRekap({ ...st, postTest: 70 }, [w(2, 4, 4, 4, 4, 4, 4)], S).currentStatus).toBe('Perlu Perbaikan');
    expect(staffRekap(st, [w(1, 3, 3, 3, 3, 3, 3)], S).trend).toBe('▼ Turun');
    expect(staffRekap(st, [w(1, 4, 3, 3, 4, 3, 3)], S).trend).toBe('= Tetap');
  });
  test('baseline missing → no gain/trend but status still computed', () => {
    const r = staffRekap({ ...st, ...sc() }, [w(1, 4, 4, 4, 4, 4, 4)], S);
    expect(r).toMatchObject({ baselineAvg: null, latest: 4, gain: null, trend: null, currentStatus: 'Sesuai' });
  });
  test('weeks outside 1…settings.weeks are ignored; duplicate rows average like AVERAGEIFS', () => {
    const r = staffRekap(st, [w(11, 5, 5, 5, 5, 5, 5), w(0, 5), w(2, 4, 3, 3, 3, 3, 4), w(2, 4, 3, 3, 3, 4, 3), w(2, 4, 4, 3, 3, 3, 3)], S);
    expect(r.latestWeek).toBe(2);
    expect(r.latest).toBeCloseTo(3.33, 12); // (3.33 + 3.33 + 3.33) / 3
    const two = staffRekap(st, [w(1, 4, 3, 3, 3, 3, 4), w(1, 4, 3, 3, 4, 3, 4)], S);
    expect(two.latest).toBeCloseTo(3.415, 12); // not re-rounded, as in the workbook
  });
});

describe('BMI', () => {
  test('bmi = ROUND(w/(h/100)^2, 1); null when an input is missing', () => {
    expect(bmi(160, 66)).toBe(25.8); // Petunjuk example
    expect(bmi(200, 73.8)).toBe(18.5); // toFixed(1) gives 18.4
    expect(bmi(170, 78.1)).toBe(27); // 27.02
    expect(bmi(null, 60)).toBeNull();
    expect(bmi(160, null)).toBeNull();
    expect(bmi(0, 60)).toBeNull();
  });
  test('category boundaries (inclusive upper bounds) on the rounded BMI', () => {
    expect(bmiCategory(null, S)).toBeNull();
    expect(bmiCategory(18.4, S)).toBe('Kurus');
    expect(bmiCategory(18.5, S)).toBe('Normal');
    expect(bmiCategory(25, S)).toBe('Normal');
    expect(bmiCategory(25.1, S)).toBe('Overweight');
    expect(bmiCategory(27, S)).toBe('Overweight');
    expect(bmiCategory(27.1, S)).toBe('Obesitas');
    expect(bmiCategory(bmi(200, 73.8), S)).toBe('Normal');
  });
  test('heightRequirement (AJ)', () => {
    const withMins: Settings = { ...S, minHeightFemale: 155, minHeightMale: 165 };
    expect(heightRequirement(null, 'P', withMins)).toBeNull();
    expect(heightRequirement(160, null, withMins)).toBeNull();
    expect(heightRequirement(160, '', withMins)).toBeNull();
    expect(heightRequirement(160, 'P', S)).toBe('Isi standar di Parameter');
    expect(heightRequirement(155, 'P', withMins)).toBe('Memenuhi');
    expect(heightRequirement(154.9, 'P', withMins)).toBe('Tidak Memenuhi');
    expect(heightRequirement(160, 'p', withMins)).toBe('Memenuhi');
    expect(heightRequirement(160, 'L', withMins)).toBe('Tidak Memenuhi');
    expect(heightRequirement(165, 'L', withMins)).toBe('Memenuhi');
    expect(heightRequirement(160, 'P', { ...S, minHeightMale: 165 })).toBe('Isi standar di Parameter');
  });
  test('bmiSummary: latest values from the highest period, Δ vs first weight', () => {
    const r = bmiSummary(
      [
        { staffCode: 'X', period: 3, heightCm: 160, weightKg: 63.5 },
        { staffCode: 'X', period: 1, heightCm: 160, weightKg: 66, checkDate: '2026-10-12' },
        { staffCode: 'X', period: 7, heightCm: 160, weightKg: 50 }, // outside bmiPeriods (5)
      ],
      'P',
      S,
    );
    expect(r.periods.map((p) => p?.bmi ?? null)).toEqual([25.8, null, 24.8, null, null]);
    expect(r.periods[0]?.category).toBe('Overweight');
    expect(r).toMatchObject({ latestHeight: 160, latestWeight: 63.5, latestBmi: 24.8, latestCategory: 'Normal', weightDelta: -2.5 });
    expect(r.heightRequirement).toBe('Isi standar di Parameter');
  });
  test('bmiSummary: single check → Δ 0; no checks → all null', () => {
    expect(bmiSummary([{ staffCode: 'X', period: 2, heightCm: 170, weightKg: 70 }], null, S).weightDelta).toBe(0);
    const none = bmiSummary([], 'L', S);
    expect(none).toMatchObject({ latestHeight: null, latestWeight: null, latestBmi: null, latestCategory: null, weightDelta: null, heightRequirement: null });
    expect(bmiSummary([{ staffCode: 'X', period: 1, heightCm: 170.2, weightKg: 70.1 }, { staffCode: 'X', period: 2, heightCm: 170.2, weightKg: 69.3 }], null, S).weightDelta).toBe(-0.8);
  });
  test('check dates and the BMI period of a report week', () => {
    expect(bmiCheckDate(1, S)).toBe('2026-10-12');
    expect(bmiCheckDate(2, S)).toBe('2026-10-26');
    expect(bmiCheckDate(5, S)).toBe('2026-12-07');
    expect([1, 2, 3, 4, 5, 9, 10, 12].map((w) => bmiPeriodForWeek(w, S))).toEqual([1, 1, 2, 2, 3, 5, 5, 5]);
  });
});

describe('Tindak Lanjut', () => {
  const item = (o: Partial<ActionItemRow>): ActionItemRow => ({
    code: 'T',
    reportGroup: 'SUB',
    kind: 'Sekali',
    dueDate: '2026-10-10',
    status: 'Belum Mulai',
    progress: 0,
    ...o,
  });
  const today = '2026-10-07';

  test('daysLeft: due − today; null when Selesai or no due date', () => {
    expect(daysLeft('2026-10-10', 'Belum Mulai', today)).toBe(3);
    expect(daysLeft('2026-10-07', 'On Progress', today)).toBe(0);
    expect(daysLeft('2026-10-01', 'Tertunda', today)).toBe(-6);
    expect(daysLeft('2026-10-01', 'Selesai', today)).toBeNull();
    expect(daysLeft(null, 'Belum Mulai', today)).toBeNull();
  });

  test('actionFlag order: Selesai, no due, overdue, ≤ 7 days (even Rutin), Rutin, On Track', () => {
    expect(actionFlag(item({ status: 'Selesai', dueDate: '2026-09-01' }), S, today)).toBe('Selesai');
    expect(actionFlag(item({ status: 'Selesai', dueDate: null }), S, today)).toBe('Selesai');
    expect(actionFlag(item({ dueDate: null }), S, today)).toBeNull();
    expect(actionFlag(item({ dueDate: '2026-10-06' }), S, today)).toBe('OVERDUE');
    expect(actionFlag(item({ dueDate: '2026-10-07' }), S, today)).toBe('Jatuh tempo ≤ 7 hari'); // due today
    expect(actionFlag(item({ dueDate: '2026-10-14' }), S, today)).toBe('Jatuh tempo ≤ 7 hari');
    expect(actionFlag(item({ dueDate: '2026-10-14', kind: 'Rutin' }), S, today)).toBe('Jatuh tempo ≤ 7 hari');
    expect(actionFlag(item({ dueDate: '2026-10-15', kind: 'Rutin' }), S, today)).toBe('Rutin – pantau');
    expect(actionFlag(item({ dueDate: '2026-10-06', kind: 'Rutin' }), S, today)).toBe('OVERDUE');
    expect(actionFlag(item({ dueDate: '2026-10-15' }), S, today)).toBe('On Track');
    expect(actionFlag(item({ dueDate: '2026-10-15' }), S, new Date('2026-10-07T23:00:00Z'))).toBe('Jatuh tempo ≤ 7 hari'); // already 8 Oct in Jakarta
  });

  test('inferDueRule reads the workbook schedule text', () => {
    expect(inferDueRule(SCHEDULE_TL10)).toBe('bulanan-tgl-5');
    expect(inferDueRule(SCHEDULE_TL12)).toBe('cek-bmi-berikutnya');
    expect(inferDueRule(SCHEDULE_TL13)).toBe('jumat-berikutnya');
    expect(inferDueRule('Okt – Des 2026')).toBeNull();
    expect(inferDueRule('Mulai 5 Okt 2026, berkelanjutan (dipantau s.d. evaluasi ulang)')).toBeNull();
    expect(inferDueRule(null)).toBeNull();
  });

  test('rolling due dates match the workbook on 7 Oct 2026', () => {
    expect(rollingDueDate('bulanan-tgl-5', S, today)).toBe('2026-11-05');
    expect(rollingDueDate('cek-bmi-berikutnya', S, today)).toBe('2026-10-12');
    expect(rollingDueDate('jumat-berikutnya', S, today)).toBe('2026-10-16');
  });

  test('rolling: next 5th of the month', () => {
    expect(rollingDueDate('bulanan-tgl-5', S, '2026-11-05')).toBe('2026-11-05');
    expect(rollingDueDate('bulanan-tgl-5', S, '2026-11-06')).toBe('2026-12-05');
    expect(rollingDueDate('bulanan-tgl-5', S, '2026-12-31')).toBe('2027-01-05');
  });

  test('rolling: next BMI check on or after today, capped at the last period', () => {
    expect(rollingDueDate('cek-bmi-berikutnya', S, '2026-10-12')).toBe('2026-10-12');
    expect(rollingDueDate('cek-bmi-berikutnya', S, '2026-10-13')).toBe('2026-10-26');
    expect(rollingDueDate('cek-bmi-berikutnya', S, '2026-10-26')).toBe('2026-10-26');
    expect(rollingDueDate('cek-bmi-berikutnya', S, '2026-11-02')).toBe('2026-11-09');
    expect(rollingDueDate('cek-bmi-berikutnya', S, '2026-12-08')).toBe('2026-12-07'); // then OVERDUE
  });

  test('rolling: next Friday within Friday of week 1 … Friday of the last week', () => {
    expect(rollingDueDate('jumat-berikutnya', S, '2026-10-01')).toBe('2026-10-16');
    expect(rollingDueDate('jumat-berikutnya', S, '2026-10-16')).toBe('2026-10-16'); // Friday itself
    expect(rollingDueDate('jumat-berikutnya', S, '2026-10-17')).toBe('2026-10-23'); // Saturday
    expect(rollingDueDate('jumat-berikutnya', S, '2026-10-18')).toBe('2026-10-23'); // Sunday
    expect(rollingDueDate('jumat-berikutnya', S, '2026-12-19')).toBe('2026-12-18');
  });

  test('effectiveDueDate: rule beats the stored date; explicit dueRule overrides inference', () => {
    const tl12 = item({ kind: 'Rutin', schedule: SCHEDULE_TL12, dueDate: '2026-10-12' });
    expect(effectiveDueDate(tl12, S, '2026-11-02')).toBe('2026-11-09');
    expect(actionDaysLeft(tl12, S, '2026-11-02')).toBe(7);
    expect(actionFlag(tl12, S, '2026-11-02')).toBe('Jatuh tempo ≤ 7 hari'); // a stored date would say OVERDUE
    expect(effectiveDueDate({ ...tl12, dueRule: null }, S, '2026-11-02')).toBe('2026-10-12');
    expect(effectiveDueDate(item({ dueRule: 'jumat-berikutnya' }), S, '2026-11-02')).toBe('2026-11-06');
    expect(actionDaysLeft({ ...tl12, status: 'Selesai' }, S, '2026-11-02')).toBeNull();
  });
});

describe('Penggantian SDM', () => {
  const r = {
    replacedName: 'Petugas A',
    replacementName: 'Pengganti A' as string | null,
    effectiveOn: null as string | null,
    postTest: null as number | null,
    practiceAvg: null as number | null,
  };

  test('replacementPass (L)', () => {
    expect(replacementPass({ ...r, replacementName: null, postTest: 90, practiceAvg: 4 }, S)).toBeNull();
    expect(replacementPass(r, S)).toBe('Belum training/dinilai');
    expect(replacementPass({ ...r, postTest: 90 }, S)).toBe('Belum training/dinilai');
    expect(replacementPass({ ...r, postTest: 80, practiceAvg: 4 }, S)).toBe('Lulus – boleh bertugas');
    expect(replacementPass({ ...r, postTest: 79, practiceAvg: 5 }, S)).toBe('Belum lulus');
    expect(replacementPass({ ...r, postTest: 100, practiceAvg: 3.99 }, S)).toBe('Belum lulus');
  });

  test('replacementTimeliness (M): deadline day is still on time', () => {
    expect(replacementTimeliness({ ...r, replacedName: null }, S, '2026-11-15')).toBeNull();
    expect(replacementTimeliness(r, S, '2026-10-07')).toBe('Menunggu');
    expect(replacementTimeliness(r, S, '2026-10-31')).toBe('Menunggu');
    expect(replacementTimeliness(r, S, '2026-11-01')).toBe('OVERDUE');
    expect(replacementTimeliness({ ...r, effectiveOn: '2026-10-31' }, S, '2026-11-15')).toBe('Tepat waktu');
    expect(replacementTimeliness({ ...r, effectiveOn: '2026-11-01' }, S, '2026-10-07')).toBe('Lewat 31 Okt');
    expect(replacementTimeliness({ ...r, effectiveOn: '2026-11-20' }, { ...S, replacementDeadline: '2026-11-15' }, '2026-10-07')).toBe('Lewat 15 Nov');
  });
});

describe('helpers', () => {
  test('reportGroupOf', () => {
    expect(['SUB', 'DPS', 'CGK', 'HLP', 'KNO', '', null].map(reportGroupOf)).toEqual(['SUB', 'DPS', 'CGK & HLP', 'CGK & HLP', 'KNO', null, null]);
  });
  test('camelize maps DB column names to the row/settings fields', () => {
    expect(camelize({ score_a: 4, week1_start: '2026-10-12', min_height_female: null, posttest_min: 80, code: 'X' })).toEqual({
      scoreA: 4,
      week1Start: '2026-10-12',
      minHeightFemale: null,
      posttestMin: 80,
      code: 'X',
    });
  });
});
