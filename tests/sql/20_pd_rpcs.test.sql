-- v2 (pd_*) RPCs called as anon (links) and as a signed-in branch account / owner:
-- what each scope sees, Cek BMI and staff writes, Rencana Aksi CRUD with archive, KPS-only
-- Penggantian and Laporan Bulanan, triggers (Cabang from station, auto "Diganti"), attribution.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ------------------------------------------------------------- fixtures (as postgres)
insert into public.pd_share_links (token, scope, label, revoked_at) values
  (repeat('a1', 24), 'CGK', 'PIC CGK', null),
  (repeat('b2', 24), 'HLP', 'PIC HLP', null),
  (repeat('c3', 24), 'KPS', 'KPS', null),
  (repeat('d4', 24), 'DPS', 'dicabut', now()),
  (repeat('e5', 24), 'BPN', 'PIC BPN', null);

insert into public.pd_staff (code, station, name, proposal, main_status) values
  ('CGK-01', 'CGK', 'Uji Cgk', 'Penggantian', 'Belum Mulai'),
  ('CGK-02', 'CGK', 'Uji Cgk Dua', 'Coaching intensif', 'Belum Mulai'),
  ('HLP-01', 'HLP', 'Uji Hlp', 'Pembinaan', null),
  ('DPS-01', 'DPS', 'Uji Dps', null, null);

insert into public.pd_action_plans (item_no, area, action, report_group) values
  ('1', 'Penggantian SDM', 'Tarik staf', 'CGK & HLP'),
  ('1', 'Penggantian SDM', 'Tarik staf', 'DPS');

insert into public.pd_bmi_checks (staff_code, period, height_cm, weight_kg) values
  ('DPS-01', 1, 165, 60);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'bpn@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'owner@example.test');
-- auth.users insert creates the profile (v1 trigger); approve it for BPN.
update public.profiles set full_name = 'Akun BPN', branch_code = 'BPN', status = 'active'
 where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.admins (user_id, email) values ('00000000-0000-0000-0000-0000000000a2', 'owner@example.test');

create function pg_temp.err(p_sql text) returns text
language plpgsql as $$
declare v_state text; v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || ' ' || v_msg || coalesce(' ' || nullif(v_detail, ''), '');
end $$;

create temp table _r (pk text primary key, v jsonb);
grant select, insert on _r to anon, authenticated;
create temp table _plan as select id from public.pd_action_plans where report_group = 'CGK & HLP';
create temp table _plan_dps as select id from public.pd_action_plans where report_group = 'DPS';
grant select on _plan, _plan_dps to anon, authenticated;

-- A row inserted without a code gets the station's next one (the Sheets sync path).
insert into public.pd_staff (station, name) values ('DPS', 'Uji Dps Dari Sheet');
select is((select code from public.pd_staff where name = 'Uji Dps Dari Sheet'), 'DPS-02', 'staff: code assigned when missing');
delete from public.pd_staff where name = 'Uji Dps Dari Sheet';

-- Cabang follows the station, whatever is written.
select is((select report_group from public.pd_staff where code = 'HLP-01'), 'CGK & HLP', 'staff: Cabang set from station');

set local request.jwt.claims = '{"role":"anon"}';
set local role anon;

-- ============================================================= privileges
select is(pg_temp.err('select count(*) from public.pd_staff'), '42501 permission denied for table pd_staff',
  'anon cannot read pd_staff directly');
select is(pg_temp.err(format('select public.pd_share_open(%L)', repeat('d4', 24))), 'P0001 invalid_link',
  'revoked link is invalid');
select is(pg_temp.err('select public.pd_share_open(''zz'')'), 'P0001 invalid_link', 'unknown token is invalid');

-- ============================================================= open: what a station sees
insert into _r select 'open_cgk', public.pd_share_open(repeat('a1', 24));
select is((select jsonb_array_length(v -> 'staff') from _r where pk = 'open_cgk'), 2, 'CGK link: only CGK staff');
select is((select jsonb_array_length(v -> 'stations') from _r where pk = 'open_cgk'), 1, 'CGK link: one station');
select is((select jsonb_array_length(v -> 'action_plans') from _r where pk = 'open_cgk'), 1, 'CGK link: plans of CGK & HLP only');
select is((select v -> 'replacements' from _r where pk = 'open_cgk'), '[]'::jsonb, 'CGK link: no Penggantian');
select is((select v -> 'monthly_reports' from _r where pk = 'open_cgk'), '[]'::jsonb, 'CGK link: no Laporan Bulanan');
select is((select jsonb_array_length(v -> 'areas') from _r where pk = 'open_cgk'), 12, 'areas are sent to every scope');
insert into _r select 'open_kps', public.pd_share_open(repeat('c3', 24));
select is((select jsonb_array_length(v -> 'staff') from _r where pk = 'open_kps'), 4, 'KPS link: every staff member');
select is((select jsonb_array_length(v -> 'action_plans') from _r where pk = 'open_kps'), 2, 'KPS link: every plan');

-- ============================================================= Cek BMI
insert into _r select 'bmi', public.pd_share_save_check(repeat('a1', 24), 'CGK-01', 1, date '2026-10-16', 170, 70);
select is((select (v -> 'row' ->> 'height_cm')::numeric from _r where pk = 'bmi'), 170.0, 'BMI: CGK link saves its staff');
select is(pg_temp.err(format($q$select public.pd_share_save_check(%L, 'DPS-01', 1, null, 170, 70)$q$, repeat('a1', 24))),
  'P0001 out_of_scope', 'BMI: CGK link cannot write DPS staff');
select is(pg_temp.err(format($q$select public.pd_share_save_check(%L, 'CGK-01', 6, null, 170, 70)$q$, repeat('a1', 24))),
  '22023 invalid_input period', 'BMI: period beyond pd_settings.bmi_periods rejected');
select is(pg_temp.err(format($q$select public.pd_share_save_check(%L, 'CGK-01', 1, null, 300, 70)$q$, repeat('a1', 24))),
  '22023 invalid_input height_cm', 'BMI: height out of range rejected');

-- ============================================================= staff
insert into _r select 'staff_new', public.pd_share_save_staff(repeat('a1', 24), null, '{"name":" Baru ","gender":"p"}');
select is((select v -> 'row' ->> 'code' from _r where pk = 'staff_new'), 'CGK-03', 'staff: next code of the station');
select is((select v -> 'row' ->> 'gender' from _r where pk = 'staff_new'), 'P', 'staff: gender upper-cased');
select is((select v -> 'row' ->> 'report_group' from _r where pk = 'staff_new'), 'CGK & HLP', 'staff: Cabang from station');
select is(pg_temp.err(format($q$select public.pd_share_save_staff(%L, 'CGK-01', '{"proposal":"Pembinaan"}')$q$, repeat('a1', 24))),
  'P0001 forbidden_field proposal', 'staff: station link cannot set Tracker Staf fields');
select is(pg_temp.err(format($q$select public.pd_share_save_staff(%L, null, '{"name":"X","station":"DPS"}')$q$, repeat('a1', 24))),
  'P0001 out_of_scope', 'staff: station link cannot add to another station');
select is(pg_temp.err(format($q$select public.pd_share_save_staff(%L, 'CGK-01', '{"nipp":"123"}')$q$, repeat('a1', 24))),
  'ok', 'staff: station link edits NIPP');
insert into _r select 'staff_kps', public.pd_share_save_staff(repeat('c3', 24), 'CGK-02',
  '{"reassess_practice":"4,5","reassessed_on":"2026-11-13","main_status":"Selesai","final_decision":"Tetap bertugas"}');
select is((select (v -> 'row' ->> 'reassess_practice')::numeric from _r where pk = 'staff_kps'), 4.50, 'staff: KPS sets practice (comma decimal)');
select is(pg_temp.err(format($q$select public.pd_share_save_staff(%L, 'CGK-02', '{"main_status":"Done"}')$q$, repeat('c3', 24))),
  '22023 invalid_input main_status', 'staff: unknown status rejected');
select is(pg_temp.err(format($q$select public.pd_share_save_staff(%L, 'CGK-02', '{"main_due":"13/11/2026"}')$q$, repeat('c3', 24))),
  '22023 invalid_input main_due', 'staff: non-ISO date rejected');
select is(pg_temp.err(format($q$select public.pd_share_save_staff(%L, 'CGK-02', '{"bogus":1}')$q$, repeat('c3', 24))),
  'P0001 forbidden_field bogus', 'staff: unknown key rejected');
select is(pg_temp.err(format($q$select public.pd_share_delete_staff(%L, 'CGK-03')$q$, repeat('a1', 24))),
  'P0001 forbidden_field kps', 'staff: station link cannot delete');

-- ============================================================= Rencana Aksi
insert into _r select 'ap_new', public.pd_share_save_action_plan(repeat('a1', 24), null,
  '{"area":"Grooming","action":" Cek harian ","due_date":"2026-12-11","progress":40}');
select is((select v -> 'row' ->> 'report_group' from _r where pk = 'ap_new'), 'CGK & HLP', 'plan: new row gets the link''s group');
select is((select v -> 'row' ->> 'action' from _r where pk = 'ap_new'), 'Cek harian', 'plan: text trimmed');
select is((select v -> 'row' ->> 'status' from _r where pk = 'ap_new'), 'Belum Mulai', 'plan: default status');
select is(pg_temp.err(format($q$select public.pd_share_save_action_plan(%L, null, '{"area":"Grooming","action":"x","report_group":"DPS"}')$q$, repeat('a1', 24))),
  'P0001 out_of_scope', 'plan: CGK link cannot create a DPS plan');
select is(pg_temp.err(format($q$select public.pd_share_save_action_plan(%L, null, '{"area":"Tidak ada","action":"x"}')$q$, repeat('a1', 24))),
  '22023 invalid_input area', 'plan: unknown area rejected');
select is(pg_temp.err(format($q$select public.pd_share_save_action_plan(%L, null, '{"area":"BMI","action":"x","progress":120}')$q$, repeat('a1', 24))),
  '22023 invalid_input progress', 'plan: progress above 100 rejected');
select is(pg_temp.err(format($q$select public.pd_share_save_action_plan(%L, %s, '{"status":"Selesai","progress":100,"done_on":"2026-10-30"}')$q$,
  repeat('b2', 24), (select id from _plan))), 'ok', 'plan: HLP link updates the shared CGK & HLP plan');
select is(pg_temp.err(format($q$select public.pd_share_save_action_plan(%L, %s, '{"status":"Proses"}')$q$,
  repeat('a1', 24), (select id from _plan_dps))), 'P0001 out_of_scope', 'plan: CGK link cannot update DPS plan');
select is(pg_temp.err(format($q$select public.pd_share_archive_action_plan(%L, %s)$q$,
  repeat('a1', 24), (select id from _plan_dps))), 'P0001 out_of_scope', 'plan: CGK link cannot archive DPS plan');
select is(pg_temp.err(format($q$select public.pd_share_archive_action_plan(%L, %s)$q$,
  repeat('a1', 24), (select id from _plan))), 'ok', 'plan: CGK link archives its plan');
select is((select jsonb_array_length(public.pd_share_open(repeat('a1', 24)) -> 'action_plans')), 1,
  'plan: archived plan is gone from open (new one remains)');
select is(pg_temp.err(format($q$select public.pd_share_save_action_plan(%L, %s, '{"status":"Proses"}')$q$,
  repeat('a1', 24), (select id from _plan))), 'P0001 out_of_scope', 'plan: archived plan cannot be edited');
select is(pg_temp.err(format($q$select public.pd_share_restore_action_plan(%L, %s)$q$,
  repeat('c3', 24), (select id from _plan))), 'P0001 forbidden_field archived_at', 'plan: a KPS link cannot restore');

-- ============================================================= Penggantian (KPS only)
select is(pg_temp.err(format($q$select public.pd_share_save_replacement(%L, null, '{"staff_code":"CGK-01"}')$q$, repeat('a1', 24))),
  'P0001 forbidden_field staff_code', 'replacement: station link refused');
insert into _r select 'rp', public.pd_share_save_replacement(repeat('c3', 24), null,
  '{"staff_code":"CGK-01","name":"ignored","category":"Penggantian","withdraw_status":"Proses","post_test":85,"practice":"4,25"}');
select is((select v -> 'row' ->> 'name' from _r where pk = 'rp'), 'Uji Cgk', 'replacement: name copied from staff');
select is((select v -> 'row' ->> 'report_group' from _r where pk = 'rp'), 'CGK & HLP', 'replacement: Cabang copied from staff');
select is(pg_temp.err(format($q$select public.pd_share_save_replacement(%L, %s, '{"withdraw_status":"Selesai"}')$q$,
  repeat('c3', 24), (select v -> 'row' ->> 'id' from _r where pk = 'rp'))), 'ok', 'replacement: withdrawal done');
select is(pg_temp.err(format($q$select public.pd_share_save_replacement(%L, null, '{"staff_code":"NOPE-01"}')$q$, repeat('c3', 24))),
  '22023 invalid_input staff_code', 'replacement: unknown staff code rejected');

-- ============================================================= Laporan Bulanan (KPS only)
select is(pg_temp.err(format($q$select public.pd_share_save_monthly_report(%L, 'CGK & HLP', date '2026-10-01', '{"active_staff":32}')$q$, repeat('a1', 24))),
  'P0001 forbidden_field active_staff', 'monthly: station link refused');
select is(pg_temp.err(format($q$select public.pd_share_save_monthly_report(%L, 'CGK & HLP', date '2026-10-01', '{"active_staff":32,"compliant_staff":30,"responded":"Ya","satisfaction":"4,4"}')$q$, repeat('c3', 24))),
  'ok', 'monthly: KPS upserts');
select is(pg_temp.err(format($q$select public.pd_share_save_monthly_report(%L, 'CGK & HLP', date '2026-10-02', '{}')$q$, repeat('c3', 24))),
  '22023 invalid_input period', 'monthly: period must be the 1st');
select is(pg_temp.err(format($q$select public.pd_share_save_monthly_report(%L, 'XYZ', date '2026-10-01', '{}')$q$, repeat('c3', 24))),
  '22023 invalid_input report_group', 'monthly: unknown Cabang rejected');

reset role;
reset request.jwt.claims;

-- ============================================================= effects (as postgres)
select is((select final_decision from public.pd_staff where code = 'CGK-01'), 'Diganti',
  'withdrawal Selesai marks the staff member Diganti');
select is((select final_decision from public.pd_staff where code = 'CGK-02'), 'Tetap bertugas',
  'a recorded decision is kept');
select is((select updated_by_link from public.pd_bmi_checks where staff_code = 'CGK-01'),
  (select id from public.pd_share_links where token = repeat('a1', 24)), 'BMI write attributed to the link');
select is((select updated_by_link from public.pd_staff where code = 'CGK-03'),
  (select id from public.pd_share_links where token = repeat('a1', 24)), 'staff write attributed to the link');
select is((select updated_by_link from public.pd_staff where code = 'CGK-01'),
  (select id from public.pd_share_links where token = repeat('c3', 24)), 'auto Diganti attributed to the KPS write');
select is((select satisfaction from public.pd_monthly_reports where report_group = 'CGK & HLP'), 4.40::numeric(3,2),
  'monthly values stored');
update public.pd_staff set name = 'Uji Cgk Baru' where code = 'CGK-01';
select is((select name from public.pd_replacements where staff_code = 'CGK-01'), 'Uji Cgk Baru',
  'a staff rename reaches the Penggantian row');

-- ============================================================= branch account and owner (blank token)
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';
set local role authenticated;
select is((select public.pd_share_open('') ->> 'scope'), 'BPN', 'account: scope from profiles.branch_code');
select is((select public.pd_share_open('') ->> 'label'), 'Akun BPN', 'account: label is the account name');
insert into _r select 'ap_bpn', public.pd_share_save_action_plan('', null, '{"area":"BMI","action":"Program BMI"}');
select is((select v -> 'row' ->> 'report_group' from _r where pk = 'ap_bpn'), 'BPN', 'account: plan in its own group');
select is((select count(*) from public.pd_action_plans)::int, 0, 'account: no direct table rows (RLS)');
reset role;

set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a2"}';
set local role authenticated;
select is((select public.pd_share_open('') ->> 'label'), 'Pemilik', 'owner: label Pemilik');
select is((select jsonb_array_length(public.pd_share_open('') -> 'action_plans')), 4, 'owner: sees archived plans too');
select is(pg_temp.err(format('select public.pd_share_restore_action_plan(%L, %s)', '', (select id from _plan))),
  'ok', 'owner restores an archived plan');
reset role;

select is((select archived_at from public.pd_action_plans where id = (select id from _plan)), null, 'restored plan is active');

select * from finish();
rollback;
