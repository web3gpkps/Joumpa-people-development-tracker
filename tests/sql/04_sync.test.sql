-- Sheets sync support: lease RPCs, change-ping triggers, debounce, and "never fails the write".
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select has_trigger('public', t, t || '_sync_ping', format('%s has the change-ping trigger', t))
  from unnest(array['staff', 'weekly_scores', 'bmi_checks', 'action_items', 'replacements',
                    'settings', 'weekly_reports']) as t;
select is(
  (select count(*) from pg_catalog.pg_trigger tg
     join pg_catalog.pg_class c on c.oid = tg.tgrelid
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and tg.tgname like '%_sync_ping'
      and c.relname in ('share_links', 'admins', 'sync_state', 'sync_conflicts', 'stations')),
  0::bigint,
  'never-synced tables have no change-ping trigger'
);

-- ------------------------------------------------------------- lease
select is((select lease_token from public.sync_state), null::uuid, 'no lease held initially');

create temp table _lease as select public.sync_claim_lease(60) as token;
select isnt((select token from _lease), null::uuid, 'first claim returns a token');
select is(public.sync_claim_lease(60), null::uuid, 'second claim while held returns NULL');
select is(public.sync_release_lease(gen_random_uuid(), '{"x":1}'::jsonb, null), false, 'release with a wrong token returns false');
select is((select baseline from public.sync_state), '{}'::jsonb, 'wrong-token release changes nothing');

select is(
  public.sync_release_lease((select token from _lease), '{"staff":{"TST":{"name":"a"}}}'::jsonb, null),
  true,
  'release with the right token returns true'
);
select is(
  (select row(baseline, initialized, failures, last_error, lease_token, lease_until)::text from public.sync_state),
  row('{"staff":{"TST":{"name":"a"}}}'::jsonb, true, 0, null::text, null::uuid, null::timestamptz)::text,
  'successful release stores baseline, sets initialized, clears lease and error'
);
select ok((select last_success_at is not null from public.sync_state), 'successful release sets last_success_at');

update _lease set token = public.sync_claim_lease(60);
select is(public.sync_release_lease((select token from _lease), null, 'boom'), true, 'release with an error');
select is(
  (select row(baseline, failures, last_error)::text from public.sync_state),
  row('{"staff":{"TST":{"name":"a"}}}'::jsonb, 1, 'boom')::text,
  'failed release keeps baseline (p_baseline NULL), counts the failure, records the error'
);

-- expired lease can be taken over; the old holder's release is then refused
update _lease set token = public.sync_claim_lease(60);
update public.sync_state set lease_until = now() - interval '1 second';
select isnt(public.sync_claim_lease(60), null::uuid, 'an expired lease can be claimed again');
select is(public.sync_release_lease((select token from _lease), '{"stale":true}'::jsonb, null), false,
  'the previous holder cannot release a lease it lost');
select ok((select not (baseline ? 'stale') from public.sync_state), 'stale baseline was not written');

select throws_ok('select public.sync_claim_lease(0)', '22023', 'invalid_input', 'ttl must be 1..900');

-- only service_role may call the lease RPCs
update public.sync_state set lease_token = null, lease_until = null;
set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
select isnt(public.sync_claim_lease(30), null::uuid, 'service_role can claim the lease');
reset role;
set local request.jwt.claims = '{"role":"authenticated"}';
set local role authenticated;
select throws_ok('select public.sync_claim_lease(30)', '42501', null, 'authenticated cannot claim the lease');
reset role;

-- ------------------------------------------------------------- change-ping
insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'tst-admin@example.invalid');
insert into public.admins (user_id, email) values ('11111111-1111-4111-8111-111111111111', 'tst-admin@example.invalid');
insert into public.staff (code, station, name) values ('TST-SUB', 'SUB', 'Uji Sub');
update public.sync_state set last_ping_at = null;

-- Dynamic SQL: net.* may not exist on this database.
create function pg_temp.queued_pings(p_bearer text default null) returns bigint
language plpgsql as $$
declare v bigint;
begin
  if pg_catalog.to_regclass('net.http_request_queue') is null then
    return null;
  end if;
  execute $q$
    select count(*) from net.http_request_queue
     where url = 'http://127.0.0.1:9/joumpa-test'
       and ($1 is null or headers ->> 'Authorization' = $1)
  $q$ into v using p_bearer;
  return v;
end $$;

-- (a) No Vault secrets: an admin write succeeds and nothing is pinged.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local role authenticated;
select lives_ok($$update public.staff set notes = 'a' where code = 'TST-SUB'$$,
  'write succeeds with the ping unconfigured');
reset role;
select is((select last_ping_at from public.sync_state), null::timestamptz,
  'no ping while pg_net / Vault secrets are missing');

-- (b) With pg_net + secrets (when this Postgres has them): exactly one queued POST per 10 s,
--     none for service_role writes. Skipped on databases without pg_net / Vault.
do $$
declare
  v_id uuid;
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if pg_catalog.to_regproc('vault.create_secret') is null then
    return;
  end if;
  execute 'select id from vault.decrypted_secrets where name = $1' into v_id using 'sync_run_url';
  if v_id is null then
    perform vault.create_secret('http://127.0.0.1:9/joumpa-test', 'sync_run_url');
  else
    perform vault.update_secret(v_id, 'http://127.0.0.1:9/joumpa-test');
  end if;
  v_id := null;
  execute 'select id from vault.decrypted_secrets where name = $1' into v_id using 'sync_secret';
  if v_id is null then
    perform vault.create_secret('tst-secret', 'sync_secret');
  else
    perform vault.update_secret(v_id, 'tst-secret');
  end if;
end;
$$;

create temp table _ping_env as
select pg_catalog.to_regclass('net.http_request_queue') is not null
       and pg_catalog.to_regclass('vault.decrypted_secrets') is not null as enabled;

set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
select lives_ok($$update public.staff set notes = 'b' where code = 'TST-SUB'$$, 'service_role write succeeds');
reset role;
select case when (select enabled from _ping_env)
  then is(pg_temp.queued_pings(), 0::bigint, 'service_role (sync engine) writes do not ping')
  else skip('pg_net / vault not available here', 1) end;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local role authenticated;
select lives_ok($$update public.staff set notes = 'c' where code = 'TST-SUB'$$, 'admin write succeeds with the ping configured');
select lives_ok($$update public.staff set notes = 'd' where code = 'TST-SUB'$$, 'second admin write succeeds');
reset role;

select case when (select enabled from _ping_env)
  then is(pg_temp.queued_pings(), 1::bigint, 'two writes within 10 s queue exactly one ping')
  else skip('pg_net / vault not available here', 1) end;
select case when (select enabled from _ping_env)
  then ok((select last_ping_at is not null from public.sync_state), 'last_ping_at is recorded')
  else skip('pg_net / vault not available here', 1) end;
select case when (select enabled from _ping_env)
  then is(pg_temp.queued_pings('Bearer tst-secret'), 1::bigint, 'ping carries the Vault bearer')
  else skip('pg_net / vault not available here', 1) end;

select * from finish();
rollback;
