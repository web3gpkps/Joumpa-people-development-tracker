-- Owner decision 8 Oct 2026: the signed-in owner works on the full workbook through the same
-- share_* functions (one write path, one set of validations).
--   p_token NULL or blank AND public.is_admin()  ->  scope KPS, link id NULL, label 'Pemilik'.
--   Anyone else with NULL / blank                 ->  invalid_link (unchanged).
-- The owner path never reads or touches a share_links row, and owner writes leave
-- updated_by_link NULL (weekly_scores.updated_by / bmi_checks.updated_by_user = the owner's uid).
-- Owner-only deletes and action-item creation are direct table writes under the admin RLS policy.

create or replace function private.share_resolve_link(p_token text)
returns public.share_links
language plpgsql
set search_path = ''
as $$
declare
  v_link public.share_links;
begin
  if nullif(pg_catalog.btrim(p_token), '') is null then
    if public.is_admin() then
      v_link.scope := 'KPS';
      v_link.label := 'Pemilik';
      return v_link;
    end if;
    raise exception using errcode = 'P0001', message = 'invalid_link';
  end if;

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

-- Owner path has no link id: store '' so the attribution triggers record NULL.
create or replace function private.share_begin_write(p_token text)
returns public.share_links
language plpgsql
set search_path = ''
as $$
declare
  v_link public.share_links;
begin
  v_link := private.share_resolve_link(p_token);
  perform pg_catalog.set_config('joumpa.share_link_id', coalesce(v_link.id::text, ''), true);
  return v_link;
end;
$$;

revoke all on function private.share_resolve_link(text) from public, anon, authenticated;
revoke all on function private.share_begin_write(text)  from public, anon, authenticated;
