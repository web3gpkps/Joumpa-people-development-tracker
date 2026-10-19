-- Link write RPCs, called as anon: in-scope success, cross-station writes (out_of_scope),
-- KPS-only fields from station links (forbidden_field), report-group scoping for action items,
-- validation (invalid_input + DETAIL), revoked links (invalid_link), and updated_by_link attribution.
-- Uses its own fixtures (TST-*); independent of seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ------------------------------------------------------------- fixtures (as postgres)
insert into public.share_links (token, scope, label, revoked_at) values
  (repeat('a1', 24), 'SUB', 'SUB', null),
  (repeat('c3', 24), 'KPS', 'KPS', null),
  (repeat('b2', 24), 'SUB', 'SUB dicabut', now()),
  (repeat('e5', 24), 'CGK', 'CGK', null),
  (repeat('f6', 24), 'HLP', 'HLP', null);

insert into public.staff (code, station, name, nipp, pre_test, post_test, score_a, report_conclusion, notes) values
  ('TST-SUB',  'SUB', 'Uji Sub',     'N-1', 60, 80, 4, 'Sesuai', 'catatan'),
  ('TST-SUB2', 'SUB', 'Uji Sub Dua', 'N-2', 60, 80, 4, null, null),
  ('TST-DPS',  'DPS', 'Uji Dps',     'N-3', 60, 80, 4, null, null),
  ('TST-KNO',  'KNO', 'Uji Kno',     'N-4', 60, 80, 4, null, null);

insert into public.action_items (code, report_group, area, kps_notes) values
  ('TST-SUB-TL01', 'SUB',       'area', 'catatan kps'),
  ('TST-DPS-TL01', 'DPS',       'area', null),
  ('TST-CH-TL01',  'CGK & HLP', 'area', null),
  ('TST-KNO-TL01', 'KNO',       'area', null);

insert into public.replacements (report_group, station, replaced_name) values
  ('SUB', 'SUB', 'Repl Sub'),
  ('DPS', 'DPS', 'Repl Dps');

-- error capture: '<SQLSTATE> <message>[ <detail>]', or 'ok'
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

create function pg_temp.link(p_token text) returns uuid
language sql as $$ select id from public.share_links where token = p_token $$;

create temp table _r (pk text primary key, v jsonb);
create temp table _ids as
select (select id from public.replacements where replaced_name = 'Repl Sub') as repl_sub,
       (select id from public.replacements where replaced_name = 'Repl Dps') as repl_dps;
grant select on _ids to anon;
grant select, insert on _r to anon;
create temp table _expect_tmb as
select 'TMB-' || case when n < 10 then '0' else '' end || n::text as code
  from (select coalesce(max(substring(code, '^TMB-([0-9]+)$')::int), 0) + 1 as n
          from public.staff where code ~ '^TMB-[0-9]+$') x;

set local request.jwt.claims = '{"role":"anon"}';
set local role anon;

-- ============================================================= weekly scores
insert into _r select 'ws', public.share_save_weekly_score(repeat('a1', 24), 'TST-SUB', 1, 4, 5, 3, null, null, null, ' Pak Obs ', 'catatan');
select is(pg_temp.err(format($q$select public.share_save_weekly_score(%L, 'TST-DPS', 1, 4, 4, 4, 4, 4, 4, null, null)$q$, repeat('a1', 24))),
  'P0001 out_of_scope', 'weekly score: SUB link cannot score DPS staff');
select is(pg_temp.err(format($q$select public.share_save_weekly_score(%L, 'TST-SUB', 1, 6, null, null, null, null, null, null, null)$q$, repeat('a1', 24))),
  '22023 invalid_input score_a', 'weekly score: score 6 rejected (DETAIL score_a)');
select is(pg_temp.err(format($q$select public.share_save_weekly_score(%L, 'TST-SUB', 1, 4, 4, 0, null, null, null, null, null)$q$, repeat('a1', 24))),
  '22023 invalid_input score_c', 'weekly score: score 0 rejected (DETAIL score_c)');
select is(pg_temp.err(format($q$select public.share_save_weekly_score(%L, 'TST-SUB', 11, 4, null, null, null, null, null, null, null)$q$, repeat('a1', 24))),
  '22023 invalid_input week', 'weekly score: week beyond settings.weeks rejected');
select is(pg_temp.err(format($q$select public.share_save_weekly_score(%L, 'TST-SUB', 0, 4, null, null, null, null, null, null, null)$q$, repeat('a1', 24))),
  '22023 invalid_input week', 'weekly score: week 0 rejected');
insert into _r select 'ws_kps', public.share_save_weekly_score(repeat('c3', 24), 'TST-KNO', 2, 3, 3, 3, 3, 3, 3, null, null);
insert into _r select 'ws_tmp', public.share_save_weekly_score(repeat('a1', 24), 'TST-SUB2', 3, 2, null, null, null, null, null, null, null);
insert into _r select 'ws_del', public.share_save_weekly_score(repeat('a1', 24), 'TST-SUB2', 3, null, null, null, null, null, null, '  ', '');

-- ============================================================= action items (progress fields)
insert into _r select 'ai_sub', public.share_update_action_item(repeat('a1', 24), 'TST-SUB-TL01', 'On Progress', 40, date '2026-10-15', ' foto ');
select is(pg_temp.err(format($q$select public.share_update_action_item(%L, 'TST-DPS-TL01', 'Selesai', 100, null, null)$q$, repeat('a1', 24))),
  'P0001 out_of_scope', 'action item: SUB link cannot update a DPS item');
insert into _r select 'ai_cgk', public.share_update_action_item(repeat('e5', 24), 'TST-CH-TL01', 'On Progress', 10, null, null);
insert into _r select 'ai_hlp', public.share_update_action_item(repeat('f6', 24), 'TST-CH-TL01', 'On Progress', 20, null, null);
select is(pg_temp.err(format($q$select public.share_update_action_item(%L, 'TST-KNO-TL01', 'Selesai', 100, null, null)$q$, repeat('e5', 24))),
  'P0001 out_of_scope', 'action item: CGK link cannot update a KNO item');
select is(pg_temp.err(format($q$select public.share_update_action_item(%L, 'NOPE-TL99', 'Selesai', 100, null, null)$q$, repeat('c3', 24))),
  'P0001 out_of_scope', 'action item: unknown code is out_of_scope');
select is(pg_temp.err(format($q$select public.share_update_action_item(%L, 'TST-SUB-TL01', 'Batal', 10, null, null)$q$, repeat('a1', 24))),
  '22023 invalid_input status', 'action item: unknown status rejected');
select is(pg_temp.err(format($q$select public.share_update_action_item(%L, 'TST-SUB-TL01', 'Selesai', 101, null, null)$q$, repeat('a1', 24))),
  '22023 invalid_input progress', 'action item: progress 101 rejected');
insert into _r select 'ai_kps', public.share_update_action_item(repeat('c3', 24), 'TST-KNO-TL01', 'Selesai', 100, date '2026-10-20', null);

-- ============================================================= action items (KPS-only fields)
select is(pg_temp.err(format($q$select public.share_kps_update_action_item(%L, 'TST-SUB-TL01', null, null, null, null, null, null, null, null, 'ubah')$q$, repeat('a1', 24))),
  'P0001 forbidden_field kps_notes', 'KPS-only: station link setting kps_notes gets forbidden_field (DETAIL kps_notes)');
select is(pg_temp.err(format($q$select public.share_kps_update_action_item(%L, 'TST-SUB-TL01', 'area baru', null, null, null, null, null, null, null, null)$q$, repeat('a1', 24))),
  'P0001 forbidden_field area', 'KPS-only: station link setting area gets forbidden_field (DETAIL area)');
select is(pg_temp.err(format($q$select public.share_kps_update_action_item(%L, 'TST-CH-TL01', null, null, null, null, null, null, 'jumat-berikutnya', null, null)$q$, repeat('e5', 24))),
  'P0001 forbidden_field due_rule', 'KPS-only: even an in-scope item stays forbidden for a station link');
insert into _r select 'kai', public.share_kps_update_action_item(repeat('c3', 24), 'TST-DPS-TL01', 'Area', 'Tindakan', 'Target', 'Rutin', 'Mingguan', null, 'jumat-berikutnya', 'PIC', 'catatan KPS');
select is(pg_temp.err(format($q$select public.share_kps_update_action_item(%L, 'TST-DPS-TL01', null, null, null, 'Harian', null, null, null, null, null)$q$, repeat('c3', 24))),
  '22023 invalid_input kind', 'KPS-only: bad kind rejected');
select is(pg_temp.err(format($q$select public.share_kps_update_action_item(%L, 'TST-DPS-TL01', null, null, null, null, null, null, 'tiap-hari', null, null)$q$, repeat('c3', 24))),
  '22023 invalid_input due_rule', 'KPS-only: bad due_rule rejected');
select is(pg_temp.err(format($q$select public.share_kps_update_action_item(%L, 'NOPE-TL99', null, null, null, null, null, null, null, null, null)$q$, repeat('c3', 24))),
  'P0001 out_of_scope', 'KPS-only: unknown item is out_of_scope');

-- ============================================================= replacements
insert into _r select 'rp_sub', public.share_save_replacement(repeat('a1', 24), null, null, null, 'TST-SUB2', null, 'Alasan', date '2026-10-10', 'Pengganti', null, null, 85, 4.2, 'Belum', null);
select is(pg_temp.err(format($q$select public.share_save_replacement(%L, null, 'DPS', null, null, 'X', null, null, null, null, null, null, null, null, null)$q$, repeat('a1', 24))),
  'P0001 out_of_scope', 'replacement: SUB link cannot add a DPS row');
select is(pg_temp.err(format($q$select public.share_save_replacement(%L, null, null, null, 'TST-DPS', null, null, null, null, null, null, null, null, null, null)$q$, repeat('a1', 24))),
  'P0001 out_of_scope', 'replacement: SUB link cannot link a DPS staff member');
select is(pg_temp.err(format($q$select public.share_save_replacement(%L, %s, null, null, null, 'X', null, null, null, null, null, null, null, null, null)$q$,
    repeat('a1', 24), (select repl_dps from _ids))),
  'P0001 out_of_scope', 'replacement: SUB link cannot edit a DPS row');
select is(pg_temp.err(format($q$select public.share_delete_replacement(%L, %s)$q$,
    repeat('a1', 24), (select repl_dps from _ids))),
  'P0001 out_of_scope', 'replacement: SUB link cannot delete a DPS row');
select is(pg_temp.err(format($q$select public.share_delete_replacement(%L, -1)$q$, repeat('c3', 24))),
  'P0001 out_of_scope', 'replacement: unknown id is out_of_scope');
select is(pg_temp.err(format($q$select public.share_save_replacement(%L, null, null, null, null, '  ', null, null, null, null, null, null, null, null, null)$q$, repeat('a1', 24))),
  '22023 invalid_input replaced_name', 'replacement: name required');
select is(pg_temp.err(format($q$select public.share_save_replacement(%L, null, null, null, null, 'X', null, null, null, null, null, null, null, 'Tidak', null)$q$, repeat('a1', 24))),
  '22023 invalid_input reported', 'replacement: reported must be Ya/Belum');
select is(pg_temp.err(format($q$select public.share_save_replacement(%L, null, null, null, null, 'X', null, null, null, null, null, 120, null, null, null)$q$, repeat('a1', 24))),
  '22023 invalid_input post_test', 'replacement: post_test 0..100');
select is(pg_temp.err(format($q$select public.share_save_replacement(%L, null, null, 'DPS', null, 'X', null, null, null, null, null, null, null, null, null)$q$, repeat('a1', 24))),
  '22023 invalid_input report_group', 'replacement: report group must match the station');
insert into _r select 'rp_upd', public.share_save_replacement(repeat('a1', 24),
  (select repl_sub from _ids), null, null, null, 'Repl Sub', 'diubah', null, null, null, null, null, null, 'Ya', null);
insert into _r select 'rp_cgk', public.share_save_replacement(repeat('e5', 24), null, 'cgk', null, null, 'Repl Cgk', null, null, null, null, null, null, null, null, null);
insert into _r select 'rp_kps', public.share_save_replacement(repeat('c3', 24), null, null, null, 'TST-KNO', null, null, null, null, null, null, null, null, null, null);
insert into _r select 'rp_kps_grp', public.share_save_replacement(repeat('c3', 24), null, null, 'CGK & HLP', null, 'Tanpa stasiun', null, null, null, null, null, null, null, null, null);
select is(pg_temp.err(format($q$select public.share_save_replacement(%L, null, 'DPS', null, 'TST-SUB', null, null, null, null, null, null, null, null, null, null)$q$, repeat('c3', 24))),
  '22023 invalid_input staff_code', 'replacement: KPS cannot link a staff member of another station');
select is(pg_temp.err(format($q$select public.share_save_replacement(%L, null, 'JKT', null, null, 'X', null, null, null, null, null, null, null, null, null)$q$, repeat('c3', 24))),
  '22023 invalid_input station', 'replacement: KPS unknown station rejected');
insert into _r select 'rp_del', public.share_delete_replacement(repeat('a1', 24), (select repl_sub from _ids));

-- ============================================================= staff
insert into _r select 'st_new', public.share_save_staff(repeat('a1', 24), null, null, ' Staf Baru ', '123', 'l', null, null);
insert into _r select 'st_new2', public.share_save_staff(repeat('a1', 24), null, 'SUB', 'Staf Baru Dua', null, null, 'Coaching 30 Hari', null);
select is(pg_temp.err(format($q$select public.share_save_staff(%L, null, 'DPS', 'X', null, null, null, null)$q$, repeat('a1', 24))),
  'P0001 out_of_scope', 'staff: SUB link cannot add staff to DPS');
select is(pg_temp.err(format($q$select public.share_save_staff(%L, 'TST-DPS', null, 'X', null, null, null, null)$q$, repeat('a1', 24))),
  'P0001 out_of_scope', 'staff: SUB link cannot edit DPS staff');
select is(pg_temp.err(format($q$select public.share_save_staff(%L, 'TST-SUB2', 'DPS', 'Uji Sub Dua', null, null, null, null)$q$, repeat('a1', 24))),
  'P0001 out_of_scope', 'staff: SUB link cannot move its staff to another station');
select is(pg_temp.err(format($q$select public.share_save_staff(%L, 'TST-SUB2', null, '   ', null, null, null, null)$q$, repeat('a1', 24))),
  '22023 invalid_input name', 'staff: name required');
select is(pg_temp.err(format($q$select public.share_save_staff(%L, 'TST-SUB2', null, 'X', null, 'Z', null, null)$q$, repeat('a1', 24))),
  '22023 invalid_input gender', 'staff: gender must be L/P');
select is(pg_temp.err(format($q$select public.share_save_staff(%L, 'TST-SUB2', null, 'X', null, null, 'Cuti', null)$q$, repeat('a1', 24))),
  '22023 invalid_input assignment_status', 'staff: assignment_status is enumerated');
select is(pg_temp.err(format($q$select public.share_save_staff(%L, null, null, 'X', null, null, null, null)$q$, repeat('c3', 24))),
  '22023 invalid_input station', 'staff: KPS must name a station on insert');
insert into _r select 'st_upd', public.share_save_staff(repeat('a1', 24), 'TST-SUB', null, 'Uji Sub Baru', 'N-1b', 'P', 'Coaching 30 Hari', 'catatan baru');
insert into _r select 'st_move', public.share_save_staff(repeat('c3', 24), 'TST-SUB2', 'KNO', 'Uji Sub Dua', null, null, null, null);

-- ============================================================= staff baseline (KPS-only)
select is(pg_temp.err(format($q$select public.share_kps_save_staff_baseline(%L, 'TST-SUB', 70, null, null, null, null, null, null, null, null)$q$, repeat('a1', 24))),
  'P0001 forbidden_field pre_test', 'baseline: station link gets forbidden_field (DETAIL pre_test)');
select is(pg_temp.err(format($q$select public.share_kps_save_staff_baseline(%L, 'TST-SUB', null, null, null, null, null, null, null, null, 'Sesuai')$q$, repeat('a1', 24))),
  'P0001 forbidden_field report_conclusion', 'baseline: station link setting report_conclusion gets forbidden_field');
insert into _r select 'bl', public.share_kps_save_staff_baseline(repeat('c3', 24), 'TST-DPS', 55, 88, 4, 4, 5, 3, 4, 4, 'Sesuai dengan Catatan');
select is(pg_temp.err(format($q$select public.share_kps_save_staff_baseline(%L, 'TST-DPS', null, null, null, null, 6, null, null, null, null)$q$, repeat('c3', 24))),
  '22023 invalid_input score_c', 'baseline: score 6 rejected');
select is(pg_temp.err(format($q$select public.share_kps_save_staff_baseline(%L, 'TST-DPS', null, 101, null, null, null, null, null, null, null)$q$, repeat('c3', 24))),
  '22023 invalid_input post_test', 'baseline: post_test 0..100');
select is(pg_temp.err(format($q$select public.share_kps_save_staff_baseline(%L, 'TST-DPS', null, null, null, null, null, null, null, null, 'Bagus')$q$, repeat('c3', 24))),
  '22023 invalid_input report_conclusion', 'baseline: report_conclusion is enumerated');
select is(pg_temp.err(format($q$select public.share_kps_save_staff_baseline(%L, 'NOPE-99', null, null, null, null, null, null, null, null, null)$q$, repeat('c3', 24))),
  'P0001 out_of_scope', 'baseline: unknown staff is out_of_scope');

-- ============================================================= weekly report (findings)
insert into _r select 'wr_sub', public.share_save_weekly_report(repeat('a1', 24), 2, ' temuan SUB ');
insert into _r select 'wr_kps', public.share_save_weekly_report(repeat('c3', 24), 2, 'temuan KPS');
select is(pg_temp.err(format($q$select public.share_save_weekly_report(%L, 11, 'x')$q$, repeat('a1', 24))),
  '22023 invalid_input week', 'weekly report: week beyond settings.weeks rejected');
insert into _r select 'wr_tmp', public.share_save_weekly_report(repeat('a1', 24), 3, 'sementara');
insert into _r select 'wr_del', public.share_save_weekly_report(repeat('a1', 24), 3, '   ');

-- ============================================================= revoked link: every writer refuses
select is(pg_temp.err(c), 'P0001 invalid_link', 'revoked link: ' || split_part(c, '(', 1))
  from unnest(array[
    format($q$select public.share_save_weekly_score(%L, 'TST-SUB', 1, 4, null, null, null, null, null, null, null)$q$, repeat('b2', 24)),
    format($q$select public.share_save_check(%L, 'TST-SUB', 1, null, 170, 60)$q$, repeat('b2', 24)),
    format($q$select public.share_save_profile(%L, 'TST-SUB', 'L', null)$q$, repeat('b2', 24)),
    format($q$select public.share_update_action_item(%L, 'TST-SUB-TL01', 'Selesai', 100, null, null)$q$, repeat('b2', 24)),
    format($q$select public.share_kps_update_action_item(%L, 'TST-SUB-TL01', null, null, null, null, null, null, null, null, null)$q$, repeat('b2', 24)),
    format($q$select public.share_save_replacement(%L, null, null, null, null, 'X', null, null, null, null, null, null, null, null, null)$q$, repeat('b2', 24)),
    format($q$select public.share_delete_replacement(%L, 1)$q$, repeat('b2', 24)),
    format($q$select public.share_save_staff(%L, null, null, 'X', null, null, null, null)$q$, repeat('b2', 24)),
    format($q$select public.share_kps_save_staff_baseline(%L, 'TST-SUB', null, null, null, null, null, null, null, null, null)$q$, repeat('b2', 24)),
    format($q$select public.share_save_weekly_report(%L, 1, 'x')$q$, repeat('b2', 24))
  ]) as c;

reset role;

-- ============================================================= verify as postgres
-- weekly scores
select is((select v -> 'row' ->> 'observer' from _r where pk = 'ws'), 'Pak Obs', 'weekly score: returns the stored row (observer trimmed)');
select ok((select not (v -> 'row' ? 'updated_by') from _r where pk = 'ws'), 'weekly score: row hides updated_by');
select is((select row(score_a, score_b, score_c, score_d, updated_by_link, updated_by)::text from public.weekly_scores where staff_code = 'TST-SUB' and week = 1),
          row(4, 5, 3, null::int, pg_temp.link(repeat('a1', 24)), null::uuid)::text,
          'weekly score: stored, attributed to the SUB link, updated_by NULL');
select is((select updated_by_link from public.weekly_scores where staff_code = 'TST-KNO' and week = 2),
          pg_temp.link(repeat('c3', 24)), 'weekly score: KPS can score any station');
select is((select v from _r where pk = 'ws_del'), '{"deleted": true, "row": {"staff_code": "TST-SUB2", "week": 3}}'::jsonb,
          'weekly score: all empty returns the deleted key');
select is((select count(*) from public.weekly_scores where staff_code = 'TST-SUB2' and week = 3), 0::bigint, 'weekly score: all empty deletes the row');
select is((select count(*) from public.weekly_scores where staff_code = 'TST-DPS'), 0::bigint, 'weekly score: nothing written for DPS');

-- action items
select is((select row(status, progress, updated_on, evidence, kps_notes, updated_by_link)::text from public.action_items where code = 'TST-SUB-TL01'),
          row('On Progress', 40, date '2026-10-15', 'foto', 'catatan kps', pg_temp.link(repeat('a1', 24)))::text,
          'action item: progress fields written, kps_notes untouched, attributed to the link');
select is((select row(status, progress)::text from public.action_items where code = 'TST-DPS-TL01'), row('Belum Mulai', 0)::text,
          'action item: DPS item untouched by the SUB link');
select is((select row(progress, updated_by_link)::text from public.action_items where code = 'TST-CH-TL01'),
          row(20, pg_temp.link(repeat('f6', 24)))::text, 'action item: CGK and HLP links both work on the CGK & HLP item (last write wins)');
select is((select (v -> 'row' ->> 'progress')::int from _r where pk = 'ai_cgk'), 10, 'action item: CGK link update returned its row');
select is((select row(status, progress)::text from public.action_items where code = 'TST-KNO-TL01'), row('Selesai', 100)::text,
          'action item: KPS can update any report group');
select is((select row(area, action, target, kind, schedule, due_rule, pic, kps_notes, updated_by_link)::text from public.action_items where code = 'TST-DPS-TL01'),
          row('Area', 'Tindakan', 'Target', 'Rutin', 'Mingguan', 'jumat-berikutnya', 'PIC', 'catatan KPS', pg_temp.link(repeat('c3', 24)))::text,
          'KPS-only: definition fields + kps_notes written by KPS');
select is((select kps_notes from public.action_items where code = 'TST-SUB-TL01'), 'catatan kps', 'KPS-only: forbidden calls changed nothing');

-- replacements
select is((select row(station, report_group, staff_code, replaced_name, post_test, practice_avg, reported, updated_by_link)::text
             from public.replacements where id = (select (v -> 'row' ->> 'id')::bigint from _r where pk = 'rp_sub')),
          row('SUB', 'SUB', 'TST-SUB2', 'Uji Sub Dua', 85::numeric, 4.2, 'Belum', pg_temp.link(repeat('a1', 24)))::text,
          'replacement: station forced to SUB, group derived, name defaults to the linked staff member, attributed');
select ok((select (v -> 'row' ->> 'sort_order') is not null from _r where pk = 'rp_sub'), 'replacement: new rows get a sort_order');
select is((select v ->> 'deleted' from _r where pk = 'rp_upd'), 'false', 'replacement: SUB link edits its own row');
select is((select row(station, report_group)::text from public.replacements where replaced_name = 'Repl Cgk'),
          row('CGK', 'CGK & HLP')::text, 'replacement: CGK link row gets report group CGK & HLP');
select is((select row(station, report_group, replaced_name)::text from public.replacements
            where id = (select (v -> 'row' ->> 'id')::bigint from _r where pk = 'rp_kps')),
          row('KNO', 'KNO', 'Uji Kno')::text, 'replacement: KPS row takes station and name from the linked staff member');
select is((select row(station, report_group)::text from public.replacements where replaced_name = 'Tanpa stasiun'),
          row(null::text, 'CGK & HLP')::text, 'replacement: KPS may file a row by report group only');
select is((select v from _r where pk = 'rp_del'),
          jsonb_build_object('deleted', true, 'row', jsonb_build_object('id', (select (v -> 'row' ->> 'id')::bigint from _r where pk = 'rp_upd'))),
          'replacement: delete returns the deleted id');
select is((select count(*) from public.replacements where replaced_name = 'Repl Sub'), 0::bigint, 'replacement: SUB link deleted its own row');
select is((select count(*) from public.replacements where replaced_name = 'Repl Dps'), 1::bigint, 'replacement: DPS row survived');

-- staff
select is((select v -> 'row' ->> 'code' from _r where pk = 'st_new'), (select code from _expect_tmb), 'staff: new staff gets the next TMB-xx code');
select ok((select v -> 'row' ->> 'code' from _r where pk = 'st_new2') ~ '^TMB-[0-9]{2,}$'
          and (select v -> 'row' ->> 'code' from _r where pk = 'st_new2') <> (select v -> 'row' ->> 'code' from _r where pk = 'st_new'),
          'staff: a second insert gets a different TMB code');
select is((select row(station, name, nipp, gender, assignment_status, updated_by_link)::text from public.staff
            where code = (select v -> 'row' ->> 'code' from _r where pk = 'st_new')),
          row('SUB', 'Staf Baru', '123', 'L', 'Aktif', pg_temp.link(repeat('a1', 24)))::text,
          'staff: insert defaults station to the link, assignment to Aktif, trims, attributes');
select is((select row(name, nipp, gender, assignment_status, notes, pre_test, score_a, report_conclusion)::text from public.staff where code = 'TST-SUB'),
          row('Uji Sub Baru', 'N-1b', 'P', 'Coaching 30 Hari', 'catatan baru', 60::numeric, 4::smallint, 'Sesuai')::text,
          'staff: update writes profile fields and leaves the baseline alone');
select is((select station from public.staff where code = 'TST-SUB2'), 'KNO', 'staff: KPS can move staff between stations');
select is((select row(pre_test, post_test, score_a, score_c, score_f, report_conclusion, updated_by_link)::text from public.staff where code = 'TST-DPS'),
          row(55::numeric, 88::numeric, 4::smallint, 5::smallint, 4::smallint, 'Sesuai dengan Catatan', pg_temp.link(repeat('c3', 24)))::text,
          'baseline: KPS writes the training baseline');
select is((select row(pre_test, report_conclusion)::text from public.staff where code = 'TST-SUB'), row(60::numeric, 'Sesuai')::text,
          'baseline: forbidden calls changed nothing');

-- weekly reports
select is((select row(scope, findings, updated_by_link)::text from public.weekly_reports where week = 2 and scope = 'SUB'),
          row('SUB', 'temuan SUB', pg_temp.link(repeat('a1', 24)))::text, 'weekly report: SUB link writes the SUB row');
select is((select row(scope, findings, updated_by_link)::text from public.weekly_reports where week = 2 and scope = 'KPS'),
          row('KPS', 'temuan KPS', pg_temp.link(repeat('c3', 24)))::text, 'weekly report: KPS link writes its own KPS row');
select is((select v from _r where pk = 'wr_del'), '{"deleted": true, "row": {"week": 3, "scope": "SUB"}}'::jsonb,
          'weekly report: blank findings returns the deleted key');
select is((select count(*) from public.weekly_reports where week = 3), 0::bigint, 'weekly report: blank findings deletes the row');

-- attribution: owner / service writes clear updated_by_link
update public.staff set notes = 'oleh pemilik' where code = 'TST-SUB';
select ok((select updated_by_link is null from public.staff where code = 'TST-SUB'), 'attribution: a non-link write clears updated_by_link');
select is(current_setting('joumpa.share_link_id', true), '', 'attribution: no link id leaks past an RPC');

select * from finish();
rollback;
