-- Return only the system-recorded SOP author name to callers who can already
-- read the SOP. This keeps colleague profiles private while allowing the
-- controlled PDF to identify its author reliably.
create or replace function public.sop_author_display_name(p_sop text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(profile.full_name), ''),
    nullif(btrim(authorship.signer_printed_name), ''),
    'System author'
  )
  from public.sops sop
  left join public.profiles profile
    on profile.id = coalesce(
      sop.created_by,
      sop.submitted_by,
      sop.final_approval_requested_by
    )
  left join lateral (
    select signature.signer_printed_name
    from public.sop_signatures signature
    where signature.sop_id = sop.id
      and signature.meaning = 'authorship'
    order by signature.signed_at asc
    limit 1
  ) authorship on true
  where sop.id = p_sop
    and public.can_read_sop(sop.id);
$$;

revoke all on function public.sop_author_display_name(text) from public, anon;
grant execute on function public.sop_author_display_name(text) to authenticated, service_role;
