-- Reveal only assigned approvers' display names, never their profile or email.
-- Definer access is necessary because ordinary SOP readers cannot read colleague profiles.
create or replace function public.sop_approver_display_names(p_sops text[])
returns table (signer_id uuid, display_name text)
language sql stable security definer set search_path = ''
as $$
  select distinct seat.signer_id, nullif(btrim(profile.full_name), '')
  from public.sops sop
  join public.sop_review_seats seat on seat.sop_id = sop.id
  join public.profiles profile on profile.id = seat.signer_id
  where auth.uid() is not null
    and sop.id = any(p_sops)
    and sop.deleted_at is null
    and public.can_read_sop(sop.id);
$$;

revoke all on function public.sop_approver_display_names(text[]) from public, anon;
grant execute on function public.sop_approver_display_names(text[]) to authenticated;
