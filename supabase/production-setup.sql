-- JOUMPA People Development Tracker (v2): one-time PRODUCTION setup. NOT a migration.
--
-- v2 lives in the SAME Supabase project as v1 (JOUMPA Uplifting Action Tracker). pg_net, pg_cron and
-- v1's own Vault secrets and cron jobs already exist there: do not touch them. v2 adds its own:
--   Vault  pd_sync_run_url, pd_sync_secret      (read by private.pd_sync_ping() and the job below)
--   cron   joumpa-pd-sync-every-minute
--
-- Run as postgres (SQL editor or psql), after:
--   1. supabase/migrations/2026101910* are applied (psql, in order; v1's migrations are untouched)
--   2. the v2 app is deployed on Vercel and <APP_URL>/api/sync/run answers
--
-- Replace the two placeholders first. Never commit the real values:
--   <APP_URL>      https://joumpa-people-development-tracker.vercel.app   (no trailing slash)
--   <SYNC_SECRET>  the same value as v2's SYNC_SECRET env var on Vercel (NOT v1's)

-- 1. Vault secrets read by private.pd_sync_ping() and by the cron job below.
select vault.create_secret('<APP_URL>/api/sync/run', 'pd_sync_run_url', 'JOUMPA PD: Sheets sync endpoint');
select vault.create_secret('<SYNC_SECRET>', 'pd_sync_secret', 'JOUMPA PD: bearer for /api/sync/run');

-- 2. Every-minute sync run. The lease in pd_sync_state makes overlapping runs harmless.
select cron.schedule(
  'joumpa-pd-sync-every-minute',
  '* * * * *',
  $job$
    select net.http_post(
      url                  := (select decrypted_secret from vault.decrypted_secrets where name = 'pd_sync_run_url'),
      headers              := jsonb_build_object(
                                'Content-Type',  'application/json',
                                'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pd_sync_secret')
                              ),
      body                 := jsonb_build_object('source', 'cron'),
      timeout_milliseconds := 30000
    )
    where exists (select 1 from vault.decrypted_secrets where name = 'pd_sync_run_url');
  $job$
);

-- (v1's 'joumpa-cron-log-cleanup' job already trims cron.job_run_details for both apps.)

-- ---------------------------------------------------------------------------------------------
-- Checks
--   select jobid, jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select last_success_at, last_error, failures, last_ping_at from public.pd_sync_state;
--
-- Rotate the secret (then update v2's SYNC_SECRET on Vercel and redeploy):
--   select vault.update_secret((select id from vault.secrets where name = 'pd_sync_secret'), '<NEW_SYNC_SECRET>');
-- Change the URL (e.g. after a domain move):
--   select vault.update_secret((select id from vault.secrets where name = 'pd_sync_run_url'), '<APP_URL>/api/sync/run');
-- Pause / remove:
--   select cron.unschedule('joumpa-pd-sync-every-minute');
--
-- Owner: v2 shares public.admins with v1, so v1's owner is already v2's owner.
