-- Owner access: a signed-in admin calls every share_* function with p_token NULL / blank and is
-- treated as scope KPS with no link (updated_by_link NULL, no share_links row touched).
-- Non-admins and anon with NULL / blank get invalid_link. Owner-only direct table writes
-- (create / delete action items, delete staff with its cascades) work under the admin RLS policy.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'tst-owner@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'tst-user@example.invalid');
insert into public.admins (user_id, email) values ('11111111-1111-4111-8111-111111111111', 'tst-owner@example.invalid');

insert into public.share_links (token, scope, label) values
  (repeat('a1', 24), 'SUB', 'SUB'),
  (repeat('c3', 24), 'KPS', 'KPS');

insert into public.staff (code, station, name, pre_test) values
  ('TST-SUB', 'SUB', 'Uji Sub', 60),
  ('TST-DPS', 'DPS', 'Uji Dps', 60),
  ('TST-KNO', 'KNO', 'Uji Kno', 60);
insert into public.weekly_scores (staff_code, week, score_a) values ('TST-KNO', 1, 4);
insert into public.bmi_checks (staff_code, period, height_cm, weight_kg) values ('TST-KNO', 1, 165, 60);
insert into public.action_items (code, report_group) values ('TST-SUB-TL01', 'SUB'), ('TST-KNO-TL01', 'KNO');
insert into public.replacements (report_group, station, staff_code, replaced_name) values
  ('KNO', 'KNO', 'TST-KNO', 'Uji Kno'),
  ('DPS', 'DPS', null, 'Repl Dps');

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
create temp table _ids as
select (select id from public.replacements where replaced_name = 'Repl Dps') as repl_dps;
grant select on _ids to authenticated;

-- A link writes first, so the owner's writes must visibly clear updated_by_link.
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
insert into _r select 'link_staff', public.share_save_staff(repeat('a1', 24), 'TST-SUB', null, 'Uji Sub', null, null, null, null);
insert into _r select 'link_ai', public.share_update_action_item(repeat('a1', 24), 'TST-SUB-TL01', 'On Progress', 10, null, null);
reset role;
select is((select updated_by_link from public.staff where code = 'TST-SUB'),
          (select id from public.share_links where token = repeat('a1', 24)), 'precondition: link write attributed');

create temp table _used_before as select id, last_used_at from public.share_links;
create temp table _counts as
select (select count(*)::int from public.staff) as staff, (select count(*)::int from public.action_items) as items,
       (select count(*)::int from public.replacements) as repl, (select count(*)::int from public.weekly_scores) as scores;

-- ------------------------------------------------------------- owner (admin, NULL / blank token)
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local role authenticated;

insert into _r select 'open_null',  public.share_open(null);
insert into _r select 'open_empty', public.share_open('');
insert into _r select 'open_blank', public.share_open('   ');

insert into _r select 'ws',   public.share_save_weekly_score(null, 'TST-DPS', 1, 4, 4, 4, 4, 4, 4, 'Pemilik', null);
insert into _r select 'chk',  public.share_save_check(null, 'TST-DPS', 1, date '2026-10-12', 170, 70);
insert into _r select 'prof', public.share_save_profile('', 'TST-DPS', 'L', 'catatan');
insert into _r select 'ai',   public.share_update_action_item(null, 'TST-SUB-TL01', 'Selesai', 100, date '2026-10-08', null);
insert into _r select 'kai',  public.share_kps_update_action_item(null, 'TST-KNO-TL01', 'Area', 'Aksi', null, 'Rutin', null, null, 'jumat-berikutnya', 'PIC', 'catatan pemilik');
insert into _r select 'rp',   public.share_save_replacement(null, null, 'SUB', null, 'TST-SUB', null, 'alasan', null, null, null, null, null, null, 'Belum', null);
insert into _r select 'rpd',  public.share_delete_replacement(null, (select repl_dps from _ids));
insert into _r select 'st',   public.share_save_staff(null, 'TST-SUB', null, 'Uji Sub Pemilik', null, null, null, null);
insert into _r select 'stn',  public.share_save_staff(null, null, 'HLP', 'Staf Baru Pemilik', null, 'P', null, null);
insert into _r select 'bl',   public.share_kps_save_staff_baseline(null, 'TST-DPS', 50, 90, 4, 4, 4, 4, 4, 4, 'Sesuai');
insert into _r select 'wr',   public.share_save_weekly_report(null, 1, 'temuan pemilik');

select is(pg_temp.err($q$select public.share_save_staff(null, null, null, 'X', null, null, null, null)$q$),
  '22023 invalid_input station', 'owner path keeps the same validation (KPS must name a station)');
select is(pg_temp.err($q$select public.share_save_weekly_score(null, 'TST-DPS', 1, 9, null, null, null, null, null, null, null)$q$),
  '22023 invalid_input score_a', 'owner path keeps the same validation (score range)');
select is(pg_temp.err($q$select public.share_save_check(null, 'NOPE-99', 1, null, 170, 70)$q$),
  'P0001 out_of_scope', 'owner path: unknown staff is still out_of_scope');

-- Owner-only direct table writes under the admin RLS policy
select lives_ok($$insert into public.action_items (code, report_group) values ('TST-NEW-TL01', 'KNO')$$,
  'owner can create an action item with just code + report_group');
select throws_ok($$insert into public.action_items (code, report_group) values (' TST-X ', 'KNO')$$, '23514', null,
  'action item code must be non-blank without surrounding spaces (action_items_code_check)');
select throws_ok($$insert into public.action_items (code) values ('TST-X')$$, '23502', null,
  'action item needs a report_group (NOT NULL)');
select throws_ok($$insert into public.action_items (code, report_group) values ('TST-X', 'CGK')$$, '23514', null,
  'action item report_group must be SUB / DPS / CGK & HLP / KNO');
select throws_ok($$insert into public.action_items (code, report_group) values ('TST-SUB-TL01', 'SUB')$$, '23505', null,
  'action item code must be unique');
with d as (delete from public.action_items where code = 'TST-NEW-TL01' returning 1)
select is(count(*)::int, 1, 'owner can delete an action item') from d;
with d as (delete from public.staff where code = 'TST-KNO' returning 1)
select is(count(*)::int, 1, 'owner can delete a staff member') from d;
reset role;

-- ------------------------------------------------------------- verify owner results (as postgres)
select is((select v ->> 'scope' from _r where pk = 'open_null'), 'KPS', 'owner share_open(NULL): scope KPS');
select is((select v -> 'link_id' from _r where pk = 'open_null'), 'null'::jsonb, 'owner share_open(NULL): link_id null');
select is((select v ->> 'label' from _r where pk = 'open_null'), 'Pemilik', 'owner share_open(NULL): label Pemilik');
select is((select jsonb_array_length(v -> 'stations') from _r where pk = 'open_null'), (select count(*)::int from public.stations), 'owner sees every station');
select is((select jsonb_array_length(v -> 'staff') from _r where pk = 'open_null'), (select staff from _counts), 'owner sees every staff member');
select is((select jsonb_array_length(v -> 'action_items') from _r where pk = 'open_null'), (select items from _counts), 'owner sees every action item');
select is((select jsonb_array_length(v -> 'replacements') from _r where pk = 'open_null'), (select repl from _counts), 'owner sees every replacement');
select is((select jsonb_array_length(v -> 'weekly_scores') from _r where pk = 'open_null'), (select scores from _counts), 'owner sees every weekly score');
select ok((select v -> 'link_labels' ? (select id::text from public.share_links where token = repeat('a1', 24)) from _r where pk = 'open_null'),
  'owner link_labels still resolve link edits');
select is((select v - 'link_labels' from _r where pk = 'open_empty'), (select v - 'link_labels' from _r where pk = 'open_null'),
  'empty-string token = NULL token');
select is((select v - 'link_labels' from _r where pk = 'open_blank'), (select v - 'link_labels' from _r where pk = 'open_null'),
  'blank token = NULL token');
select is(
  (select count(*) from public.share_links l join _used_before u using (id)
    where l.last_used_at is distinct from u.last_used_at),
  0::bigint, 'owner calls (NULL / blank token) touch no share_links row');

select is((select row(updated_by_link, updated_by, observer)::text from public.weekly_scores where staff_code = 'TST-DPS' and week = 1),
          row(null::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'Pemilik')::text,
          'owner weekly score: updated_by_link NULL, updated_by = owner');
select is((select row(updated_by_link, updated_by_user)::text from public.bmi_checks where staff_code = 'TST-DPS' and period = 1),
          row(null::uuid, '11111111-1111-4111-8111-111111111111'::uuid)::text,
          'owner BMI check: updated_by_link NULL, updated_by_user = owner');
select ok((select updated_by_link is null and gender = 'L' and pre_test = 50 and report_conclusion = 'Sesuai'
             from public.staff where code = 'TST-DPS'), 'owner profile + KPS-only baseline written, no link');
select ok((select updated_by_link is null and name = 'Uji Sub Pemilik' from public.staff where code = 'TST-SUB'),
  'owner staff update clears the earlier link attribution');
select ok((select updated_by_link is null and status = 'Selesai' from public.action_items where code = 'TST-SUB-TL01'),
  'owner action-item update clears the earlier link attribution');
select ok((select updated_by_link is null and kps_notes = 'catatan pemilik' and due_rule = 'jumat-berikutnya'
             from public.action_items where code = 'TST-KNO-TL01'), 'owner KPS-only action-item fields written, no link');
select ok((select (v -> 'row' -> 'updated_by_link') = 'null'::jsonb and v -> 'row' ->> 'station' = 'SUB' from _r where pk = 'rp'),
  'owner replacement insert, no link');
select is((select count(*) from public.replacements where replaced_name = 'Repl Dps'), 0::bigint, 'owner replacement delete');
select ok((select v -> 'row' ->> 'code' ~ '^TMB-[0-9]{2,}$' and v -> 'row' ->> 'station' = 'HLP' from _r where pk = 'stn'),
  'owner staff insert gets a TMB code in the named station');
select is((select row(scope, findings, updated_by_link)::text from public.weekly_reports where week = 1 and scope = 'KPS'),
          row('KPS', 'temuan pemilik', null::uuid)::text, 'owner weekly report is the KPS row, no link');
select is(current_setting('joumpa.share_link_id', true), '', 'no link id leaks past owner RPCs');

-- staff delete cascades
select is((select count(*) from public.weekly_scores where staff_code = 'TST-KNO'), 0::bigint, 'staff delete cascades weekly_scores');
select is((select count(*) from public.bmi_checks where staff_code = 'TST-KNO'), 0::bigint, 'staff delete cascades bmi_checks');
select ok((select staff_code is null from public.replacements where replaced_name = 'Uji Kno'),
  'staff delete keeps the replacement row and sets staff_code NULL');

-- An admin passing a real link token still gets that link (unchanged behaviour).
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local role authenticated;
insert into _r select 'open_link', public.share_open(repeat('a1', 24));
reset role;
select is((select v ->> 'scope' from _r where pk = 'open_link'), 'SUB', 'admin + real SUB token: scope SUB');
select is((select (v ->> 'link_id')::uuid from _r where pk = 'open_link'),
          (select id from public.share_links where token = repeat('a1', 24)), 'admin + real SUB token: link_id set');
select ok((select last_used_at is not null from public.share_links where token = repeat('a1', 24)), 'admin + real token touches that link');

-- ------------------------------------------------------------- NULL / blank token for anyone else
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.err('select public.share_open(null)'), 'P0001 invalid_link', 'non-admin + NULL token: share_open invalid_link');
select is(pg_temp.err($q$select public.share_open('')$q$), 'P0001 invalid_link', 'non-admin + empty token: invalid_link');
select is(pg_temp.err($q$select public.share_save_weekly_report(null, 1, 'x')$q$), 'P0001 invalid_link', 'non-admin + NULL token: writer invalid_link');
select is(pg_temp.err($q$select public.share_kps_save_staff_baseline(null, 'TST-DPS', 1, null, null, null, null, null, null, null, null)$q$),
  'P0001 invalid_link', 'non-admin + NULL token: KPS-only writer invalid_link');
with d as (delete from public.staff returning 1)
select is(count(*)::int, 0, 'non-admin cannot delete staff (0 rows)') from d;
select throws_ok($$insert into public.action_items (code, report_group) values ('TST-Y', 'SUB')$$, '42501', null,
  'non-admin cannot create action items (RLS)');
reset role;

set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select is(pg_temp.err('select public.share_open(null)'), 'P0001 invalid_link', 'anon + NULL token: invalid_link');
select is(pg_temp.err($q$select public.share_open('  ')$q$), 'P0001 invalid_link', 'anon + blank token: invalid_link');
select is(pg_temp.err($q$select public.share_save_check(null, 'TST-DPS', 1, null, 170, 70)$q$), 'P0001 invalid_link', 'anon + NULL token: writer invalid_link');
reset role;

set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
select is(pg_temp.err('select public.share_open(null)'), 'P0001 invalid_link', 'service_role + NULL token: invalid_link (not an admin)');
reset role;

select is((select count(*)::int from public.staff), (select staff from _counts),
  'staff count back to the start (owner added 1, deleted 1; non-admin deleted nothing)');

select * from finish();
rollback;
