-- Data validation at the table level (what the Sheets sync relies on to reject bad cells),
-- plus the action_items.due_rule / replacements.staff_code additions.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into public.staff (code, station, name) values ('TST-SUB', 'SUB', 'Uji Sub');

-- staff
select throws_ok($$update public.staff set gender = 'X' where code = 'TST-SUB'$$, '23514', null, 'staff.gender must be L/P/NULL');
select throws_ok($$update public.staff set score_a = 6 where code = 'TST-SUB'$$, '23514', null, 'staff scores are 1..5');
select throws_ok($$update public.staff set post_test = 101 where code = 'TST-SUB'$$, '23514', null, 'post_test is 0..100');
select throws_ok($$update public.staff set report_conclusion = 'Bagus' where code = 'TST-SUB'$$, '23514', null, 'report_conclusion is enumerated');
select throws_ok($$update public.staff set assignment_status = 'Cuti' where code = 'TST-SUB'$$, '23514', null, 'assignment_status is enumerated');
select throws_ok($$insert into public.staff (code, station, name) values ('TST-X', 'XXX', 'x')$$, '23503', null, 'staff.station must be a known station');
select is((select assignment_status from public.staff where code = 'TST-SUB'), 'Aktif', 'assignment_status defaults to Aktif');

-- weekly_scores
select throws_ok($$insert into public.weekly_scores (staff_code, week, score_a) values ('TST-SUB', 1, 7)$$, '23514', null, 'weekly score 7 is rejected');
select throws_ok($$insert into public.weekly_scores (staff_code, week) values ('TST-SUB', 21)$$, '23514', null, 'week is 1..20');
select lives_ok($$insert into public.weekly_scores (staff_code, week, score_a) values ('TST-SUB', 1, 5)$$, 'valid weekly score');
select throws_ok($$insert into public.weekly_scores (staff_code, week) values ('TST-SUB', 1)$$, '23505', null, 'one row per staff x week');

-- bmi_checks
select throws_ok($$insert into public.bmi_checks (staff_code, period, height_cm, weight_kg) values ('TST-SUB', 53, 170, 60)$$, '23514', null, 'period is 1..52');
select throws_ok($$insert into public.bmi_checks (staff_code, period, height_cm, weight_kg) values ('TST-SUB', 1, null, 60)$$, '23502', null, 'height is required on a stored check');

-- action_items
select throws_ok($$insert into public.action_items (code, report_group, status) values ('TST-TL01', 'SUB', 'Batal')$$, '23514', null, 'action status is enumerated');
select throws_ok($$insert into public.action_items (code, report_group, kind) values ('TST-TL01', 'SUB', 'Harian')$$, '23514', null, 'action kind is Sekali/Rutin');
select throws_ok($$insert into public.action_items (code, report_group, progress) values ('TST-TL01', 'SUB', 101)$$, '23514', null, 'progress is 0..100');
select throws_ok($$insert into public.action_items (code, report_group) values ('TST-TL01', 'CGK')$$, '23514', null, 'report_group is SUB/DPS/CGK & HLP/KNO');
select throws_ok($$insert into public.action_items (code, report_group, due_rule) values ('TST-TL01', 'SUB', 'tiap-hari')$$, '23514', null, 'due_rule is enumerated');
select lives_ok(
  $$insert into public.action_items (code, report_group, due_rule) values
      ('TST-TL10', 'SUB', 'bulanan-tgl-5'), ('TST-TL12', 'CGK & HLP', 'cek-bmi-berikutnya'),
      ('TST-TL13', 'KNO', 'jumat-berikutnya'), ('TST-TL01', 'DPS', null)$$,
  'the three due_rule values and NULL are accepted'
);
select is((select row(status, progress)::text from public.action_items where code = 'TST-TL01'), '("Belum Mulai",0)',
  'status defaults to Belum Mulai, progress to 0');

-- replacements
select throws_ok($$insert into public.replacements (replaced_name, reported) values ('x', 'Tidak')$$, '23514', null, 'reported is Ya/Belum/NULL');
select throws_ok($$insert into public.replacements (replaced_name, practice_avg) values ('x', 5.5)$$, '23514', null, 'practice_avg is 1..5');
select throws_ok($$insert into public.replacements (replaced_name, staff_code) values ('x', 'NOPE-99')$$, '23503', null, 'replacements.staff_code must be a known staff code');
select lives_ok($$insert into public.replacements (replaced_name, staff_code, station, report_group) values ('Uji Sub', 'TST-SUB', 'SUB', 'SUB')$$,
  'replacement linked to a staff record');
update public.staff set code = 'TST-SUB2' where code = 'TST-SUB';
select is((select staff_code from public.replacements where replaced_name = 'Uji Sub'), 'TST-SUB2', 'staff code rename cascades to replacements');
delete from public.staff where code = 'TST-SUB2';
select ok((select staff_code is null from public.replacements where replaced_name = 'Uji Sub'),
  'deleting the staff record sets replacements.staff_code NULL and keeps the row');

-- settings
select throws_ok('update public.settings set bmi_periods = 53', '23514', null, 'bmi_periods is 1..52');
select throws_ok('update public.settings set bmi_periods = 0', '23514', null, 'bmi_periods is at least 1');
select lives_ok('update public.settings set bmi_periods = 8', 'the number of checks can be raised');
select lives_ok('update public.settings set bmi_periods = 6', 'and lowered again while no check uses the dropped periods');
insert into public.staff (code, station, name) values ('TST-GRD', 'SUB', 'Guard');
insert into public.bmi_checks (staff_code, period, height_cm, weight_kg) values ('TST-GRD', 6, 170, 60);
select throws_ok('update public.settings set bmi_periods = 5', '23514', 'bmi_periods_below_used', 'the number of checks cannot drop below a check that has data (check 6 is stored)');
select is((select bmi_periods from public.settings), 6::smallint, 'the refused change left the number of checks as it was');
delete from public.staff where code = 'TST-GRD';
update public.settings set bmi_periods = 5;
select throws_ok('update public.settings set improve_avg_min = 4.5', '23514', null, 'improve_avg_min <= pass_avg_min');
select throws_ok('update public.settings set bmi_normal_max = 30', '23514', null, 'BMI thresholds stay ordered');
select throws_ok($$insert into public.settings (id, week1_start, weeks, bmi_first_check, bmi_interval_days, bmi_periods,
    bmi_underweight_below, bmi_normal_max, bmi_overweight_max, pass_avg_min, improve_avg_min, posttest_min, replacement_deadline)
  values (2, '2026-10-12', 10, '2026-10-12', 14, 5, 18.5, 25, 27, 4, 3, 80, '2026-10-31')$$, '23514', null, 'settings is a single row');
select is(
  (select row(week1_start, weeks, bmi_first_check, bmi_interval_days, bmi_periods, bmi_underweight_below,
              bmi_normal_max, bmi_overweight_max, min_height_female, min_height_male, pass_avg_min,
              improve_avg_min, posttest_min, replacement_deadline)::text from public.settings),
  '(2026-10-12,10,2026-10-12,14,5,18.5,25,27,,,4,3,80,2026-10-31)',
  'settings defaults match the workbook Parameter sheet'
);
select is(
  (select string_agg(code || '=' || report_group, ',' order by sort) from (select * from public.stations order by sort limit 5) w),
  'SUB=SUB,DPS=DPS,CGK=CGK & HLP,HLP=CGK & HLP,KNO=KNO',
  'the five workbook stations come first, with their report groups'
);
select is((select count(*) from public.stations), 35::bigint, '35 stations: the workbook five plus the Garuda tracker''s other 30');
select is((select count(*) from public.stations where code not in ('CGK', 'HLP') and report_group <> code), 0::bigint,
          'every station except CGK and HLP is its own report group');

-- stations come from the table: a listed new station works everywhere, an unknown code nowhere
insert into public.staff (code, station, name) values ('TST-UPG', 'UPG', 'Uji Upg');
select is((select station from public.staff where code = 'TST-UPG'), 'UPG', 'staff can be placed in a new station (UPG)');
select lives_ok($$insert into public.share_links (scope) values ('UPG')$$, 'a link can open a new station (UPG)');
select lives_ok($$insert into public.action_items (code, report_group) values ('TST-UPG-TL01', 'UPG')$$, 'action item in the UPG report group');
select lives_ok($$insert into public.replacements (station, replaced_name) values ('UPG', 'Uji')$$, 'replacement in UPG');
select throws_ok($$insert into public.action_items (code, report_group) values ('TST-X-TL01', 'XYZ')$$, '23514', null, 'action item report group must be a group in stations');
select throws_ok($$insert into public.replacements (report_group, replaced_name) values ('XYZ', 'x')$$, '23514', null, 'replacement report group must be a group in stations');
select throws_ok($$insert into public.stations (code, report_group, sort) values ('KPS', 'KPS', 99)$$, '23514', null, 'KPS is not a station code');
select throws_ok($$insert into public.stations (code, report_group, sort) values ('jkt-1', 'JKT', 99)$$, '23514', null, 'station codes are 2 to 5 capitals or digits');
insert into public.stations (code, report_group, sort) values ('JKT', 'JKT', 99);
select lives_ok($$insert into public.share_links (scope) values ('JKT')$$, 'a station added later can get a link at once');
update public.stations set code = 'UPX' where code = 'UPG';
select is((select station from public.staff where code = 'TST-UPG'), 'UPX', 'renaming a station code carries its staff along');

-- share_links
select throws_ok($$insert into public.share_links (scope) values ('ZZZ')$$, '23514', null, 'share scope is a listed station or KPS');
select throws_ok($$insert into public.share_links (token, scope) values ('short', 'SUB')$$, '23514', null, 'share token must be 48 hex chars');

select * from finish();
rollback;
