-- Link workspace RPCs (owner decision 7 Oct 2026). Every share_* function:
--   SECURITY DEFINER, search_path = '', token first, scope checked in SQL, EXECUTE for anon + authenticated.
-- Scope: SUB/DPS/CGK/HLP/KNO = that station only; KPS = everything. Action items are scoped by
-- report group (a CGK or HLP link works on 'CGK & HLP').
--
-- Errors (message is the contract):
--   invalid_link    P0001  unknown, malformed or revoked token
--   out_of_scope    P0001  target row is outside the link's scope, or does not exist
--   forbidden_field P0001  KPS-only function called by a station link; DETAIL = field
--   invalid_input   22023  bad argument; DETAIL = field
--
-- Write RPCs return {"deleted": false, "row": {...}} with the row exactly as share_open lists it,
-- or {"deleted": true, "row": {<key columns>}}.

-- ================================================================== internal helpers
create or replace function private.share_fail(p_message text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_code text := case when p_message = 'invalid_input' then '22023' else 'P0001' end;
begin
  if p_detail is null then
    raise exception using errcode = v_code, message = p_message;
  end if;
  raise exception using errcode = v_code, message = p_message, detail = p_detail;
end;
$$;

-- Resolve the link (invalid_link), touch last_used_at, and mark this transaction so the
-- attribution triggers record updated_by_link. Always pair with private.share_end_write().
create or replace function private.share_begin_write(p_token text)
returns public.share_links
language plpgsql
set search_path = ''
as $$
declare
  v_link public.share_links;
begin
  v_link := private.share_resolve_link(p_token);
  perform pg_catalog.set_config('joumpa.share_link_id', v_link.id::text, true);
  return v_link;
end;
$$;

create or replace function private.share_end_write()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('joumpa.share_link_id', '', true);
end;
$$;

create or replace function private.share_scope_stations(p_scope text)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(s.code order by s.sort), '{}')
    from public.stations s
   where p_scope = 'KPS' or s.code = p_scope;
$$;

create or replace function private.share_scope_report_groups(p_scope text)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(distinct s.report_group), '{}')
    from public.stations s
   where p_scope = 'KPS' or s.code = p_scope;
$$;

-- The staff row if it is in scope; otherwise out_of_scope (also for unknown codes: no existence leak).
create or replace function private.share_scope_staff(p_scope text, p_code text)
returns public.staff
language plpgsql
set search_path = ''
as $$
declare
  v_staff public.staff;
begin
  select s.* into v_staff
    from public.staff s
   where s.code = p_code
     and (p_scope = 'KPS' or s.station = p_scope);
  if not found then
    perform private.share_fail('out_of_scope');
  end if;
  return v_staff;
end;
$$;

create or replace function private.share_clean(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(p_text), '');
$$;

create or replace function private.share_check_score(p_value integer, p_field text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_value is not null and (p_value < 1 or p_value > 5) then
    perform private.share_fail('invalid_input', p_field);
  end if;
end;
$$;

create or replace function private.share_check_text(p_value text, p_field text, p_max integer default 4000)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.char_length(p_value) > p_max then
    perform private.share_fail('invalid_input', p_field);
  end if;
end;
$$;

-- Old BMI-only helpers, superseded below.
drop function if exists private.share_staff_json(text);
drop function if exists private.share_assert_scope(text, text);


-- ================================================================== share_open
-- The whole workspace for the link's scope. Station scopes never receive another station's rows.
-- Rows are the table columns, except auth user ids (weekly_scores.updated_by,
-- bmi_checks.updated_by_user), which link holders never see.
create or replace function public.share_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link     public.share_links;
  v_stations text[];
  v_groups   text[];
  v_result   jsonb;
begin
  v_link := private.share_resolve_link(p_token);
  v_stations := private.share_scope_stations(v_link.scope);
  v_groups := private.share_scope_report_groups(v_link.scope);

  with
    st as (select s.* from public.stations s where s.code = any (v_stations)),
    sf as (select s.* from public.staff s where s.station = any (v_stations)),
    ws as (select w.* from public.weekly_scores w where w.staff_code in (select sf.code from sf)),
    bc as (select c.* from public.bmi_checks c where c.staff_code in (select sf.code from sf)),
    ai as (select a.* from public.action_items a where a.report_group = any (v_groups)),
    rp as (select r.* from public.replacements r
            where v_link.scope = 'KPS' or r.station = v_link.scope),
    wr as (select r.* from public.weekly_reports r
            where v_link.scope = 'KPS' or r.scope = v_link.scope),
    ids as (
      select v_link.id as link_id
      union select sf.updated_by_link from sf
      union select ws.updated_by_link from ws
      union select bc.updated_by_link from bc
      union select ai.updated_by_link from ai
      union select rp.updated_by_link from rp
      union select wr.updated_by_link from wr
    )
  select pg_catalog.jsonb_build_object(
           'scope',    v_link.scope,
           'label',    v_link.label,
           'link_id',  v_link.id,
           'stations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(st) order by st.sort) from st), '[]'::jsonb),
           'settings', (select pg_catalog.to_jsonb(t) from public.settings t where t.id = 1),
           'staff', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(sf)
                       order by pg_catalog.array_position(v_stations, sf.station), sf.sort_order nulls last, sf.code)
                from sf), '[]'::jsonb),
           'weekly_scores', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ws) - 'updated_by' order by ws.staff_code, ws.week)
                from ws), '[]'::jsonb),
           'bmi_checks', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(bc) - 'updated_by_user' order by bc.staff_code, bc.period)
                from bc), '[]'::jsonb),
           'action_items', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ai) order by ai.sort_order nulls last, ai.code)
                from ai), '[]'::jsonb),
           'replacements', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rp) order by rp.sort_order nulls last, rp.id)
                from rp), '[]'::jsonb),
           'weekly_reports', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(wr) order by wr.week, wr.scope)
                from wr), '[]'::jsonb),
           'link_labels', coalesce((
              select pg_catalog.jsonb_object_agg(l.id, coalesce(l.label, l.scope))
                from public.share_links l
               where l.id in (select ids.link_id from ids)), '{}'::jsonb)
         )
    into v_result;

  return v_result;
end;
$$;


-- ================================================================== weekly scores
-- Upsert on (staff_code, week). All six scores, observer and coaching notes NULL/blank deletes the row.
create or replace function public.share_save_weekly_score(
  p_token          text,
  p_staff_code     text,
  p_week           integer,
  p_score_a        integer,
  p_score_b        integer,
  p_score_c        integer,
  p_score_d        integer,
  p_score_e        integer,
  p_score_f        integer,
  p_observer       text,
  p_coaching_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link     public.share_links;
  v_weeks    smallint;
  v_observer text := private.share_clean(p_observer);
  v_notes    text := private.share_clean(p_coaching_notes);
  v_row      public.weekly_scores;
begin
  v_link := private.share_begin_write(p_token);
  perform private.share_scope_staff(v_link.scope, p_staff_code);

  select t.weeks into v_weeks from public.settings t where t.id = 1;
  if p_week is null or p_week < 1 or p_week > coalesce(v_weeks, 20) then
    perform private.share_fail('invalid_input', 'week');
  end if;
  perform private.share_check_score(p_score_a, 'score_a');
  perform private.share_check_score(p_score_b, 'score_b');
  perform private.share_check_score(p_score_c, 'score_c');
  perform private.share_check_score(p_score_d, 'score_d');
  perform private.share_check_score(p_score_e, 'score_e');
  perform private.share_check_score(p_score_f, 'score_f');
  perform private.share_check_text(v_observer, 'observer', 200);
  perform private.share_check_text(v_notes, 'coaching_notes');

  if num_nonnulls(p_score_a, p_score_b, p_score_c, p_score_d, p_score_e, p_score_f, v_observer, v_notes) = 0 then
    delete from public.weekly_scores w
     where w.staff_code = p_staff_code and w.week = p_week;
    perform private.share_end_write();
    return pg_catalog.jsonb_build_object('deleted', true,
      'row', pg_catalog.jsonb_build_object('staff_code', p_staff_code, 'week', p_week));
  end if;

  insert into public.weekly_scores
    (staff_code, week, score_a, score_b, score_c, score_d, score_e, score_f, observer, coaching_notes)
  values
    (p_staff_code, p_week, p_score_a, p_score_b, p_score_c, p_score_d, p_score_e, p_score_f, v_observer, v_notes)
  on conflict (staff_code, week) do update
    set score_a = excluded.score_a, score_b = excluded.score_b, score_c = excluded.score_c,
        score_d = excluded.score_d, score_e = excluded.score_e, score_f = excluded.score_f,
        observer = excluded.observer, coaching_notes = excluded.coaching_notes
  returning * into v_row;

  perform private.share_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_row) - 'updated_by');
end;
$$;


-- ================================================================== BMI check (same signature as before)
-- Upsert on (staff_code, period); height and weight both NULL deletes the period row.
create or replace function public.share_save_check(
  p_token      text,
  p_staff_code text,
  p_period     integer,
  p_check_date date,
  p_height_cm  numeric,
  p_weight_kg  numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link    public.share_links;
  v_periods smallint;
  v_row     public.bmi_checks;
begin
  v_link := private.share_begin_write(p_token);
  perform private.share_scope_staff(v_link.scope, p_staff_code);

  select t.bmi_periods into v_periods from public.settings t where t.id = 1;
  if p_period is null or p_period < 1 or p_period > coalesce(v_periods, 10) then
    perform private.share_fail('invalid_input', 'period');
  end if;

  if p_height_cm is null and p_weight_kg is null then
    delete from public.bmi_checks c
     where c.staff_code = p_staff_code and c.period = p_period;
    perform private.share_end_write();
    return pg_catalog.jsonb_build_object('deleted', true,
      'row', pg_catalog.jsonb_build_object('staff_code', p_staff_code, 'period', p_period));
  end if;

  if p_height_cm is null or p_height_cm < 120 or p_height_cm > 210 then
    perform private.share_fail('invalid_input', 'height_cm');
  end if;
  if p_weight_kg is null or p_weight_kg < 30 or p_weight_kg > 200 then
    perform private.share_fail('invalid_input', 'weight_kg');
  end if;

  insert into public.bmi_checks (staff_code, period, check_date, height_cm, weight_kg)
  values (p_staff_code, p_period, p_check_date, p_height_cm, p_weight_kg)
  on conflict (staff_code, period) do update
    set check_date = excluded.check_date,
        height_cm  = excluded.height_cm,
        weight_kg  = excluded.weight_kg
  returning * into v_row;

  perform private.share_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_row) - 'updated_by_user');
end;
$$;


-- ================================================================== BMI profile (same signature as before)
-- Sets gender ('L' | 'P' | NULL) and bmi_note (NULL / blank clears). Both are written as given.
create or replace function public.share_save_profile(
  p_token      text,
  p_staff_code text,
  p_gender     text,
  p_bmi_note   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link   public.share_links;
  v_gender text := pg_catalog.upper(private.share_clean(p_gender));
  v_note   text := private.share_clean(p_bmi_note);
  v_row    public.staff;
begin
  v_link := private.share_begin_write(p_token);
  perform private.share_scope_staff(v_link.scope, p_staff_code);

  if v_gender is not null and v_gender not in ('L', 'P') then
    perform private.share_fail('invalid_input', 'gender');
  end if;
  perform private.share_check_text(v_note, 'bmi_note', 2000);

  update public.staff s
     set gender = v_gender, bmi_note = v_note
   where s.code = p_staff_code
  returning * into v_row;

  perform private.share_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;


-- ================================================================== action items
-- Progress fields, any scope, item's report group must be in the link's scope.
create or replace function public.share_update_action_item(
  p_token      text,
  p_code       text,
  p_status     text,
  p_progress   integer,
  p_updated_on date,
  p_evidence   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link     public.share_links;
  v_evidence text := private.share_clean(p_evidence);
  v_row      public.action_items;
begin
  v_link := private.share_begin_write(p_token);
  if not exists (
    select 1 from public.action_items a
     where a.code = p_code
       and a.report_group = any (private.share_scope_report_groups(v_link.scope))
  ) then
    perform private.share_fail('out_of_scope');
  end if;

  if p_status is null or p_status not in ('Belum Mulai', 'On Progress', 'Selesai', 'Tertunda') then
    perform private.share_fail('invalid_input', 'status');
  end if;
  if p_progress is null or p_progress < 0 or p_progress > 100 then
    perform private.share_fail('invalid_input', 'progress');
  end if;
  perform private.share_check_text(v_evidence, 'evidence');

  update public.action_items a
     set status = p_status, progress = p_progress, updated_on = p_updated_on, evidence = v_evidence
   where a.code = p_code
  returning * into v_row;

  perform private.share_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;

-- KPS only: action-item definition fields and kps_notes. All written as given (NULL clears).
-- A station link gets forbidden_field (DETAIL = first non-NULL field it tried to set, else 'kps_notes').
create or replace function public.share_kps_update_action_item(
  p_token     text,
  p_code      text,
  p_area      text,
  p_action    text,
  p_target    text,
  p_kind      text,
  p_schedule  text,
  p_due_date  date,
  p_due_rule  text,
  p_pic       text,
  p_kps_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.share_links;
  v_row  public.action_items;
begin
  v_link := private.share_begin_write(p_token);
  if v_link.scope <> 'KPS' then
    perform private.share_fail('forbidden_field', coalesce(
      case when p_kps_notes is not null then 'kps_notes' end,
      case when p_area      is not null then 'area' end,
      case when p_action    is not null then 'action' end,
      case when p_target    is not null then 'target' end,
      case when p_kind      is not null then 'kind' end,
      case when p_schedule  is not null then 'schedule' end,
      case when p_due_date  is not null then 'due_date' end,
      case when p_due_rule  is not null then 'due_rule' end,
      case when p_pic       is not null then 'pic' end,
      'kps_notes'));
  end if;
  if not exists (select 1 from public.action_items a where a.code = p_code) then
    perform private.share_fail('out_of_scope');
  end if;

  if p_kind is not null and p_kind not in ('Sekali', 'Rutin') then
    perform private.share_fail('invalid_input', 'kind');
  end if;
  if p_due_rule is not null and p_due_rule not in ('bulanan-tgl-5', 'cek-bmi-berikutnya', 'jumat-berikutnya') then
    perform private.share_fail('invalid_input', 'due_rule');
  end if;
  perform private.share_check_text(p_area, 'area');
  perform private.share_check_text(p_action, 'action');
  perform private.share_check_text(p_target, 'target');
  perform private.share_check_text(p_schedule, 'schedule');
  perform private.share_check_text(p_pic, 'pic');
  perform private.share_check_text(p_kps_notes, 'kps_notes');

  update public.action_items a
     set area      = private.share_clean(p_area),
         action    = private.share_clean(p_action),
         target    = private.share_clean(p_target),
         kind      = p_kind,
         schedule  = private.share_clean(p_schedule),
         due_date  = p_due_date,
         due_rule  = p_due_rule,
         pic       = private.share_clean(p_pic),
         kps_notes = private.share_clean(p_kps_notes)
   where a.code = p_code
  returning * into v_row;

  perform private.share_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;


-- ================================================================== replacements
-- p_id NULL inserts, otherwise updates that row (must be in scope). All fields written as given.
-- Station links: station is forced to the link's station (p_station must be NULL or equal to it).
-- KPS: any station, or NULL station with an explicit report group.
-- report_group is derived from the station whenever a station is set.
-- p_staff_code (optional) must be a staff member of the row's station; replaced_name defaults to
-- that staff member's name.
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
  elsif v_group is not null and v_group not in ('SUB', 'DPS', 'CGK & HLP', 'KNO') then
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

create or replace function public.share_delete_replacement(p_token text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.share_links;
begin
  v_link := private.share_begin_write(p_token);
  if not exists (
    select 1 from public.replacements r
     where r.id = p_id
       and (v_link.scope = 'KPS' or r.station = v_link.scope)
  ) then
    perform private.share_fail('out_of_scope');
  end if;

  delete from public.replacements r where r.id = p_id;

  perform private.share_end_write();
  return pg_catalog.jsonb_build_object('deleted', true, 'row', pg_catalog.jsonb_build_object('id', p_id));
end;
$$;


-- ================================================================== staff
-- p_code NULL inserts a new staff member with the next free code TMB-01, TMB-02, ...
-- otherwise updates that staff member (must be in scope). name, nipp, gender, notes are written as
-- given; p_station / p_assignment_status NULL keep the current value (insert: link station / 'Aktif').
-- Station links can only use their own station; KPS must name a station on insert and may move staff.
create or replace function public.share_save_staff(
  p_token             text,
  p_code              text,
  p_station           text,
  p_name              text,
  p_nipp              text,
  p_gender            text,
  p_assignment_status text,
  p_notes             text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link    public.share_links;
  v_old     public.staff;
  v_station text := pg_catalog.upper(private.share_clean(p_station));
  v_name    text := private.share_clean(p_name);
  v_gender  text := pg_catalog.upper(private.share_clean(p_gender));
  v_status  text := private.share_clean(p_assignment_status);
  v_code    text;
  v_n       integer;
  v_row     public.staff;
begin
  v_link := private.share_begin_write(p_token);

  if p_code is not null then
    v_old := private.share_scope_staff(v_link.scope, p_code);
    v_station := coalesce(v_station, v_old.station);
    v_status := coalesce(v_status, v_old.assignment_status);
  else
    v_station := coalesce(v_station, case when v_link.scope <> 'KPS' then v_link.scope end);
    v_status := coalesce(v_status, 'Aktif');
  end if;

  if v_station is null then
    perform private.share_fail('invalid_input', 'station');
  end if;
  if v_link.scope <> 'KPS' and v_station <> v_link.scope then
    perform private.share_fail('out_of_scope');
  end if;
  if not exists (select 1 from public.stations s where s.code = v_station) then
    perform private.share_fail('invalid_input', 'station');
  end if;
  if v_name is null then
    perform private.share_fail('invalid_input', 'name');
  end if;
  if v_gender is not null and v_gender not in ('L', 'P') then
    perform private.share_fail('invalid_input', 'gender');
  end if;
  if v_status not in ('Aktif', 'Coaching 30 Hari', 'Diganti', 'Ditarik') then
    perform private.share_fail('invalid_input', 'assignment_status');
  end if;
  perform private.share_check_text(v_name, 'name', 200);
  perform private.share_check_text(p_nipp, 'nipp', 50);
  perform private.share_check_text(p_notes, 'notes');

  if p_code is null then
    -- Serialise code generation so two concurrent inserts can't pick the same TMB number.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('joumpa.staff.tmb_code'));
    select coalesce(max(pg_catalog.substring(s.code, '^TMB-([0-9]+)$')::integer), 0) + 1
      into v_n
      from public.staff s
     where s.code ~ '^TMB-[0-9]+$';
    v_code := 'TMB-' || case when v_n < 10 then '0' else '' end || v_n::text;

    insert into public.staff (code, station, name, nipp, gender, assignment_status, notes, sort_order)
    values (v_code, v_station, v_name, private.share_clean(p_nipp), v_gender, v_status,
            private.share_clean(p_notes),
            (select coalesce(max(s.sort_order), 0) + 1 from public.staff s))
    returning * into v_row;
  else
    update public.staff s
       set station = v_station, name = v_name, nipp = private.share_clean(p_nipp), gender = v_gender,
           assignment_status = v_status, notes = private.share_clean(p_notes)
     where s.code = p_code
    returning * into v_row;
  end if;

  perform private.share_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;

-- KPS only: training baseline (pre/post-test, A-F, report conclusion). All written as given.
-- A station link gets forbidden_field (DETAIL = first non-NULL field it tried to set, else 'pre_test').
create or replace function public.share_kps_save_staff_baseline(
  p_token             text,
  p_code              text,
  p_pre_test          numeric,
  p_post_test         numeric,
  p_score_a           integer,
  p_score_b           integer,
  p_score_c           integer,
  p_score_d           integer,
  p_score_e           integer,
  p_score_f           integer,
  p_report_conclusion text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.share_links;
  v_row  public.staff;
begin
  v_link := private.share_begin_write(p_token);
  if v_link.scope <> 'KPS' then
    perform private.share_fail('forbidden_field', coalesce(
      case when p_pre_test          is not null then 'pre_test' end,
      case when p_post_test         is not null then 'post_test' end,
      case when p_score_a           is not null then 'score_a' end,
      case when p_score_b           is not null then 'score_b' end,
      case when p_score_c           is not null then 'score_c' end,
      case when p_score_d           is not null then 'score_d' end,
      case when p_score_e           is not null then 'score_e' end,
      case when p_score_f           is not null then 'score_f' end,
      case when p_report_conclusion is not null then 'report_conclusion' end,
      'pre_test'));
  end if;
  perform private.share_scope_staff(v_link.scope, p_code);

  if p_pre_test is not null and (p_pre_test < 0 or p_pre_test > 100) then
    perform private.share_fail('invalid_input', 'pre_test');
  end if;
  if p_post_test is not null and (p_post_test < 0 or p_post_test > 100) then
    perform private.share_fail('invalid_input', 'post_test');
  end if;
  perform private.share_check_score(p_score_a, 'score_a');
  perform private.share_check_score(p_score_b, 'score_b');
  perform private.share_check_score(p_score_c, 'score_c');
  perform private.share_check_score(p_score_d, 'score_d');
  perform private.share_check_score(p_score_e, 'score_e');
  perform private.share_check_score(p_score_f, 'score_f');
  if p_report_conclusion is not null
     and p_report_conclusion not in ('Sesuai', 'Sesuai dengan Catatan', 'Perlu Perbaikan', 'Tidak Sesuai') then
    perform private.share_fail('invalid_input', 'report_conclusion');
  end if;

  update public.staff s
     set pre_test = p_pre_test, post_test = p_post_test,
         score_a = p_score_a, score_b = p_score_b, score_c = p_score_c,
         score_d = p_score_d, score_e = p_score_e, score_f = p_score_f,
         report_conclusion = p_report_conclusion
   where s.code = p_code
  returning * into v_row;

  perform private.share_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;


-- ================================================================== weekly report (findings)
-- Always the link's own scope. NULL/blank findings deletes the row.
create or replace function public.share_save_weekly_report(p_token text, p_week integer, p_findings text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link     public.share_links;
  v_weeks    smallint;
  v_findings text := private.share_clean(p_findings);
  v_row      public.weekly_reports;
begin
  v_link := private.share_begin_write(p_token);

  select t.weeks into v_weeks from public.settings t where t.id = 1;
  if p_week is null or p_week < 1 or p_week > coalesce(v_weeks, 20) then
    perform private.share_fail('invalid_input', 'week');
  end if;
  perform private.share_check_text(v_findings, 'findings', 20000);

  if v_findings is null then
    delete from public.weekly_reports r where r.week = p_week and r.scope = v_link.scope;
    perform private.share_end_write();
    return pg_catalog.jsonb_build_object('deleted', true,
      'row', pg_catalog.jsonb_build_object('week', p_week, 'scope', v_link.scope));
  end if;

  insert into public.weekly_reports (week, scope, findings)
  values (p_week, v_link.scope, v_findings)
  on conflict (week, scope) do update set findings = excluded.findings
  returning * into v_row;

  perform private.share_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;


-- ================================================================== grants
revoke all on function private.share_fail(text, text)                    from public, anon, authenticated;
revoke all on function private.share_begin_write(text)                   from public, anon, authenticated;
revoke all on function private.share_end_write()                         from public, anon, authenticated;
revoke all on function private.share_scope_stations(text)                from public, anon, authenticated;
revoke all on function private.share_scope_report_groups(text)           from public, anon, authenticated;
revoke all on function private.share_scope_staff(text, text)             from public, anon, authenticated;
revoke all on function private.share_clean(text)                         from public, anon, authenticated;
revoke all on function private.share_check_score(integer, text)          from public, anon, authenticated;
revoke all on function private.share_check_text(text, text, integer)     from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.share_open(text)',
    'public.share_save_weekly_score(text, text, integer, integer, integer, integer, integer, integer, integer, text, text)',
    'public.share_save_check(text, text, integer, date, numeric, numeric)',
    'public.share_save_profile(text, text, text, text)',
    'public.share_update_action_item(text, text, text, integer, date, text)',
    'public.share_kps_update_action_item(text, text, text, text, text, text, text, date, text, text, text)',
    'public.share_save_replacement(text, bigint, text, text, text, text, text, date, text, date, date, numeric, numeric, text, text)',
    'public.share_delete_replacement(text, bigint)',
    'public.share_save_staff(text, text, text, text, text, text, text, text)',
    'public.share_kps_save_staff_baseline(text, text, numeric, numeric, integer, integer, integer, integer, integer, integer, text)',
    'public.share_save_weekly_report(text, integer, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end;
$$;

-- Guard rails: anon may execute only share_* in public, and every share_* is a pinned
-- SECURITY DEFINER function.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn, p.proname, p.prosecdef, p.proconfig
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    if pg_catalog.has_function_privilege('anon', r.fn, 'EXECUTE') and r.proname !~ '^share_' then
      raise exception 'anon can execute %', r.fn;
    end if;
    if r.proname ~ '^share_' and not (r.prosecdef and r.proconfig @> array['search_path=""']) then
      raise exception '% must be SECURITY DEFINER with search_path pinned', r.fn;
    end if;
  end loop;
end;
$$;
