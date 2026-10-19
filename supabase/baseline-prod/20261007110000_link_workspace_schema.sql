-- Owner decision 7 Oct 2026: stations and KPS never log in; all data entry goes through links.
-- Schema part:
--   * weekly_reports is keyed by (week, scope): every link scope writes its own weekly findings
--   * every mutable data table records updated_by_link, stamped server-side (client values ignored)
-- Existing triggers, RLS policies and grants on these tables are unchanged.

-- ------------------------------------------------------------------ weekly_reports: PK (week, scope)
alter table public.weekly_reports add column scope text;

-- Production is empty; any pre-existing local row predates scopes and belongs to head office.
update public.weekly_reports set scope = 'KPS' where scope is null;

alter table public.weekly_reports
  alter column scope set not null,
  add constraint weekly_reports_scope_check check (scope in ('SUB', 'DPS', 'CGK', 'HLP', 'KNO', 'KPS')),
  drop constraint weekly_reports_pkey,
  add constraint weekly_reports_pkey primary key (week, scope);


-- ------------------------------------------------------------------ updated_by_link everywhere
-- (bmi_checks already has it.)
alter table public.staff
  add column updated_by_link uuid references public.share_links (id) on delete set null;
alter table public.weekly_scores
  add column updated_by_link uuid references public.share_links (id) on delete set null;
alter table public.action_items
  add column updated_by_link uuid references public.share_links (id) on delete set null;
alter table public.replacements
  add column updated_by_link uuid references public.share_links (id) on delete set null;
alter table public.weekly_reports
  add column updated_by_link uuid references public.share_links (id) on delete set null;

create index staff_updated_by_link_idx          on public.staff (updated_by_link);
create index weekly_scores_updated_by_link_idx  on public.weekly_scores (updated_by_link);
create index action_items_updated_by_link_idx   on public.action_items (updated_by_link);
create index replacements_updated_by_link_idx   on public.replacements (updated_by_link);
create index weekly_reports_updated_by_link_idx on public.weekly_reports (updated_by_link);


-- ------------------------------------------------------------------ attribution triggers
-- The share_* write RPCs set the transaction-local GUC joumpa.share_link_id; every other writer
-- (owner via RLS, service role / Sheets sync, SQL) leaves it empty, so updated_by_link = NULL.
create or replace function private.stamp_link_attribution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by_link := nullif(pg_catalog.current_setting('joumpa.share_link_id', true), '')::uuid;
  return new;
end;
$$;

revoke all on function private.stamp_link_attribution() from public, anon, authenticated;

-- weekly_scores: link write -> updated_by_link = link, updated_by = NULL;
--                otherwise   -> updated_by = auth.uid() (NULL for service role / SQL), updated_by_link = NULL.
create or replace function private.stamp_weekly_score_author()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_link uuid := nullif(pg_catalog.current_setting('joumpa.share_link_id', true), '')::uuid;
begin
  new.updated_by_link := v_link;
  new.updated_by := case when v_link is null then auth.uid() end;
  return new;
end;
$$;

revoke all on function private.stamp_weekly_score_author() from public, anon, authenticated;

create trigger staff_stamp_link
  before insert or update on public.staff
  for each row execute function private.stamp_link_attribution();

create trigger action_items_stamp_link
  before insert or update on public.action_items
  for each row execute function private.stamp_link_attribution();

create trigger replacements_stamp_link
  before insert or update on public.replacements
  for each row execute function private.stamp_link_attribution();

create trigger weekly_reports_stamp_link
  before insert or update on public.weekly_reports
  for each row execute function private.stamp_link_attribution();
