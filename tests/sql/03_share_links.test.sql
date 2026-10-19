-- share_open (link workspace) as anon: scope isolation of EVERY array, payload shape, link_labels,
-- invalid_link; plus the BMI writers share_save_check / share_save_profile.
-- Every row that belongs to a non-SUB station or scope carries the marker XSTN, so a SUB payload
-- must not contain that string anywhere. Uses its own fixtures (TST-*); independent of seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ------------------------------------------------------------- fixtures (as postgres)
insert into public.share_links (token, scope, label, revoked_at) values
  (repeat('a1', 24), 'SUB', 'Supervisor SUB', null),
  (repeat('c3', 24), 'KPS', 'Kantor Pusat', null),
  (repeat('b2', 24), 'SUB', 'SUB dicabut', now()),
  (repeat('d4', 24), 'DPS', 'DPS XSTN', null),
  (repeat('e5', 24), 'CGK', 'CGK XSTN', null);

insert into public.staff
  (code, station, name, nipp, pre_test, post_test, score_a, report_conclusion, notes, bmi_note, sort_order)
values
  ('TST-SUB',  'SUB', 'Uji Sub',       'NIPP-SUB-1',  61, 81, 4, 'Sesuai', 'catatan sub', 'bmi sub', 1),
  ('TST-SUB2', 'SUB', 'Uji Sub Dua',   'NIPP-SUB-2',  62, 82, 3, null, null, null, 2),
  ('TST-DPS',  'DPS', 'Uji Dps XSTN',  'NIPP-XSTN-2', 63, 83, 3, 'Perlu Perbaikan', 'XSTN', null, 1),
  ('TST-CGK',  'CGK', 'Uji Cgk XSTN',  'NIPP-XSTN-3', 64, 84, 3, null, 'XSTN', null, 1),
  ('TST-HLP',  'HLP', 'Uji Hlp XSTN',  'NIPP-XSTN-4', 65, 85, 2, null, 'XSTN', null, 1),
  ('TST-KNO',  'KNO', 'Uji Kno XSTN',  'NIPP-XSTN-5', 66, 86, 5, null, 'XSTN', null, 1);

insert into public.weekly_scores (staff_code, week, score_a, observer, coaching_notes)
select code, 1, 4, 'obs', case when station = 'SUB' then 'coach sub' else 'XSTN' end
  from public.staff where code like 'TST-%';
insert into public.bmi_checks (staff_code, period, check_date, height_cm, weight_kg)
select code, 1, date '2026-10-12', 165, 60 from public.staff where code like 'TST-%';

insert into public.action_items (code, report_group, area, kps_notes, sort_order) values
  ('TST-SUB-TL01', 'SUB',       'area sub', 'kps sub', 1),
  ('TST-DPS-TL01', 'DPS',       'XSTN',     'XSTN',    1),
  ('TST-CH-TL01',  'CGK & HLP', 'XSTN',     'XSTN',    1),
  ('TST-KNO-TL01', 'KNO',       'XSTN',     'XSTN',    1);

insert into public.replacements (report_group, station, replaced_name, reason) values
  ('SUB',       'SUB', 'Repl Sub',       'alasan sub'),
  ('DPS',       'DPS', 'Repl Dps XSTN',  'XSTN'),
  ('CGK & HLP', 'CGK', 'Repl Cgk XSTN',  'XSTN'),
  ('CGK & HLP', null,  'Repl Group XSTN','XSTN');

insert into public.weekly_reports (week, scope, findings) values
  (1, 'SUB', 'temuan sub'),
  (1, 'DPS', 'XSTN'),
  (1, 'CGK', 'XSTN'),
  (1, 'KPS', 'XSTN kps');

-- Payloads are captured as anon into a temp table, then inspected as postgres.
create temp table _p (pk text primary key, v jsonb);
grant select, insert, update, delete on _p to anon;

-- Writes by other links (as anon) so link_labels has something to resolve.
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
insert into _p select 'w_dps', public.share_save_profile(repeat('d4', 24), 'TST-DPS', 'L', 'XSTN');
insert into _p select 'w_kps', public.share_save_profile(repeat('c3', 24), 'TST-SUB2', 'P', 'diisi KPS');
insert into _p select 'sub', public.share_open(repeat('a1', 24));
insert into _p select 'cgk', public.share_open(repeat('e5', 24));
insert into _p select 'kps', public.share_open(repeat('c3', 24));
reset role;

-- ------------------------------------------------------------- shape
select is(
  (select array_agg(k order by k collate "C") from _p, jsonb_object_keys(v) k where _p.pk = 'sub'),
  array['action_items', 'bmi_checks', 'label', 'link_id', 'link_labels', 'replacements', 'scope',
        'settings', 'staff', 'stations', 'weekly_reports', 'weekly_scores'],
  'share_open returns the workspace keys'
);
select is((select v ->> 'scope' from _p where pk = 'sub'), 'SUB', 'scope');
select is((select v ->> 'label' from _p where pk = 'sub'), 'Supervisor SUB', 'label');
select is((select (v ->> 'link_id')::uuid from _p where pk = 'sub'),
          (select id from public.share_links where token = repeat('a1', 24)), 'link_id is the opening link');
select is(
  (select array_agg(k order by k collate "C") from _p, jsonb_object_keys(v -> 'settings') k where _p.pk = 'sub'),
  (select array_agg(column_name::text collate "default" order by column_name::text collate "C") from information_schema.columns
    where table_schema = 'public' and table_name = 'settings'),
  'settings carries every settings column'
);
select is(
  (select array_agg(k order by k collate "C") from _p, jsonb_array_elements(v -> 'staff') e, jsonb_object_keys(e) k
    where _p.pk = 'sub' and e ->> 'code' = 'TST-SUB'),
  (select array_agg(column_name::text collate "default" order by column_name::text collate "C") from information_schema.columns
    where table_schema = 'public' and table_name = 'staff'),
  'staff rows carry every staff column (NIPP, baseline, notes included)'
);
select ok(
  not exists (select 1 from _p, jsonb_array_elements(v -> 'weekly_scores') e where e ? 'updated_by')
  and not exists (select 1 from _p, jsonb_array_elements(v -> 'bmi_checks') e where e ? 'updated_by_user'),
  'auth user ids (updated_by, updated_by_user) are never sent to a link'
);

-- ------------------------------------------------------------- SUB: zero non-SUB rows in EVERY array
select ok(strpos((select v::text from _p where pk = 'sub'), 'XSTN') = 0,
  'SUB payload contains no marker from any other station or scope (whole JSON scan)');
select is((select count(*) from _p, jsonb_array_elements(v -> 'stations') e
            where pk = 'sub' and e ->> 'code' <> 'SUB'), 0::bigint, 'stations[]: only SUB');
select is((select count(*) from _p, jsonb_array_elements(v -> 'staff') e
            where pk = 'sub' and e ->> 'station' <> 'SUB'), 0::bigint, 'staff[]: only SUB');
select is((select count(*) from _p, jsonb_array_elements(v -> 'weekly_scores') e
             left join public.staff s on s.code = e ->> 'staff_code'
            where pk = 'sub' and s.station is distinct from 'SUB'), 0::bigint, 'weekly_scores[]: only SUB staff');
select is((select count(*) from _p, jsonb_array_elements(v -> 'bmi_checks') e
             left join public.staff s on s.code = e ->> 'staff_code'
            where pk = 'sub' and s.station is distinct from 'SUB'), 0::bigint, 'bmi_checks[]: only SUB staff');
select is((select count(*) from _p, jsonb_array_elements(v -> 'action_items') e
            where pk = 'sub' and e ->> 'report_group' <> 'SUB'), 0::bigint, 'action_items[]: only report group SUB');
select is((select count(*) from _p, jsonb_array_elements(v -> 'replacements') e
            where pk = 'sub' and e ->> 'station' is distinct from 'SUB'), 0::bigint, 'replacements[]: only SUB');
select is((select count(*) from _p, jsonb_array_elements(v -> 'weekly_reports') e
            where pk = 'sub' and e ->> 'scope' <> 'SUB'), 0::bigint, 'weekly_reports[]: only scope SUB');
select is((select count(*) from _p, jsonb_object_keys(v -> 'link_labels') lk
             left join public.share_links l on l.id = lk::uuid
            where pk = 'sub' and l.scope is distinct from 'SUB' and l.scope is distinct from 'KPS'),
          0::bigint, 'link_labels: only SUB or KPS links');

-- ...and nothing in scope is missing
select is((select jsonb_array_length(v -> 'staff') from _p where pk = 'sub'),
          (select count(*)::int from public.staff where station = 'SUB'), 'staff[]: every SUB staff member');
select is((select jsonb_array_length(v -> 'weekly_scores') from _p where pk = 'sub'),
          (select count(*)::int from public.weekly_scores w join public.staff s on s.code = w.staff_code where s.station = 'SUB'),
          'weekly_scores[]: every SUB row');
select is((select jsonb_array_length(v -> 'bmi_checks') from _p where pk = 'sub'),
          (select count(*)::int from public.bmi_checks c join public.staff s on s.code = c.staff_code where s.station = 'SUB'),
          'bmi_checks[]: every SUB row');
select is((select jsonb_array_length(v -> 'action_items') from _p where pk = 'sub'),
          (select count(*)::int from public.action_items where report_group = 'SUB'), 'action_items[]: every SUB item');
select is((select jsonb_array_length(v -> 'replacements') from _p where pk = 'sub'),
          (select count(*)::int from public.replacements where station = 'SUB'), 'replacements[]: every SUB row');
select is((select jsonb_array_length(v -> 'weekly_reports') from _p where pk = 'sub'),
          (select count(*)::int from public.weekly_reports where scope = 'SUB'), 'weekly_reports[]: every SUB row');
select is((select v -> 'link_labels' ->> (select id::text from public.share_links where token = repeat('c3', 24)) from _p where pk = 'sub'),
          'Kantor Pusat', 'link_labels resolves the KPS link that edited a SUB row');
select is((select v -> 'link_labels' ->> (select id::text from public.share_links where token = repeat('a1', 24)) from _p where pk = 'sub'),
          'Supervisor SUB', 'link_labels includes the opening link');

-- ------------------------------------------------------------- CGK link: own station, shared report group
select is((select count(*) from _p, jsonb_array_elements(v -> 'staff') e
            where pk = 'cgk' and e ->> 'station' <> 'CGK'), 0::bigint, 'CGK link: staff only CGK (not HLP)');
select ok(exists (select 1 from _p, jsonb_array_elements(v -> 'action_items') e
                   where pk = 'cgk' and e ->> 'code' = 'TST-CH-TL01'), 'CGK link sees the CGK & HLP items');
select is((select count(*) from _p, jsonb_array_elements(v -> 'action_items') e
            where pk = 'cgk' and e ->> 'report_group' <> 'CGK & HLP'), 0::bigint, 'CGK link: no other report group items');
select is((select count(*) from _p, jsonb_array_elements(v -> 'replacements') e
            where pk = 'cgk' and e ->> 'station' is distinct from 'CGK'), 0::bigint, 'CGK link: replacements only station CGK');
select is((select count(*) from _p, jsonb_array_elements(v -> 'weekly_reports') e
            where pk = 'cgk' and e ->> 'scope' <> 'CGK'), 0::bigint, 'CGK link: weekly_reports only scope CGK');

-- ------------------------------------------------------------- KPS: everything
select is((select count(distinct e ->> 'station') from _p, jsonb_array_elements(v -> 'staff') e where pk = 'kps'),
          5::bigint, 'KPS sees staff of all 5 stations');
select is((select jsonb_array_length(v -> 'stations') from _p where pk = 'kps'), (select count(*)::int from public.stations), 'KPS gets every station');
select is((select jsonb_array_length(v -> 'staff') from _p where pk = 'kps'), (select count(*)::int from public.staff), 'KPS: all staff');
select is((select jsonb_array_length(v -> 'weekly_scores') from _p where pk = 'kps'), (select count(*)::int from public.weekly_scores), 'KPS: all weekly scores');
select is((select jsonb_array_length(v -> 'bmi_checks') from _p where pk = 'kps'), (select count(*)::int from public.bmi_checks), 'KPS: all BMI checks');
select is((select jsonb_array_length(v -> 'action_items') from _p where pk = 'kps'), (select count(*)::int from public.action_items), 'KPS: all action items');
select is((select jsonb_array_length(v -> 'replacements') from _p where pk = 'kps'), (select count(*)::int from public.replacements), 'KPS: all replacements (incl. no-station rows)');
select is((select jsonb_array_length(v -> 'weekly_reports') from _p where pk = 'kps'), (select count(*)::int from public.weekly_reports), 'KPS: weekly reports of every scope');
select ok((select v -> 'link_labels' ? (select id::text from public.share_links where token = repeat('d4', 24)) from _p where pk = 'kps'),
  'KPS link_labels include the DPS link that edited a DPS row');

-- ------------------------------------------------------------- invalid_link / last_used_at
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select throws_ok(format('select public.share_open(%L)', repeat('b2', 24)), 'P0001', 'invalid_link', 'revoked link raises invalid_link');
select throws_ok(format('select public.share_open(%L)', md5(random()::text) || left(md5(random()::text), 16)),
  'P0001', 'invalid_link', 'random token raises invalid_link');
select throws_ok('select public.share_open(null)', 'P0001', 'invalid_link', 'NULL token raises invalid_link');
select throws_ok($$select public.share_open('')$$, 'P0001', 'invalid_link', 'empty token raises invalid_link');
reset role;
select ok((select last_used_at is not null from public.share_links where token = repeat('a1', 24)), 'share_open touches last_used_at');
select ok((select last_used_at is null from public.share_links where token = repeat('b2', 24)), 'a revoked link is never touched');

-- ------------------------------------------------------------- BMI writers (new return envelope)
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
insert into _p select 'chk', public.share_save_check(repeat('a1', 24), 'TST-SUB', 2, date '2026-10-26', 171, 66);
select throws_ok(format('select public.share_save_check(%L, %L, 1, %L, 170, 70)', repeat('a1', 24), 'TST-DPS', '2026-10-12'),
  'P0001', 'out_of_scope', 'SUB link cannot save a DPS staff check');
select throws_ok(format('select public.share_save_check(%L, %L, 1, null, 170, 70)', repeat('a1', 24), 'NOPE-99'),
  'P0001', 'out_of_scope', 'unknown staff code raises out_of_scope');
select throws_ok(format('select public.share_save_check(%L, %L, 1, null, 170, 70)', repeat('b2', 24), 'TST-SUB'),
  'P0001', 'invalid_link', 'revoked link cannot save a check');
select throws_ok(format('select public.share_save_check(%L, %L, 3, null, 300, 60)', repeat('a1', 24), 'TST-SUB'),
  '22023', 'invalid_input', 'height 300 is rejected');
select throws_ok(format('select public.share_save_check(%L, %L, 3, null, 170, 10)', repeat('a1', 24), 'TST-SUB'),
  '22023', 'invalid_input', 'weight 10 is rejected');
select throws_ok(format('select public.share_save_check(%L, %L, 3, null, null, 60)', repeat('a1', 24), 'TST-SUB'),
  '22023', 'invalid_input', 'height missing while weight given is rejected');
select throws_ok(format('select public.share_save_check(%L, %L, 6, null, 170, 60)', repeat('a1', 24), 'TST-SUB'),
  '22023', 'invalid_input', 'period beyond settings.bmi_periods is rejected');
insert into _p select 'chk_kps', public.share_save_check(repeat('c3', 24), 'TST-KNO', 3, date '2026-11-09', 168, 64);
insert into _p select 'prof', public.share_save_profile(repeat('a1', 24), 'TST-SUB', ' p ', '  Perlu cek ulang  ');
select throws_ok(format('select public.share_save_profile(%L, %L, %L, null)', repeat('a1', 24), 'TST-DPS', 'L'),
  'P0001', 'out_of_scope', 'SUB link cannot edit a DPS profile');
select throws_ok(format('select public.share_save_profile(%L, %L, %L, null)', repeat('a1', 24), 'TST-SUB', 'X'),
  '22023', 'invalid_input', 'gender other than L/P is rejected');
insert into _p select 'chk_del', public.share_save_check(repeat('a1', 24), 'TST-SUB', 2, null, null, null);
reset role;

select is((select v ->> 'deleted' from _p where pk = 'chk'), 'false', 'save_check returns deleted=false');
select is((select (v -> 'row' ->> 'height_cm')::numeric from _p where pk = 'chk'), 171.0, 'save_check returns the stored row');
select ok((select not (v -> 'row' ? 'updated_by_user') from _p where pk = 'chk'), 'save_check row hides updated_by_user');
select is((select (v -> 'row' ->> 'updated_by_link')::uuid from _p where pk = 'chk'),
          (select id from public.share_links where token = repeat('a1', 24)), 'save_check row shows updated_by_link');
select is((select updated_by_link from public.bmi_checks where staff_code = 'TST-KNO' and period = 3),
          (select id from public.share_links where token = repeat('c3', 24)), 'KPS save records the KPS link');
select is((select v -> 'row' ->> 'gender' from _p where pk = 'prof'), 'P', 'save_profile returns the staff row (gender trimmed, upper-cased)');
select is((select row(gender, bmi_note, nipp, notes)::text from public.staff where code = 'TST-SUB'),
          row('P', 'Perlu cek ulang', 'NIPP-SUB-1', 'catatan sub')::text, 'profile save changes only gender and bmi_note');
select is((select updated_by_link from public.staff where code = 'TST-SUB'),
          (select id from public.share_links where token = repeat('a1', 24)), 'profile save records updated_by_link on staff');
select is((select v from _p where pk = 'chk_del'),
          '{"deleted": true, "row": {"staff_code": "TST-SUB", "period": 2}}'::jsonb, 'both NULL returns the deleted key');
select is((select count(*) from public.bmi_checks where staff_code = 'TST-SUB' and period = 2), 0::bigint, 'both NULL deletes that period row');
select is((select count(*) from public.bmi_checks where staff_code = 'TST-DPS'), 1::bigint, 'out-of-scope save did not touch DPS data');

-- table-level constraints back up the RPC validation
select throws_ok($$insert into public.bmi_checks (staff_code, period, height_cm, weight_kg) values ('TST-DPS', 4, 300, 60)$$,
  '23514', null, 'table rejects height 300');
select throws_ok($$insert into public.bmi_checks (staff_code, period, height_cm, weight_kg) values ('TST-DPS', 4, 170, 10)$$,
  '23514', null, 'table rejects weight 10');

select * from finish();
rollback;
