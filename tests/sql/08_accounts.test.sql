-- Branch accounts: sign-up creates a pending profile (role and status never come from the sign-up
-- metadata), only the owner approves, an approved account reaches data only through share_* with a
-- blank token and only inside its branch, and an inactive or pending account reaches nothing.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'tst-owner@example.invalid');
insert into public.admins (user_id, email) values ('11111111-1111-4111-8111-111111111111', 'tst-owner@example.invalid');

-- Sign-ups: the trigger on auth.users builds the profiles.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000000a1', 'tst-sub@example.invalid',
     '{"full_name":"  Akun SUB  ","branch_code":"sub"}'),
  ('a0000000-0000-4000-8000-0000000000a2', 'tst-kps@example.invalid',
     '{"full_name":"Akun KPS","branch_code":"KPS"}'),
  ('a0000000-0000-4000-8000-0000000000a3', 'tst-bad@example.invalid',
     '{"full_name":"Akun Cabang Salah","branch_code":"ZZZ","role":"admin","status":"active"}'),
  ('a0000000-0000-4000-8000-0000000000a4', 'tst-none@example.invalid', null);

insert into public.staff (code, station, name, pre_test) values
  ('TST-SUB', 'SUB', 'Uji Sub', 60),
  ('TST-DPS', 'DPS', 'Uji Dps', 60);

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

-- ------------------------------------------------------------- sign-up trigger
select is((select row(status, branch_code, full_name)::text from public.profiles where email = 'tst-sub@example.invalid'),
          row('pending'::public.account_status, 'SUB', 'Akun SUB')::text,
          'sign-up: pending, branch upper-cased, name trimmed');
select is((select row(status, branch_code)::text from public.profiles where email = 'tst-kps@example.invalid'),
          row('pending'::public.account_status, 'KPS')::text, 'sign-up: KPS (head office) is a valid branch');
select is((select row(status, branch_code)::text from public.profiles where email = 'tst-bad@example.invalid'),
          row('pending'::public.account_status, 'UNASSIGNED')::text,
          'sign-up: unknown branch becomes UNASSIGNED; role and status in the metadata are ignored');
select is((select row(status, branch_code, full_name)::text from public.profiles where email = 'tst-none@example.invalid'),
          row('pending'::public.account_status, 'UNASSIGNED', '')::text, 'sign-up without metadata still gets a pending profile');
select is((select status::text from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'pending',
  'an owner auth user also gets a (pending) profile; the owner path is decided by public.admins, not the profile');

-- ------------------------------------------------------------- a pending account reaches nothing
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.err('select public.share_open(null)'), 'P0001 invalid_link', 'pending account: share_open invalid_link');
select is(pg_temp.err($q$select public.share_save_check('', 'TST-SUB', 1, null, 170, 70)$q$), 'P0001 invalid_link',
  'pending account: writer invalid_link');
select is((select count(*)::int from public.profiles), 1, 'an account reads only its own profile');
select is((select email from public.profiles), 'tst-sub@example.invalid', 'the own profile is the one returned');
with u as (update public.profiles set status = 'active' where id = 'a0000000-0000-4000-8000-0000000000a1' returning 1)
select is(count(*)::int, 0, 'an account cannot approve itself (RLS filters the update)') from u;
select is(pg_temp.err($q$update public.profiles set email = 'x@example.invalid'$q$), '42501 permission denied for table profiles',
  'an account cannot change columns outside the editable three');
select is(pg_temp.err($q$delete from public.profiles$q$), '42501 permission denied for table profiles',
  'an account cannot delete profiles');
select is(pg_temp.err($q$insert into public.profiles (id, email, branch_code) values (gen_random_uuid(), 'y@example.invalid', 'SUB')$q$),
  '42501 permission denied for table profiles', 'an account cannot insert profiles');
reset role;
select is((select status::text from public.profiles where email = 'tst-sub@example.invalid'), 'pending', 'still pending after the attempts');

set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select is(pg_temp.err('select count(*) from public.profiles'), '42501 permission denied for table profiles', 'anon cannot read profiles');
select is(pg_temp.err($q$select public.admin_delete_account('a0000000-0000-4000-8000-0000000000a1')$q$),
  '42501 permission denied for function admin_delete_account', 'anon cannot call admin_delete_account');
select is(pg_temp.err('select public.share_open(null)'), 'P0001 invalid_link', 'anon + blank token: invalid_link');
reset role;

-- ------------------------------------------------------------- the owner decides
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.profiles), 5, 'owner reads every profile');
select is(pg_temp.err($q$update public.profiles set status = 'active' where email = 'tst-bad@example.invalid'$q$),
  '23514 new row for relation "profiles" violates check constraint "profiles_active_needs_branch"',
  'owner cannot activate an account without a real branch');
select is(pg_temp.err($q$update public.profiles set branch_code = 'ZZZ' where email = 'tst-bad@example.invalid'$q$),
  '23514 profiles_branch_code_check branch_code must be KPS or a code in public.stations',
  'owner cannot assign a branch that is not a station');
select lives_ok($$update public.profiles set status = 'active' where email = 'tst-sub@example.invalid'$$, 'owner approves the SUB account');
select lives_ok($$update public.profiles set status = 'active' where email = 'tst-kps@example.invalid'$$, 'owner approves the KPS account');
select lives_ok($$update public.profiles set branch_code = 'DPS', status = 'active' where email = 'tst-bad@example.invalid'$$,
  'owner assigns a branch and approves in one step');
reset role;
select is((select decided_by from public.profiles where email = 'tst-sub@example.invalid'),
          '11111111-1111-4111-8111-111111111111'::uuid, 'the approval records who decided');
select ok((select decided_at is not null from public.profiles where email = 'tst-sub@example.invalid'), 'the approval records when');

-- ------------------------------------------------------------- an approved station account
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
set local role authenticated;
insert into _r select 'sub_open', public.share_open(null);
insert into _r select 'sub_chk', public.share_save_check('', 'TST-SUB', 1, date '2026-10-12', 170, 70);
select is(pg_temp.err($q$select public.share_save_check(null, 'TST-DPS', 1, null, 170, 70)$q$), 'P0001 out_of_scope',
  'SUB account cannot write another station');
select is(pg_temp.err($q$select public.share_kps_save_staff_baseline(null, 'TST-SUB', 1, null, null, null, null, null, null, null, null)$q$),
  'P0001 forbidden_field pre_test', 'SUB account cannot use KPS-only writers');
reset role;
select is((select v ->> 'scope' from _r where pk = 'sub_open'), 'SUB', 'SUB account: scope SUB');
select is((select v ->> 'label' from _r where pk = 'sub_open'), 'Akun SUB', 'SUB account: label is the account name');
select is((select v -> 'link_id' from _r where pk = 'sub_open'), 'null'::jsonb, 'SUB account: no link id');
select is((select jsonb_array_length(v -> 'staff') from _r where pk = 'sub_open'), 1, 'SUB account sees only its station staff');
select is((select jsonb_array_length(v -> 'stations') from _r where pk = 'sub_open'), 1, 'SUB account sees only its station');
select is((select row(updated_by_link, updated_by_user)::text from public.bmi_checks where staff_code = 'TST-SUB' and period = 1),
          row(null::uuid, 'a0000000-0000-4000-8000-0000000000a1'::uuid)::text,
          'an account write is attributed to the account, not to a link');

-- ------------------------------------------------------------- an approved KPS account
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
set local role authenticated;
insert into _r select 'kps_open', public.share_open('  ');
select lives_ok($$select public.share_kps_save_staff_baseline(null, 'TST-DPS', 50, 90, null, null, null, null, null, null, null)$$,
  'KPS account can use KPS-only writers');
reset role;
select is((select v ->> 'scope' from _r where pk = 'kps_open'), 'KPS', 'KPS account: scope KPS');
select is((select jsonb_array_length(v -> 'staff') from _r where pk = 'kps_open'), 2, 'KPS account sees every station staff');

-- ------------------------------------------------------------- the reassigned account follows its new branch
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
set local role authenticated;
insert into _r select 'dps_open', public.share_open(null);
reset role;
select is((select v ->> 'scope' from _r where pk = 'dps_open'), 'DPS', 'reassigned account: scope DPS');
select is((select v #>> '{staff,0,code}' from _r where pk = 'dps_open'), 'TST-DPS', 'reassigned account sees DPS staff only');

-- ------------------------------------------------------------- deactivation and removal
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local role authenticated;
select lives_ok($$update public.profiles set status = 'inactive' where email = 'tst-sub@example.invalid'$$, 'owner deactivates the SUB account');
reset role;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.err('select public.share_open(null)'), 'P0001 invalid_link', 'inactive account: invalid_link again');
select is(pg_temp.err($q$select public.admin_delete_account('a0000000-0000-4000-8000-0000000000a2')$q$), '42501 not_authorised',
  'a non-owner cannot delete an account');
reset role;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.err($q$select public.admin_delete_account('11111111-1111-4111-8111-111111111111')$q$), 'P0001 cannot_delete_owner',
  'the owner cannot be removed through admin_delete_account');
select lives_ok($$select public.admin_delete_account('a0000000-0000-4000-8000-0000000000a1')$$, 'owner removes an account');
reset role;
select is((select count(*)::int from public.profiles where email = 'tst-sub@example.invalid'), 0, 'removing the auth user removes the profile');
select ok((select updated_by_user is distinct from 'a0000000-0000-4000-8000-0000000000a1'::uuid
             from public.bmi_checks where staff_code = 'TST-SUB' and period = 1),
  'data the removed account wrote is kept, and no longer points at the removed account');

-- A station that disappears from public.stations cannot be reached by an old profile.
delete from public.staff where station = 'DPS';
delete from public.stations where code = 'DPS';
select is((select count(*)::int from public.profiles where branch_code = 'DPS'), 1, 'precondition: the profile still names DPS');
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.err('select public.share_open(null)'), 'P0001 invalid_link', 'a profile naming a removed station reaches nothing');
reset role;

-- ------------------------------------------------------------- the e-mail copy follows auth.users
update auth.users set email = 'tst-kps-new@example.invalid' where id = 'a0000000-0000-4000-8000-0000000000a2';
select is((select email from public.profiles where id = 'a0000000-0000-4000-8000-0000000000a2'), 'tst-kps-new@example.invalid',
  'changing the auth e-mail updates the profile copy');

-- ------------------------------------------------------------- the public branch list
create temp table _branches as select array_agg(code order by sort) as codes from public.stations;
grant select on _branches to anon;
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select is(public.registration_branches(), (select codes from _branches),
  'anon reads the station codes through registration_branches() and nothing else');
reset role;

select * from finish();
rollback;
