-- Privileges: anon has nothing on any table/sequence; only the three share RPCs are callable by anon;
-- internals are not callable by API roles; future objects do not silently grant anon.
-- Run: supabase test db tests/sql
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ------------------------------------------------------------- catalogue checks (as postgres)
select ok(
  (select count(*) from pg_catalog.pg_tables where schemaname = 'public') >= 12,
  'all 12 public tables exist'
);

select has_table('public', t, format('table public.%s exists', t))
  from unnest(array[
    'stations', 'settings', 'staff', 'weekly_scores', 'bmi_checks', 'action_items',
    'replacements', 'weekly_reports', 'share_links', 'admins', 'sync_state', 'sync_conflicts'
  ]) as t;

select ok(c.relrowsecurity, format('RLS enabled on public.%s', c.relname))
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by c.relname;

select ok(
  not pg_catalog.has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  format('anon has no privilege on public.%s', c.relname)
)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
 order by c.relname;

select ok(
  not pg_catalog.has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE'),
  format('anon has no privilege on sequence public.%s', c.relname)
)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'S'
 order by c.relname;

select ok(
  not pg_catalog.has_table_privilege('authenticated', c.oid, 'TRUNCATE'),
  format('authenticated cannot TRUNCATE public.%s (would bypass RLS)', c.relname)
)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by c.relname;

-- Functions
select results_eq(
  $$ select p.proname::text collate "default"
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      order by 1 $$,
  $$ values ('pd_share_archive_action_plan'), ('pd_share_delete_monthly_report'), ('pd_share_delete_replacement'), ('pd_share_delete_staff'), ('pd_share_open'), ('pd_share_restore_action_plan'), ('pd_share_save_action_plan'), ('pd_share_save_check'), ('pd_share_save_monthly_report'), ('pd_share_save_replacement'), ('pd_share_save_staff'), ('registration_branches'), ('share_delete_replacement'), ('share_kps_save_staff_baseline'), ('share_kps_update_action_item'), ('share_open'), ('share_save_check'), ('share_save_profile'), ('share_save_replacement'), ('share_save_staff'), ('share_save_weekly_report'), ('share_save_weekly_score'), ('share_update_action_item') $$,
  'anon can execute exactly registration_branches + the share_* RPCs in public'
);

select results_eq(
  $$ select p.proname::text collate "default"
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      order by 1 $$,
  $$ values ('admin_delete_account'), ('is_admin'), ('pd_share_archive_action_plan'), ('pd_share_delete_monthly_report'), ('pd_share_delete_replacement'), ('pd_share_delete_staff'), ('pd_share_open'), ('pd_share_restore_action_plan'), ('pd_share_save_action_plan'), ('pd_share_save_check'), ('pd_share_save_monthly_report'), ('pd_share_save_replacement'), ('pd_share_save_staff'), ('registration_branches'), ('share_delete_replacement'), ('share_kps_save_staff_baseline'), ('share_kps_update_action_item'), ('share_open'), ('share_save_check'), ('share_save_profile'), ('share_save_replacement'), ('share_save_staff'), ('share_save_weekly_report'), ('share_save_weekly_score'), ('share_update_action_item') $$,
  'authenticated can execute exactly is_admin, admin_delete_account, registration_branches + the share_* RPCs in public'
);

select ok(
  pg_catalog.has_function_privilege('service_role', 'public.sync_claim_lease(integer)', 'EXECUTE')
  and pg_catalog.has_function_privilege('service_role', 'public.sync_release_lease(uuid, jsonb, text)', 'EXECUTE'),
  'service_role can execute the lease RPCs'
);

select ok(
  pg_catalog.has_function_privilege('service_role', 'public.pd_sync_claim_lease(integer)', 'EXECUTE')
  and pg_catalog.has_function_privilege('service_role', 'public.pd_sync_release_lease(uuid, jsonb, text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'public.pd_sync_claim_lease(integer)', 'EXECUTE'),
  'service_role (only) can execute the v2 lease RPCs'
);

select ok(
  not pg_catalog.has_schema_privilege('anon', 'private', 'USAGE')
  and not pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE'),
  'API roles have no USAGE on schema private'
);

select ok(
  not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
  format('private.%s is not executable by anon/authenticated', p.proname)
)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'private'
 order by p.proname;

select ok(
  exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'),
  format('%s.%s pins search_path', n.nspname, p.proname)
)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private')
 order by n.nspname, p.proname;

select results_eq(
  $$ select (n.nspname || '.' || p.proname) collate "default"
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
      order by 1 $$,
  $$ values ('private.check_link_scope'), ('private.check_report_group'), ('private.handle_new_user'), ('private.pd_check_link_scope'), ('private.pd_check_report_group'), ('private.pd_replacements_copy_staff'), ('private.pd_replacements_mark_replaced'), ('private.pd_settings_guard_bmi_periods'), ('private.pd_staff_assign_code'), ('private.pd_staff_refresh_replacements'), ('private.pd_staff_set_report_group'), ('private.pd_sync_ping'), ('private.rebuild_sheet_cek_bmi'), ('private.settings_guard_bmi_periods'), ('private.settings_rebuild_sheet_views'), ('private.sync_ping'), ('private.sync_profile_email'), ('public.admin_delete_account'), ('public.is_admin'), ('public.pd_share_archive_action_plan'), ('public.pd_share_delete_monthly_report'), ('public.pd_share_delete_replacement'), ('public.pd_share_delete_staff'), ('public.pd_share_open'), ('public.pd_share_restore_action_plan'), ('public.pd_share_save_action_plan'), ('public.pd_share_save_check'), ('public.pd_share_save_monthly_report'), ('public.pd_share_save_replacement'), ('public.pd_share_save_staff'), ('public.registration_branches'), ('public.share_delete_replacement'), ('public.share_kps_save_staff_baseline'), ('public.share_kps_update_action_item'), ('public.share_open'), ('public.share_save_check'), ('public.share_save_profile'), ('public.share_save_replacement'), ('public.share_save_staff'), ('public.share_save_weekly_report'), ('public.share_save_weekly_score'), ('public.share_update_action_item') $$,
  'SECURITY DEFINER is limited to is_admin, admin_delete_account, registration_branches, the share_* RPCs, the sign-up trigger, the BMI check guard, the station/report-group checks and the sync ping'
);

-- Future objects created by postgres in public do not grant anon (alter default privileges).
create table public.zz_default_priv_probe (id integer);
create sequence public.zz_default_priv_probe_seq;
create function public.zz_default_priv_probe_fn() returns integer language sql as 'select 1';

select ok(
  not pg_catalog.has_table_privilege('anon', 'public.zz_default_priv_probe', 'SELECT, INSERT, UPDATE, DELETE'),
  'a new public table grants nothing to anon'
);
select ok(
  not pg_catalog.has_sequence_privilege('anon', 'public.zz_default_priv_probe_seq', 'USAGE, SELECT, UPDATE'),
  'a new public sequence grants nothing to anon'
);
select ok(
  not exists (
    select 1
      from pg_catalog.pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = 'public.zz_default_priv_probe_fn()'::regprocedure
       and a.grantee = 'anon'::regrole
  ),
  'a new public function is not granted to anon directly (still revoke PUBLIC explicitly)'
);
drop function public.zz_default_priv_probe_fn();
drop sequence public.zz_default_priv_probe_seq;
drop table public.zz_default_priv_probe;

-- ------------------------------------------------------------- anon really is refused
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;

select throws_ok(
  format('select * from public.%I', c.relname), '42501', null,
  format('anon: SELECT on %s is denied', c.relname)
)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by c.relname;

select throws_ok(
  format('insert into public.%I default values', c.relname), '42501', null,
  format('anon: INSERT on %s is denied', c.relname)
)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by c.relname;

select throws_ok(
  format('update public.%I set %I = %I', c.relname, a.attname, a.attname), '42501', null,
  format('anon: UPDATE on %s is denied', c.relname)
)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = 1
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by c.relname;

select throws_ok(
  format('delete from public.%I', c.relname), '42501', null,
  format('anon: DELETE on %s is denied', c.relname)
)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by c.relname;

select throws_ok('select public.is_admin()', '42501', null, 'anon cannot call is_admin()');
select throws_ok('select public.sync_claim_lease(60)', '42501', null, 'anon cannot claim the sync lease');
select throws_ok(
  $$select public.sync_release_lease('00000000-0000-0000-0000-000000000000', null, null)$$,
  '42501', null, 'anon cannot release the sync lease'
);

reset role;

select * from finish();
rollback;
