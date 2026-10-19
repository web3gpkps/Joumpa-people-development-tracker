-- Stations come from public.stations instead of fixed lists, like the Garuda tracker. The five
-- workbook stations stay first (SUB, DPS, CGK, HLP, KNO; CGK and HLP keep the shared report
-- "CGK & HLP"); the Garuda tracker's other 30 stations follow alphabetically, each its own
-- report group. Adding a station later is one insert into public.stations.
--
-- Fixed lists replaced:
--   stations.code / report_group, weekly_reports.scope                      -> code pattern checks
--   share_links.scope                                                       -> KPS or a listed station
--   action_items.report_group, replacements.report_group                    -> must be a group in stations
--   share_save_replacement (report group without a station)                 -> same check
--   sheet."Master SDM".Laporan (CGK/HLP case)                               -> stations.report_group

alter table public.stations drop constraint stations_code_check;
alter table public.stations add constraint stations_code_check
  check (code ~ '^[A-Z0-9]{2,5}$' and code <> 'KPS');

alter table public.stations drop constraint stations_report_group_check;
alter table public.stations add constraint stations_report_group_check
  check (pg_catalog.btrim(report_group) <> '' and report_group = pg_catalog.btrim(report_group) and report_group <> 'KPS');

alter table public.share_links drop constraint share_links_scope_check;
alter table public.share_links add constraint share_links_scope_check
  check (scope = 'KPS' or scope ~ '^[A-Z0-9]{2,5}$');

-- A link opens one listed station or KPS (a CHECK cannot look at another table).
create or replace function private.check_link_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scope <> 'KPS' and not exists (select 1 from public.stations s where s.code = new.scope) then
    raise exception using errcode = '23514', message = 'unknown_scope',
      detail = pg_catalog.format('%s is not KPS or a station in stations', new.scope);
  end if;
  return new;
end;
$$;

revoke all on function private.check_link_scope() from public, anon, authenticated;

create trigger share_links_check_scope
  before insert or update of scope on public.share_links
  for each row execute function private.check_link_scope();

alter table public.weekly_reports drop constraint weekly_reports_scope_check;
alter table public.weekly_reports add constraint weekly_reports_scope_check
  check (scope = 'KPS' or scope ~ '^[A-Z0-9]{2,5}$');

-- A station code may be renamed: staff and replacements follow it.
alter table public.staff drop constraint staff_station_fkey;
alter table public.staff add constraint staff_station_fkey
  foreign key (station) references public.stations (code) on update cascade;
alter table public.replacements drop constraint replacements_station_fkey;
alter table public.replacements add constraint replacements_station_fkey
  foreign key (station) references public.stations (code) on update cascade;

-- report_group of action items and replacements: a group some station reports in.
alter table public.action_items drop constraint action_items_report_group_check;
alter table public.replacements drop constraint replacements_report_group_check;

-- security definer: the check must see every station even when the caller cannot read the table
-- (a non-admin is then refused by RLS, not by this check).
create or replace function private.check_report_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.report_group is not null
     and not exists (select 1 from public.stations s where s.report_group = new.report_group) then
    raise exception using errcode = '23514', message = 'unknown_report_group',
      detail = pg_catalog.format('%s is not a report group in stations', new.report_group);
  end if;
  return new;
end;
$$;

revoke all on function private.check_report_group() from public, anon, authenticated;

create trigger action_items_check_report_group
  before insert or update of report_group on public.action_items
  for each row execute function private.check_report_group();
create trigger replacements_check_report_group
  before insert or update of report_group on public.replacements
  for each row execute function private.check_report_group();

insert into public.stations (code, report_group, sort) values
  ('AAP', 'AAP', 6),
  ('AMQ', 'AMQ', 7),
  ('BDJ', 'BDJ', 8),
  ('BPN', 'BPN', 9),
  ('BTH', 'BTH', 10),
  ('BTJ', 'BTJ', 11),
  ('DJB', 'DJB', 12),
  ('DJJ', 'DJJ', 13),
  ('GTO', 'GTO', 14),
  ('KDI', 'KDI', 15),
  ('KOE', 'KOE', 16),
  ('LBJ', 'LBJ', 17),
  ('LOP', 'LOP', 18),
  ('MDC', 'MDC', 19),
  ('MKQ', 'MKQ', 20),
  ('PDG', 'PDG', 21),
  ('PGK', 'PGK', 22),
  ('PKU', 'PKU', 23),
  ('PKY', 'PKY', 24),
  ('PLM', 'PLM', 25),
  ('PLW', 'PLW', 26),
  ('PNK', 'PNK', 27),
  ('SOC', 'SOC', 28),
  ('SOQ', 'SOQ', 29),
  ('SRG', 'SRG', 30),
  ('TIM', 'TIM', 31),
  ('TKG', 'TKG', 32),
  ('TTE', 'TTE', 33),
  ('UPG', 'UPG', 34),
  ('YIA', 'YIA', 35)
on conflict (code) do nothing;

create or replace function public.share_save_replacement(
  p_token            text,
  p_id               bigint,
  p_station          text,
  p_report_group     text,
  p_staff_code       text,
  p_replaced_name    text,
  p_reason           text,
  p_withdrawn_on     date,
  p_replacement_name text,
  p_effective_on     date,
  p_training_on      date,
  p_post_test        numeric,
  p_practice_avg     numeric,
  p_reported         text,
  p_notes            text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link    public.share_links;
  v_old     public.replacements;
  v_station text := pg_catalog.upper(private.share_clean(p_station));
  v_group   text := private.share_clean(p_report_group);
  v_derived text;
  v_staff   public.staff;
  v_name    text := private.share_clean(p_replaced_name);
  v_row     public.replacements;
begin
  v_link := private.share_begin_write(p_token);

  if p_id is not null then
    select r.* into v_old from public.replacements r where r.id = p_id;
    if not found or (v_link.scope <> 'KPS' and v_old.station is distinct from v_link.scope) then
      perform private.share_fail('out_of_scope');
    end if;
  end if;

  if v_link.scope <> 'KPS' then
    if v_station is not null and v_station <> v_link.scope then
      perform private.share_fail('out_of_scope');
    end if;
    v_station := v_link.scope;
  elsif v_station is not null and not exists (select 1 from public.stations s where s.code = v_station) then
    perform private.share_fail('invalid_input', 'station');
  end if;

  if p_staff_code is not null then
    v_staff := private.share_scope_staff(v_link.scope, p_staff_code);
    if v_station is not null and v_staff.station <> v_station then
      perform private.share_fail('invalid_input', 'staff_code');
    end if;
    v_station := coalesce(v_station, v_staff.station);
    v_name := coalesce(v_name, v_staff.name);
  end if;

  if v_station is not null then
    select s.report_group into v_derived from public.stations s where s.code = v_station;
    if v_group is not null and v_group <> v_derived then
      perform private.share_fail('invalid_input', 'report_group');
    end if;
    v_group := v_derived;
  elsif v_group is not null and not exists (select 1 from public.stations s where s.report_group = v_group) then
    perform private.share_fail('invalid_input', 'report_group');
  end if;

  if v_name is null then
    perform private.share_fail('invalid_input', 'replaced_name');
  end if;
  if p_post_test is not null and (p_post_test < 0 or p_post_test > 100) then
    perform private.share_fail('invalid_input', 'post_test');
  end if;
  if p_practice_avg is not null and (p_practice_avg < 1 or p_practice_avg > 5) then
    perform private.share_fail('invalid_input', 'practice_avg');
  end if;
  if p_reported is not null and p_reported not in ('Ya', 'Belum') then
    perform private.share_fail('invalid_input', 'reported');
  end if;
  perform private.share_check_text(v_name, 'replaced_name', 200);
  perform private.share_check_text(p_replacement_name, 'replacement_name', 200);
  perform private.share_check_text(p_reason, 'reason');
  perform private.share_check_text(p_notes, 'notes');

  if p_id is null then
    insert into public.replacements
      (report_group, station, staff_code, replaced_name, reason, withdrawn_on, replacement_name,
       effective_on, training_on, post_test, practice_avg, reported, notes, sort_order)
    values
      (v_group, v_station, p_staff_code, v_name, private.share_clean(p_reason), p_withdrawn_on,
       private.share_clean(p_replacement_name), p_effective_on, p_training_on, p_post_test,
       p_practice_avg, p_reported, private.share_clean(p_notes),
       (select coalesce(max(r.sort_order), 0) + 1 from public.replacements r))
    returning * into v_row;
  else
    update public.replacements r
       set report_group = v_group, station = v_station, staff_code = p_staff_code,
           replaced_name = v_name, reason = private.share_clean(p_reason),
           withdrawn_on = p_withdrawn_on, replacement_name = private.share_clean(p_replacement_name),
           effective_on = p_effective_on, training_on = p_training_on, post_test = p_post_test,
           practice_avg = p_practice_avg, reported = p_reported, notes = private.share_clean(p_notes)
     where r.id = p_id
    returning * into v_row;
  end if;

  perform private.share_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;

create or replace view sheet."Master SDM" as
with st as (
  select t.*, private.sheet_avg(t.score_a, t.score_b, t.score_c, t.score_d, t.score_e, t.score_f) as avg
  from public.staff t
), x as (
  select st.*, private.sheet_criteria(st.avg, st.post_test, s) as crit
  from st left join public.settings s on s.id = 1
)
select
  row_number() over (order by x.sort_order nulls last, x.code) as "No",
  x.code as "ID SDM",
  x.station as "Stasiun",
  stn.report_group as "Laporan",
  x.name as "Nama Petugas",
  x.nipp as "NIPP",
  x.gender as "L/P",
  x.pre_test as "Pre-test",
  x.post_test as "Post-test",
  x.score_a as "A Penampilan",
  x.score_b as "B Grooming",
  x.score_c as "C Postur",
  x.score_d as "D Komunikasi",
  x.score_e as "E Touch Point",
  x.score_f as "F B. Inggris & Reservasi",
  x.avg as "Rata-rata Praktik",
  x.report_conclusion as "Kesimpulan di Laporan",
  x.crit as "Status Menurut Kriteria 6.2",
  case when nullif(trim(x.report_conclusion), '') is null or x.crit is null then null
    when upper(left(x.report_conclusion, 6)) = upper(left(x.crit, 6)) then 'OK'
    else 'Beda – verifikasi' end as "Cek Konsistensi",
  x.assignment_status as "Status Penugasan",
  x.notes as "Catatan"
from x
left join public.stations stn on stn.code = x.station
order by 1;

revoke all on all tables in schema sheet from public, anon, authenticated;
grant select on all tables in schema sheet to service_role;
