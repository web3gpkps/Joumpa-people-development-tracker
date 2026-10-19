-- Share-link RPCs: the only path by which a link holder (anon) reaches any data.
-- Errors (message is the contract; SQLSTATE given for convenience):
--   invalid_link  P0001  unknown, malformed or revoked token
--   out_of_scope  P0001  staff code not in the link's scope (or does not exist)
--   invalid_input 22023  bad argument; DETAIL names the field (period, height_cm, weight_kg, gender, bmi_note)

-- ------------------------------------------------------------------ internal helpers
-- Resolve an active link and touch last_used_at. Raises invalid_link.
create or replace function private.share_resolve_link(p_token text)
returns public.share_links
language plpgsql
set search_path = ''
as $$
declare
  v_link public.share_links;
begin
  select l.* into v_link
    from public.share_links l
   where l.token = pg_catalog.lower(pg_catalog.btrim(p_token))
     and l.revoked_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_link';
  end if;

  update public.share_links l
     set last_used_at = pg_catalog.now()
   where l.id = v_link.id;

  return v_link;
end;
$$;

-- Scope KPS = all stations; otherwise staff.station must equal the scope. Raises out_of_scope.
create or replace function private.share_assert_scope(p_scope text, p_staff_code text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.staff s
     where s.code = p_staff_code
       and (p_scope = 'KPS' or s.station = p_scope)
  ) then
    raise exception using errcode = 'P0001', message = 'out_of_scope';
  end if;
end;
$$;

-- The only staff shape a link holder ever sees. Keep in sync with docs/SPEC.md.
create or replace function private.share_staff_json(p_staff_code text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'code',              s.code,
           'name',              s.name,
           'station',           s.station,
           'gender',            s.gender,
           'assignment_status', s.assignment_status,
           'bmi_note',          s.bmi_note,
           'checks', coalesce((
             select pg_catalog.jsonb_agg(
                      pg_catalog.jsonb_build_object(
                        'period',     c.period,
                        'check_date', c.check_date,
                        'height_cm',  c.height_cm,
                        'weight_kg',  c.weight_kg,
                        'updated_at', c.updated_at
                      ) order by c.period)
               from public.bmi_checks c
              where c.staff_code = s.code
           ), '[]'::jsonb)
         )
    from public.staff s
   where s.code = p_staff_code;
$$;

revoke all on function private.share_resolve_link(text) from public, anon, authenticated;
revoke all on function private.share_assert_scope(text, text) from public, anon, authenticated;
revoke all on function private.share_staff_json(text) from public, anon, authenticated;


-- ------------------------------------------------------------------ share_open
create or replace function public.share_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link     public.share_links;
  v_settings jsonb;
  v_staff    jsonb;
begin
  v_link := private.share_resolve_link(p_token);

  select pg_catalog.jsonb_build_object(
           'bmi_first_check',       t.bmi_first_check,
           'bmi_interval_days',     t.bmi_interval_days,
           'bmi_periods',           t.bmi_periods,
           'bmi_underweight_below', t.bmi_underweight_below,
           'bmi_normal_max',        t.bmi_normal_max,
           'bmi_overweight_max',    t.bmi_overweight_max,
           'min_height_female',     t.min_height_female,
           'min_height_male',       t.min_height_male
         )
    into v_settings
    from public.settings t
   where t.id = 1;

  select coalesce(
           pg_catalog.jsonb_agg(private.share_staff_json(s.code)
                                order by st.sort, s.sort_order nulls last, s.code),
           '[]'::jsonb)
    into v_staff
    from public.staff s
    join public.stations st on st.code = s.station
   where v_link.scope = 'KPS' or s.station = v_link.scope;

  return pg_catalog.jsonb_build_object(
    'scope',    v_link.scope,
    'label',    v_link.label,
    'settings', v_settings,
    'staff',    v_staff
  );
end;
$$;


-- ------------------------------------------------------------------ share_save_check
-- Upsert on (staff_code, period). Height and weight both NULL deletes that period's row.
-- Returns the staff object (same shape as one element of share_open().staff).
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
begin
  v_link := private.share_resolve_link(p_token);
  perform private.share_assert_scope(v_link.scope, p_staff_code);

  select t.bmi_periods into v_periods from public.settings t where t.id = 1;
  if p_period is null or p_period < 1 or p_period > coalesce(v_periods, 10) then
    raise exception using errcode = '22023', message = 'invalid_input', detail = 'period';
  end if;

  if p_height_cm is null and p_weight_kg is null then
    delete from public.bmi_checks c
     where c.staff_code = p_staff_code
       and c.period = p_period;
  else
    if p_height_cm is null or p_height_cm < 120 or p_height_cm > 210 then
      raise exception using errcode = '22023', message = 'invalid_input', detail = 'height_cm';
    end if;
    if p_weight_kg is null or p_weight_kg < 30 or p_weight_kg > 200 then
      raise exception using errcode = '22023', message = 'invalid_input', detail = 'weight_kg';
    end if;

    -- Read by private.stamp_bmi_check_author() to record updated_by_link.
    perform pg_catalog.set_config('joumpa.share_link_id', v_link.id::text, true);

    insert into public.bmi_checks (staff_code, period, check_date, height_cm, weight_kg)
    values (p_staff_code, p_period, p_check_date, p_height_cm, p_weight_kg)
    on conflict (staff_code, period) do update
      set check_date = excluded.check_date,
          height_cm  = excluded.height_cm,
          weight_kg  = excluded.weight_kg;

    perform pg_catalog.set_config('joumpa.share_link_id', '', true);
  end if;

  return private.share_staff_json(p_staff_code);
end;
$$;


-- ------------------------------------------------------------------ share_save_profile
-- Sets gender ('L' | 'P' | NULL) and bmi_note (NULL / blank clears). Both are written as given.
-- Returns the staff object (same shape as one element of share_open().staff).
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
  v_gender text := nullif(pg_catalog.upper(pg_catalog.btrim(p_gender)), '');
  v_note   text := nullif(pg_catalog.btrim(p_bmi_note), '');
begin
  v_link := private.share_resolve_link(p_token);
  perform private.share_assert_scope(v_link.scope, p_staff_code);

  if v_gender is not null and v_gender not in ('L', 'P') then
    raise exception using errcode = '22023', message = 'invalid_input', detail = 'gender';
  end if;
  if pg_catalog.char_length(v_note) > 2000 then
    raise exception using errcode = '22023', message = 'invalid_input', detail = 'bmi_note';
  end if;

  update public.staff s
     set gender   = v_gender,
         bmi_note = v_note
   where s.code = p_staff_code;

  return private.share_staff_json(p_staff_code);
end;
$$;


revoke all on function public.share_open(text) from public, anon, authenticated;
revoke all on function public.share_save_check(text, text, integer, date, numeric, numeric) from public, anon, authenticated;
revoke all on function public.share_save_profile(text, text, text, text) from public, anon, authenticated;

grant execute on function public.share_open(text) to anon, authenticated;
grant execute on function public.share_save_check(text, text, integer, date, numeric, numeric) to anon, authenticated;
grant execute on function public.share_save_profile(text, text, text, text) to anon, authenticated;
