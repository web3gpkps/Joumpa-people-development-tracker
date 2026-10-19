-- RLS: a signed-in non-admin sees and changes nothing; an admin sees and edits everything
-- (within the narrower rules for stations / settings / sync_state).
-- Uses its own fixture rows (codes TST-*); does not depend on seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'tst-admin@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'tst-user@example.invalid');
insert into public.admins (user_id, email) values
  ('11111111-1111-4111-8111-111111111111', 'tst-admin@example.invalid');

insert into public.staff (code, station, name, nipp, pre_test, post_test, score_a, notes) values
  ('TST-SUB', 'SUB', 'Uji Sub', 'NIPP-SECRET-1', 70, 85, 4, 'NOTES-SECRET');
insert into public.weekly_scores (staff_code, week, score_a, coaching_notes) values ('TST-SUB', 1, 4, 'uji');
insert into public.bmi_checks (staff_code, period, check_date, height_cm, weight_kg) values
  ('TST-SUB', 1, date '2026-10-12', 165, 60);
insert into public.action_items (code, report_group, action) values ('TST-TL01', 'SUB', 'Uji tindakan');
insert into public.replacements (report_group, station, replaced_name) values ('SUB', 'SUB', 'Uji Diganti');
insert into public.weekly_reports (week, scope, findings) values (20, 'KPS', 'uji') on conflict (week, scope) do nothing;
insert into public.share_links (scope, label) values ('SUB', 'uji');
insert into public.sync_conflicts (table_name, row_key, column_name) values ('staff', 'TST-SUB', 'name');
-- v2
insert into public.pd_staff (code, station, name, nipp) values ('SUB-90', 'SUB', 'Uji Sub', 'NIPP-SECRET-2');
insert into public.pd_bmi_checks (staff_code, period, height_cm, weight_kg) values ('SUB-90', 1, 165, 60);
insert into public.pd_action_plans (area, action, report_group) values ('BMI', 'Uji rencana', 'SUB');
insert into public.pd_replacements (staff_code, name) values ('SUB-90', 'x');
insert into public.pd_monthly_reports (report_group, period) values ('SUB', date '2026-10-01');
insert into public.pd_share_links (scope, label) values ('SUB', 'uji');
insert into public.pd_sync_conflicts (table_name, row_key, column_name) values ('pd_staff', 'SUB-90', 'name');

-- Row counts as seen by postgres (RLS bypassed), for comparison.
create temp table _expected (tbl text primary key, n bigint not null);
insert into _expected (tbl, n)
select c.relname, 0
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r';

create function pg_temp.count_rows(p_tbl text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  execute format('select count(*) from public.%I', p_tbl) into v;
  return v;
end $$;

update _expected set n = pg_temp.count_rows(tbl);
grant select on _expected to authenticated;

select ok(n > 0, format('fixture: public.%s has rows', tbl)) from _expected order by tbl;

-- ------------------------------------------------------------- signed-in, not an admin
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
set local role authenticated;

select is(public.is_admin(), false, 'is_admin() is false for a non-admin');

select is(pg_temp.count_rows(tbl), 0::bigint, format('non-admin sees no rows in %s', tbl))
  from _expected where tbl <> 'profiles' order by tbl;
-- profiles: a signed-in account reads its own row and nobody else's.
select is(pg_temp.count_rows('profiles'), 1::bigint, 'non-admin sees only their own row in profiles');

select throws_ok(
  $$insert into public.admins (user_id, email) values ('22222222-2222-4222-8222-222222222222', 'x')$$,
  '42501', null, 'non-admin cannot make themselves admin'
);
select throws_ok(
  $$insert into public.staff (code, station, name) values ('TST-NEW', 'SUB', 'x')$$,
  '42501', null, 'non-admin cannot insert staff'
);
select throws_ok(
  $$insert into public.bmi_checks (staff_code, period, height_cm, weight_kg) values ('TST-SUB', 2, 170, 70)$$,
  '42501', null, 'non-admin cannot insert bmi_checks'
);
select throws_ok(
  $$insert into public.share_links (scope, label) values ('KPS', 'x')$$,
  '42501', null, 'non-admin cannot create share links'
);

with u as (update public.staff set name = 'hacked' returning 1)
select is(count(*)::int, 0, 'non-admin UPDATE staff touches 0 rows') from u;
with u as (update public.settings set weeks = 12 returning 1)
select is(count(*)::int, 0, 'non-admin UPDATE settings touches 0 rows') from u;
with u as (update public.share_links set revoked_at = null returning 1)
select is(count(*)::int, 0, 'non-admin UPDATE share_links touches 0 rows') from u;
with d as (delete from public.bmi_checks returning 1)
select is(count(*)::int, 0, 'non-admin DELETE bmi_checks touches 0 rows') from d;
with d as (delete from public.admins returning 1)
select is(count(*)::int, 0, 'non-admin DELETE admins touches 0 rows') from d;

select throws_ok('select public.sync_claim_lease(60)', '42501', null, 'non-admin cannot claim the sync lease');

reset role;

select is(pg_temp.count_rows(tbl), n, format('after non-admin attempts, %s is unchanged', tbl))
  from _expected order by tbl;
select is((select name from public.staff where code = 'TST-SUB'), 'Uji Sub', 'staff name unchanged');

-- ------------------------------------------------------------- admin
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local role authenticated;

select is(public.is_admin(), true, 'is_admin() is true for an admin');

select is(pg_temp.count_rows(tbl), n, format('admin sees every row in %s', tbl))
  from _expected order by tbl;

with u as (update public.staff set notes = 'diubah admin' where code = 'TST-SUB' returning 1)
select is(count(*)::int, 1, 'admin can update staff') from u;

select lives_ok(
  $$insert into public.weekly_scores (staff_code, week, score_b) values ('TST-SUB', 2, 3)$$,
  'admin can insert weekly_scores'
);
select lives_ok(
  $$insert into public.bmi_checks (staff_code, period, height_cm, weight_kg) values ('TST-SUB', 2, 170, 70)$$,
  'admin can insert bmi_checks'
);
select lives_ok(
  $$insert into public.share_links (scope, label) values ('KPS', 'uji kps')$$,
  'admin can create share links'
);
select ok(
  (select bool_and(token ~ '^[0-9a-f]{48}$') from public.share_links),
  'share tokens are 48 lowercase hex chars (24 random bytes)'
);

with u as (update public.settings set weeks = 10 returning 1)
select is(count(*)::int, 1, 'admin can update the settings row') from u;
select throws_ok('delete from public.settings', '42501', null, 'admin cannot delete the settings row');
select throws_ok(
  $$insert into public.stations (code, report_group, sort) values ('SUB', 'SUB', 9)$$,
  '42501', null, 'stations are read-only for admins'
);
select throws_ok('update public.sync_state set failures = 0', '42501', null, 'sync_state is read-only for admins');
select is((select count(*) from public.sync_state), 1::bigint, 'admin can read sync_state');

reset role;

-- Attribution is stamped server-side.
select is(
  (select updated_by from public.weekly_scores where staff_code = 'TST-SUB' and week = 2),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'weekly_scores.updated_by = the admin who wrote it'
);
select is(
  (select updated_by_user from public.bmi_checks where staff_code = 'TST-SUB' and period = 2),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'bmi_checks.updated_by_user = the admin who wrote it'
);
select ok(
  (select updated_by_link is null from public.bmi_checks where staff_code = 'TST-SUB' and period = 2),
  'admin-written bmi_checks have updated_by_link NULL'
);
select is(
  (select created_by from public.share_links where label = 'uji kps'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'share_links.created_by defaults to the creating admin'
);

select * from finish();
rollback;
