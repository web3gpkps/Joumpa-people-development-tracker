-- The only way a link holder or a branch account reaches v2 data: SECURITY DEFINER RPCs that
-- resolve who is calling, check the scope, validate, write, and stamp the link for attribution.
--
-- Caller (p_token):
--   48-hex token          a pd_share_links row (station code or KPS); anon key, no session
--   ''  + is_admin()      the owner: scope KPS, label "Pemilik", may restore archived plans
--   ''  + active profile  a branch account (public.profiles, shared with v1): its branch_code
--
-- Scope rules:
--   station  Cek BMI for its own station's staff; Rencana Aksi of its report group (full CRUD,
--            Cabang fixed to that group, delete = archive). Nothing else.
--   KPS      everything, every station.
--
-- Errors (lib/workspace/errors.ts): invalid_link, out_of_scope, forbidden_field (detail = field),
-- invalid_input (22023, detail = field).
--
-- Writes take a jsonb patch: only the keys present are changed; an unknown key or one the scope
-- may not set is forbidden_field. JSON null or "" clears the field.

-- ---------------------------------------------------------------- errors and small helpers
create or replace function private.pd_fail(p_message text, p_detail text default null)
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

create or replace function private.pd_clean(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(p_text), '');
$$;

-- Present in the patch (even as JSON null)?
create or replace function private.pd_has(p jsonb, k text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p ? k;
$$;

create or replace function private.pd_p_text(p jsonb, k text, p_max integer default 4000)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if pg_catalog.jsonb_typeof(p -> k) is distinct from 'string' and pg_catalog.jsonb_typeof(p -> k) <> 'null' then
    if pg_catalog.jsonb_typeof(p -> k) = 'number' then
      v := (p ->> k);
    else
      perform private.pd_fail('invalid_input', k);
    end if;
  else
    v := p ->> k;
  end if;
  v := private.pd_clean(v);
  if pg_catalog.char_length(v) > p_max then
    perform private.pd_fail('invalid_input', k);
  end if;
  return v;
end;
$$;

create or replace function private.pd_p_enum(p jsonb, k text, p_allowed text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := private.pd_p_text(p, k, 200);
begin
  if v is not null and not (v = any (p_allowed)) then
    perform private.pd_fail('invalid_input', k);
  end if;
  return v;
end;
$$;

create or replace function private.pd_p_date(p jsonb, k text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := private.pd_p_text(p, k, 40);
  d date;
begin
  if v is null then
    return null;
  end if;
  if v !~ '^\d{4}-\d{2}-\d{2}$' then
    perform private.pd_fail('invalid_input', k);
  end if;
  begin
    d := v::date;
  exception when others then
    perform private.pd_fail('invalid_input', k);
  end;
  if d < date '2000-01-01' or d > date '2100-12-31' then
    perform private.pd_fail('invalid_input', k);
  end if;
  return d;
end;
$$;

create or replace function private.pd_p_num(p jsonb, k text, p_min numeric, p_max numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := private.pd_p_text(p, k, 40);
  n numeric;
begin
  if v is null then
    return null;
  end if;
  begin
    n := pg_catalog.replace(v, ',', '.')::numeric;
  exception when others then
    perform private.pd_fail('invalid_input', k);
  end;
  if n < p_min or n > p_max then
    perform private.pd_fail('invalid_input', k);
  end if;
  return n;
end;
$$;

create or replace function private.pd_p_int(p jsonb, k text, p_min integer, p_max integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  n numeric := private.pd_p_num(p, k, p_min, p_max);
begin
  if n is not null and n <> pg_catalog.trunc(n) then
    perform private.pd_fail('invalid_input', k);
  end if;
  return n::integer;
end;
$$;

-- The patch must be an object whose keys are all in p_allowed.
create or replace function private.pd_check_patch(p jsonb, p_allowed text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then
    perform private.pd_fail('invalid_input', 'patch');
  end if;
  for k in select pg_catalog.jsonb_object_keys(p) loop
    if not (k = any (p_allowed)) then
      perform private.pd_fail('forbidden_field', k);
    end if;
  end loop;
end;
$$;


-- ---------------------------------------------------------------- who is calling
create or replace function private.pd_resolve_link(p_token text)
returns public.pd_share_links
language plpgsql
set search_path = ''
as $$
declare
  v_link    public.pd_share_links;
  v_profile public.profiles;
begin
  if nullif(pg_catalog.btrim(p_token), '') is null then
    if public.is_admin() then
      v_link.scope := 'KPS';
      v_link.label := 'Pemilik';
      return v_link;
    end if;

    select p.* into v_profile
      from public.profiles p
     where p.id = auth.uid()
       and p.status = 'active';

    if found and (
         v_profile.branch_code = 'KPS'
         or exists (select 1 from public.stations s where s.code = v_profile.branch_code)
       ) then
      v_link.scope := v_profile.branch_code;
      v_link.label := coalesce(nullif(v_profile.full_name, ''), v_profile.email);
      return v_link;
    end if;
    raise exception using errcode = 'P0001', message = 'invalid_link';
  end if;

  select l.* into v_link
    from public.pd_share_links l
   where l.token = pg_catalog.lower(pg_catalog.btrim(p_token))
     and l.revoked_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_link';
  end if;

  update public.pd_share_links l
     set last_used_at = pg_catalog.now()
   where l.id = v_link.id;

  return v_link;
end;
$$;

create or replace function private.pd_begin_write(p_token text)
returns public.pd_share_links
language plpgsql
set search_path = ''
as $$
declare
  v_link public.pd_share_links;
begin
  v_link := private.pd_resolve_link(p_token);
  perform pg_catalog.set_config('joumpa_pd.share_link_id', coalesce(v_link.id::text, ''), true);
  return v_link;
end;
$$;

create or replace function private.pd_end_write()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('joumpa_pd.share_link_id', '', true);
end;
$$;

-- The owner: blank token with an admin session.
create or replace function private.pd_is_owner(p_token text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(p_token), '') is null and public.is_admin();
$$;

create or replace function private.pd_scope_stations(p_scope text)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(s.code order by s.sort), '{}')
    from public.stations s
   where p_scope = 'KPS' or s.code = p_scope;
$$;

create or replace function private.pd_scope_groups(p_scope text)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(distinct s.report_group), '{}')
    from public.stations s
   where p_scope = 'KPS' or s.code = p_scope;
$$;

create or replace function private.pd_scope_staff(p_scope text, p_code text)
returns public.pd_staff
language plpgsql
set search_path = ''
as $$
declare
  v_staff public.pd_staff;
begin
  select s.* into v_staff
    from public.pd_staff s
   where s.code = p_code
     and (p_scope = 'KPS' or s.station = p_scope);
  if not found then
    perform private.pd_fail('out_of_scope');
  end if;
  return v_staff;
end;
$$;

-- KPS-only RPCs: any other scope gets forbidden_field naming the first field it tried to set.
create or replace function private.pd_require_kps(p_link public.pd_share_links, p jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_link.scope <> 'KPS' then
    perform private.pd_fail('forbidden_field', coalesce(
      (select k from pg_catalog.jsonb_object_keys(coalesce(p, '{}'::jsonb)) k limit 1), 'kps'));
  end if;
end;
$$;


-- ---------------------------------------------------------------- read: everything in scope
create or replace function public.pd_share_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link     public.pd_share_links;
  v_owner    boolean := private.pd_is_owner(p_token);
  v_kps      boolean;
  v_stations text[];
  v_groups   text[];
  v_result   jsonb;
begin
  v_link := private.pd_resolve_link(p_token);
  v_kps := v_link.scope = 'KPS';
  v_stations := private.pd_scope_stations(v_link.scope);
  v_groups := private.pd_scope_groups(v_link.scope);

  with
    st as (select s.* from public.stations s where s.code = any (v_stations)),
    sf as (select s.* from public.pd_staff s where s.station = any (v_stations)),
    bc as (select c.* from public.pd_bmi_checks c where c.staff_code in (select sf.code from sf)),
    ap as (select a.* from public.pd_action_plans a
            where a.report_group = any (v_groups)
              and (a.archived_at is null or v_owner)),
    rp as (select r.* from public.pd_replacements r where v_kps),
    mr as (select m.* from public.pd_monthly_reports m where v_kps),
    ids as (
      select v_link.id as link_id
      union select sf.updated_by_link from sf
      union select bc.updated_by_link from bc
      union select ap.updated_by_link from ap
      union select rp.updated_by_link from rp
      union select mr.updated_by_link from mr
    )
  select pg_catalog.jsonb_build_object(
           'scope',    v_link.scope,
           'label',    v_link.label,
           'link_id',  v_link.id,
           'stations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(st) order by st.sort) from st), '[]'::jsonb),
           'settings', (select pg_catalog.to_jsonb(t) from public.pd_settings t where t.id = 1),
           'areas', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.sort, a.name)
                from public.pd_areas a), '[]'::jsonb),
           'staff', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(sf)
                       order by pg_catalog.array_position(v_stations, sf.station), sf.sort_order nulls last, sf.code)
                from sf), '[]'::jsonb),
           'bmi_checks', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(bc) - 'updated_by_user' order by bc.staff_code, bc.period)
                from bc), '[]'::jsonb),
           'action_plans', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ap) order by ap.sort_order nulls last, ap.id)
                from ap), '[]'::jsonb),
           'replacements', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rp) order by rp.sort_order nulls last, rp.id)
                from rp), '[]'::jsonb),
           'monthly_reports', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(mr) order by mr.period, mr.report_group)
                from mr), '[]'::jsonb),
           'link_labels', coalesce((
              select pg_catalog.jsonb_object_agg(l.id, coalesce(l.label, l.scope))
                from public.pd_share_links l
               where l.id in (select ids.link_id from ids)), '{}'::jsonb)
         )
    into v_result;

  return v_result;
end;
$$;


-- ---------------------------------------------------------------- Cek BMI
create or replace function public.pd_share_save_check(
  p_token text, p_staff_code text, p_period integer, p_check_date date, p_height_cm numeric, p_weight_kg numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link    public.pd_share_links;
  v_periods smallint;
  v_row     public.pd_bmi_checks;
begin
  v_link := private.pd_begin_write(p_token);
  perform private.pd_scope_staff(v_link.scope, p_staff_code);

  select t.bmi_periods into v_periods from public.pd_settings t where t.id = 1;
  if p_period is null or p_period < 1 or p_period > coalesce(v_periods, 52) then
    perform private.pd_fail('invalid_input', 'period');
  end if;

  if p_height_cm is null and p_weight_kg is null then
    delete from public.pd_bmi_checks c
     where c.staff_code = p_staff_code and c.period = p_period;
    perform private.pd_end_write();
    return pg_catalog.jsonb_build_object('deleted', true,
      'row', pg_catalog.jsonb_build_object('staff_code', p_staff_code, 'period', p_period));
  end if;

  if p_height_cm is null or p_height_cm < 120 or p_height_cm > 210 then
    perform private.pd_fail('invalid_input', 'height_cm');
  end if;
  if p_weight_kg is null or p_weight_kg < 30 or p_weight_kg > 200 then
    perform private.pd_fail('invalid_input', 'weight_kg');
  end if;
  if p_check_date is not null and (p_check_date < date '2000-01-01' or p_check_date > date '2100-12-31') then
    perform private.pd_fail('invalid_input', 'check_date');
  end if;

  insert into public.pd_bmi_checks (staff_code, period, check_date, height_cm, weight_kg)
  values (p_staff_code, p_period, p_check_date, p_height_cm, p_weight_kg)
  on conflict (staff_code, period) do update
    set check_date = excluded.check_date,
        height_cm  = excluded.height_cm,
        weight_kg  = excluded.weight_kg
  returning * into v_row;

  perform private.pd_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_row) - 'updated_by_user');
end;
$$;


-- ---------------------------------------------------------------- staff (Tracker Staf + Cek BMI identity)
-- Station scope: the Cek BMI fields of its own staff (and adding staff to its own station).
-- KPS: every Tracker Staf field. A new staff member gets the next free code of the station
-- (BPN-06 after BPN-05), whatever station they are later moved to.
create or replace function public.pd_share_save_staff(p_token text, p_code text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_station_fields constant text[] := array['station', 'name', 'nipp', 'gender', 'bmi_note'];
  c_kps_fields constant text[] := array[
    'station', 'name', 'nipp', 'gender', 'bmi_note', 'proposal', 'initial_coaching', 'coaching_items',
    'initial_practice', 'main_action', 'main_due', 'pic', 'main_status', 'extra_action', 'extra_due',
    'extra_status', 'reassessed_on', 'reassess_practice', 'recoaching', 'final_decision', 'progress_notes'];
  c_status constant text[] := array['Belum Mulai', 'Proses', 'Selesai', 'Batal / N.A.'];
  v_link public.pd_share_links;
  v_old  public.pd_staff;
  v_new  public.pd_staff;
  p      jsonb := p_patch;
  v_n    integer;
begin
  v_link := private.pd_begin_write(p_token);
  perform private.pd_check_patch(p, case when v_link.scope = 'KPS' then c_kps_fields else c_station_fields end);

  if p_code is not null then
    v_old := private.pd_scope_staff(v_link.scope, p_code);
    v_new := v_old;
  else
    v_new.station := case when v_link.scope <> 'KPS' then v_link.scope end;
  end if;

  if p ? 'station' then v_new.station := pg_catalog.upper(private.pd_p_text(p, 'station', 5)); end if;
  if p ? 'name' then v_new.name := private.pd_p_text(p, 'name', 200); end if;
  if p ? 'nipp' then v_new.nipp := private.pd_p_text(p, 'nipp', 50); end if;
  if p ? 'gender' then v_new.gender := pg_catalog.upper(private.pd_p_enum(p, 'gender', array['L', 'P', 'l', 'p'])); end if;
  if p ? 'bmi_note' then v_new.bmi_note := private.pd_p_text(p, 'bmi_note', 2000); end if;
  if p ? 'proposal' then
    v_new.proposal := private.pd_p_enum(p, 'proposal',
      array['Coaching intensif', 'Pembinaan', 'Penggantian', 'Siap bertugas', 'Strong reminder']);
  end if;
  if p ? 'initial_coaching' then v_new.initial_coaching := private.pd_p_text(p, 'initial_coaching', 100); end if;
  if p ? 'coaching_items' then v_new.coaching_items := private.pd_p_text(p, 'coaching_items', 500); end if;
  if p ? 'initial_practice' then v_new.initial_practice := private.pd_p_num(p, 'initial_practice', 1, 5); end if;
  if p ? 'main_action' then v_new.main_action := private.pd_p_text(p, 'main_action'); end if;
  if p ? 'main_due' then v_new.main_due := private.pd_p_date(p, 'main_due'); end if;
  if p ? 'pic' then v_new.pic := private.pd_p_text(p, 'pic', 500); end if;
  if p ? 'main_status' then v_new.main_status := private.pd_p_enum(p, 'main_status', c_status); end if;
  if p ? 'extra_action' then v_new.extra_action := private.pd_p_text(p, 'extra_action'); end if;
  if p ? 'extra_due' then v_new.extra_due := private.pd_p_date(p, 'extra_due'); end if;
  if p ? 'extra_status' then v_new.extra_status := private.pd_p_enum(p, 'extra_status', c_status); end if;
  if p ? 'reassessed_on' then v_new.reassessed_on := private.pd_p_date(p, 'reassessed_on'); end if;
  if p ? 'reassess_practice' then v_new.reassess_practice := private.pd_p_num(p, 'reassess_practice', 1, 5); end if;
  if p ? 'recoaching' then
    v_new.recoaching := private.pd_p_enum(p, 'recoaching',
      array['Siap Bertugas', 'Perlu Pembinaan', 'Tidak Sesuai', 'Belum dinilai']);
  end if;
  if p ? 'final_decision' then
    v_new.final_decision := private.pd_p_enum(p, 'final_decision',
      array['Tetap bertugas', 'Lanjut pembinaan', 'Diganti', 'Ditarik dari JOUMPA']);
  end if;
  if p ? 'progress_notes' then v_new.progress_notes := private.pd_p_text(p, 'progress_notes'); end if;

  if v_new.station is null or not exists (select 1 from public.stations s where s.code = v_new.station) then
    perform private.pd_fail('invalid_input', 'station');
  end if;
  if v_link.scope <> 'KPS' and v_new.station <> v_link.scope then
    perform private.pd_fail('out_of_scope');
  end if;
  if v_new.name is null then
    perform private.pd_fail('invalid_input', 'name');
  end if;

  if p_code is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('joumpa_pd.staff_code.' || v_new.station));
    select coalesce(max(pg_catalog.substring(s.code, '-([0-9]+)$')::integer), 0) + 1
      into v_n
      from public.pd_staff s
     where s.code like v_new.station || '-%';
    v_new.code := v_new.station || '-' || pg_catalog.lpad(v_n::text, 2, '0');
    v_new.sort_order := (select coalesce(max(s.sort_order), 0) + 1 from public.pd_staff s);

    insert into public.pd_staff (
      code, station, name, nipp, gender, bmi_note, proposal, initial_coaching, coaching_items,
      initial_practice, main_action, main_due, pic, main_status, extra_action, extra_due, extra_status,
      reassessed_on, reassess_practice, recoaching, final_decision, progress_notes, sort_order)
    values (
      v_new.code, v_new.station, v_new.name, v_new.nipp, v_new.gender, v_new.bmi_note, v_new.proposal,
      v_new.initial_coaching, v_new.coaching_items, v_new.initial_practice, v_new.main_action, v_new.main_due,
      v_new.pic, v_new.main_status, v_new.extra_action, v_new.extra_due, v_new.extra_status,
      v_new.reassessed_on, v_new.reassess_practice, v_new.recoaching, v_new.final_decision,
      v_new.progress_notes, v_new.sort_order)
    returning * into v_new;
  else
    update public.pd_staff s
       set station = v_new.station, name = v_new.name, nipp = v_new.nipp, gender = v_new.gender,
           bmi_note = v_new.bmi_note, proposal = v_new.proposal, initial_coaching = v_new.initial_coaching,
           coaching_items = v_new.coaching_items, initial_practice = v_new.initial_practice,
           main_action = v_new.main_action, main_due = v_new.main_due, pic = v_new.pic,
           main_status = v_new.main_status, extra_action = v_new.extra_action, extra_due = v_new.extra_due,
           extra_status = v_new.extra_status, reassessed_on = v_new.reassessed_on,
           reassess_practice = v_new.reassess_practice, recoaching = v_new.recoaching,
           final_decision = v_new.final_decision, progress_notes = v_new.progress_notes
     where s.code = p_code
    returning * into v_new;
  end if;

  perform private.pd_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_new));
end;
$$;

-- KPS only. Their BMI checks go with them; a Penggantian row keeps its copied name.
create or replace function public.pd_share_delete_staff(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.pd_share_links;
begin
  v_link := private.pd_begin_write(p_token);
  perform private.pd_require_kps(v_link);
  perform private.pd_scope_staff(v_link.scope, p_code);
  delete from public.pd_staff s where s.code = p_code;
  perform private.pd_end_write();
  return pg_catalog.jsonb_build_object('deleted', true, 'row', pg_catalog.jsonb_build_object('code', p_code));
end;
$$;


-- ---------------------------------------------------------------- Penggantian SDM (KPS only)
create or replace function public.pd_share_save_replacement(p_token text, p_id bigint, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_fields constant text[] := array[
    'staff_code', 'name', 'report_group', 'category', 'basis', 'withdraw_due', 'director_approval',
    'withdrawn_on', 'withdraw_status', 'replacement_name', 'selected_on', 'post_test', 'practice',
    'training_due', 'started_on', 'notes'];
  v_link public.pd_share_links;
  v_new  public.pd_replacements;
  p      jsonb := p_patch;
begin
  v_link := private.pd_begin_write(p_token);
  perform private.pd_require_kps(v_link, p);
  perform private.pd_check_patch(p, c_fields);

  if p_id is not null then
    select r.* into v_new from public.pd_replacements r where r.id = p_id;
    if not found then
      perform private.pd_fail('out_of_scope');
    end if;
  end if;

  if p ? 'staff_code' then
    v_new.staff_code := private.pd_p_text(p, 'staff_code', 20);
    if v_new.staff_code is not null and not exists (select 1 from public.pd_staff s where s.code = v_new.staff_code) then
      perform private.pd_fail('invalid_input', 'staff_code');
    end if;
  end if;
  if p ? 'name' then v_new.name := private.pd_p_text(p, 'name', 200); end if;
  if p ? 'report_group' then
    v_new.report_group := private.pd_p_text(p, 'report_group', 20);
    if v_new.report_group is not null
       and not exists (select 1 from public.stations s where s.report_group = v_new.report_group) then
      perform private.pd_fail('invalid_input', 'report_group');
    end if;
  end if;
  if p ? 'category' then v_new.category := private.pd_p_enum(p, 'category', array['Penggantian', 'Strong reminder']); end if;
  if p ? 'basis' then v_new.basis := private.pd_p_text(p, 'basis'); end if;
  if p ? 'withdraw_due' then v_new.withdraw_due := private.pd_p_date(p, 'withdraw_due'); end if;
  if p ? 'director_approval' then
    v_new.director_approval := private.pd_p_enum(p, 'director_approval', array['Ya', 'Belum', 'Tidak']);
  end if;
  if p ? 'withdrawn_on' then v_new.withdrawn_on := private.pd_p_date(p, 'withdrawn_on'); end if;
  if p ? 'withdraw_status' then
    v_new.withdraw_status := private.pd_p_enum(p, 'withdraw_status', array['Belum Mulai', 'Proses', 'Selesai', 'Batal / N.A.']);
  end if;
  if p ? 'replacement_name' then v_new.replacement_name := private.pd_p_text(p, 'replacement_name', 200); end if;
  if p ? 'selected_on' then v_new.selected_on := private.pd_p_date(p, 'selected_on'); end if;
  if p ? 'post_test' then v_new.post_test := private.pd_p_num(p, 'post_test', 0, 100); end if;
  if p ? 'practice' then v_new.practice := private.pd_p_num(p, 'practice', 1, 5); end if;
  if p ? 'training_due' then v_new.training_due := private.pd_p_date(p, 'training_due'); end if;
  if p ? 'started_on' then v_new.started_on := private.pd_p_date(p, 'started_on'); end if;
  if p ? 'notes' then v_new.notes := private.pd_p_text(p, 'notes'); end if;

  if v_new.staff_code is not null then
    select s.name, s.report_group into v_new.name, v_new.report_group
      from public.pd_staff s where s.code = v_new.staff_code;
  end if;
  if v_new.name is null then
    perform private.pd_fail('invalid_input', 'name');
  end if;

  if p_id is null then
    insert into public.pd_replacements (
      staff_code, name, report_group, category, basis, withdraw_due, director_approval, withdrawn_on,
      withdraw_status, replacement_name, selected_on, post_test, practice, training_due, started_on, notes,
      sort_order)
    values (
      v_new.staff_code, v_new.name, v_new.report_group, v_new.category, v_new.basis, v_new.withdraw_due,
      v_new.director_approval, v_new.withdrawn_on, v_new.withdraw_status, v_new.replacement_name,
      v_new.selected_on, v_new.post_test, v_new.practice, v_new.training_due, v_new.started_on, v_new.notes,
      (select coalesce(max(r.sort_order), 0) + 1 from public.pd_replacements r))
    returning * into v_new;
  else
    update public.pd_replacements r
       set staff_code = v_new.staff_code, name = v_new.name, report_group = v_new.report_group,
           category = v_new.category, basis = v_new.basis, withdraw_due = v_new.withdraw_due,
           director_approval = v_new.director_approval, withdrawn_on = v_new.withdrawn_on,
           withdraw_status = v_new.withdraw_status, replacement_name = v_new.replacement_name,
           selected_on = v_new.selected_on, post_test = v_new.post_test, practice = v_new.practice,
           training_due = v_new.training_due, started_on = v_new.started_on, notes = v_new.notes
     where r.id = p_id
    returning * into v_new;
  end if;

  perform private.pd_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_new));
end;
$$;

create or replace function public.pd_share_delete_replacement(p_token text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.pd_share_links;
begin
  v_link := private.pd_begin_write(p_token);
  perform private.pd_require_kps(v_link);
  delete from public.pd_replacements r where r.id = p_id;
  if not found then
    perform private.pd_fail('out_of_scope');
  end if;
  perform private.pd_end_write();
  return pg_catalog.jsonb_build_object('deleted', true, 'row', pg_catalog.jsonb_build_object('id', p_id));
end;
$$;


-- ---------------------------------------------------------------- Rencana Aksi (every scope, own group)
create or replace function public.pd_share_save_action_plan(p_token text, p_id bigint, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_fields constant text[] := array[
    'item_no', 'area', 'action', 'report_group', 'target', 'due_date', 'pic', 'status', 'progress',
    'done_on', 'evidence', 'notes'];
  v_link   public.pd_share_links;
  v_groups text[];
  v_new    public.pd_action_plans;
  p        jsonb := p_patch;
begin
  v_link := private.pd_begin_write(p_token);
  perform private.pd_check_patch(p, c_fields);
  v_groups := private.pd_scope_groups(v_link.scope);

  if p_id is not null then
    select a.* into v_new
      from public.pd_action_plans a
     where a.id = p_id
       and a.report_group = any (v_groups)
       and a.archived_at is null;
    if not found then
      perform private.pd_fail('out_of_scope');
    end if;
  else
    v_new.status := 'Belum Mulai';
    v_new.progress := 0;
    if pg_catalog.cardinality(v_groups) = 1 then
      v_new.report_group := v_groups[1];
    end if;
  end if;

  if p ? 'item_no' then v_new.item_no := private.pd_p_text(p, 'item_no', 10); end if;
  if p ? 'area' then v_new.area := private.pd_p_text(p, 'area', 80); end if;
  if p ? 'action' then v_new.action := private.pd_p_text(p, 'action'); end if;
  if p ? 'report_group' then v_new.report_group := private.pd_p_text(p, 'report_group', 20); end if;
  if p ? 'target' then v_new.target := private.pd_p_text(p, 'target'); end if;
  if p ? 'due_date' then v_new.due_date := private.pd_p_date(p, 'due_date'); end if;
  if p ? 'pic' then v_new.pic := private.pd_p_text(p, 'pic', 500); end if;
  if p ? 'status' then
    v_new.status := coalesce(private.pd_p_enum(p, 'status', array['Belum Mulai', 'Proses', 'Selesai', 'Batal / N.A.']), 'Belum Mulai');
  end if;
  if p ? 'progress' then v_new.progress := coalesce(private.pd_p_int(p, 'progress', 0, 100), 0); end if;
  if p ? 'done_on' then v_new.done_on := private.pd_p_date(p, 'done_on'); end if;
  if p ? 'evidence' then v_new.evidence := private.pd_p_text(p, 'evidence'); end if;
  if p ? 'notes' then v_new.notes := private.pd_p_text(p, 'notes'); end if;

  if v_new.report_group is null
     or not exists (select 1 from public.stations s where s.report_group = v_new.report_group) then
    perform private.pd_fail('invalid_input', 'report_group');
  end if;
  if not (v_new.report_group = any (v_groups)) then
    perform private.pd_fail('out_of_scope');
  end if;
  if v_new.area is null or not exists (select 1 from public.pd_areas a where a.name = v_new.area) then
    perform private.pd_fail('invalid_input', 'area');
  end if;
  if v_new.action is null then
    perform private.pd_fail('invalid_input', 'action');
  end if;

  if p_id is null then
    insert into public.pd_action_plans (
      item_no, area, action, report_group, target, due_date, pic, status, progress, done_on, evidence,
      notes, sort_order)
    values (
      v_new.item_no, v_new.area, v_new.action, v_new.report_group, v_new.target, v_new.due_date, v_new.pic,
      v_new.status, v_new.progress, v_new.done_on, v_new.evidence, v_new.notes,
      (select coalesce(max(a.sort_order), 0) + 1 from public.pd_action_plans a))
    returning * into v_new;
  else
    update public.pd_action_plans a
       set item_no = v_new.item_no, area = v_new.area, action = v_new.action,
           report_group = v_new.report_group, target = v_new.target, due_date = v_new.due_date,
           pic = v_new.pic, status = v_new.status, progress = v_new.progress, done_on = v_new.done_on,
           evidence = v_new.evidence, notes = v_new.notes
     where a.id = p_id
    returning * into v_new;
  end if;

  perform private.pd_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_new));
end;
$$;

-- "Hapus" in the app: archived, gone from the app and the sheet, restorable by the owner.
create or replace function public.pd_share_archive_action_plan(p_token text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.pd_share_links;
  v_row  public.pd_action_plans;
begin
  v_link := private.pd_begin_write(p_token);
  update public.pd_action_plans a
     set archived_at = pg_catalog.now()
   where a.id = p_id
     and a.report_group = any (private.pd_scope_groups(v_link.scope))
     and a.archived_at is null
  returning * into v_row;
  if not found then
    perform private.pd_fail('out_of_scope');
  end if;
  perform private.pd_end_write();
  return pg_catalog.jsonb_build_object('deleted', true, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;

create or replace function public.pd_share_restore_action_plan(p_token text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.pd_action_plans;
begin
  if not private.pd_is_owner(p_token) then
    perform private.pd_fail('forbidden_field', 'archived_at');
  end if;
  perform private.pd_begin_write(p_token);
  update public.pd_action_plans a
     set archived_at = null
   where a.id = p_id
     and a.archived_at is not null
  returning * into v_row;
  if not found then
    perform private.pd_fail('out_of_scope');
  end if;
  perform private.pd_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;


-- ---------------------------------------------------------------- Laporan Bulanan (KPS only)
create or replace function public.pd_share_save_monthly_report(
  p_token text, p_report_group text, p_period date, p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_fields constant text[] := array[
    'due_on', 'received_on', 'active_staff', 'compliant_staff', 'complaints', 'responded', 'satisfaction', 'notes'];
  v_link public.pd_share_links;
  v_new  public.pd_monthly_reports;
  p      jsonb := p_patch;
begin
  v_link := private.pd_begin_write(p_token);
  perform private.pd_require_kps(v_link, p);
  perform private.pd_check_patch(p, c_fields);

  if p_report_group is null
     or not exists (select 1 from public.stations s where s.report_group = p_report_group) then
    perform private.pd_fail('invalid_input', 'report_group');
  end if;
  if p_period is null or extract(day from p_period) <> 1
     or p_period < date '2000-01-01' or p_period > date '2100-12-01' then
    perform private.pd_fail('invalid_input', 'period');
  end if;

  select m.* into v_new
    from public.pd_monthly_reports m
   where m.report_group = p_report_group and m.period = p_period;
  v_new.report_group := p_report_group;
  v_new.period := p_period;

  if p ? 'due_on' then v_new.due_on := private.pd_p_date(p, 'due_on'); end if;
  if p ? 'received_on' then v_new.received_on := private.pd_p_date(p, 'received_on'); end if;
  if p ? 'active_staff' then v_new.active_staff := private.pd_p_int(p, 'active_staff', 0, 10000); end if;
  if p ? 'compliant_staff' then v_new.compliant_staff := private.pd_p_int(p, 'compliant_staff', 0, 10000); end if;
  if p ? 'complaints' then v_new.complaints := private.pd_p_int(p, 'complaints', 0, 10000); end if;
  if p ? 'responded' then v_new.responded := private.pd_p_enum(p, 'responded', array['Ya', 'Belum', 'Tidak']); end if;
  if p ? 'satisfaction' then v_new.satisfaction := private.pd_p_num(p, 'satisfaction', 0, 5); end if;
  if p ? 'notes' then v_new.notes := private.pd_p_text(p, 'notes'); end if;

  insert into public.pd_monthly_reports (
    report_group, period, due_on, received_on, active_staff, compliant_staff, complaints, responded,
    satisfaction, notes)
  values (
    v_new.report_group, v_new.period, v_new.due_on, v_new.received_on, v_new.active_staff,
    v_new.compliant_staff, v_new.complaints, v_new.responded, v_new.satisfaction, v_new.notes)
  on conflict (report_group, period) do update
    set due_on = excluded.due_on, received_on = excluded.received_on,
        active_staff = excluded.active_staff, compliant_staff = excluded.compliant_staff,
        complaints = excluded.complaints, responded = excluded.responded,
        satisfaction = excluded.satisfaction, notes = excluded.notes
  returning * into v_new;

  perform private.pd_end_write();
  return pg_catalog.jsonb_build_object('deleted', false, 'row', pg_catalog.to_jsonb(v_new));
end;
$$;

create or replace function public.pd_share_delete_monthly_report(p_token text, p_report_group text, p_period date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.pd_share_links;
begin
  v_link := private.pd_begin_write(p_token);
  perform private.pd_require_kps(v_link);
  delete from public.pd_monthly_reports m where m.report_group = p_report_group and m.period = p_period;
  if not found then
    perform private.pd_fail('out_of_scope');
  end if;
  perform private.pd_end_write();
  return pg_catalog.jsonb_build_object('deleted', true,
    'row', pg_catalog.jsonb_build_object('report_group', p_report_group, 'period', p_period));
end;
$$;


-- ---------------------------------------------------------------- privileges
do $$
declare
  f text;
begin
  for f in
    select p.oid::regprocedure::text
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname like 'pd\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  for f in
    select p.oid::regprocedure::text
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'pd\_share\_%'
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end;
$$;
