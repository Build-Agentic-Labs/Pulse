-- Department names can be inferred from the authored SOP before every department has a reviewer.
-- Keep those inferred rows in the draft roster, but preserve the hard gate on submission.

alter table public.sop_review_seats
  drop constraint if exists seat_signer_required;

create or replace function public.enforce_sop_review_seats_staffed_on_submit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'in_review' and exists (
    select 1
    from public.sop_review_seats seat
    where seat.sop_id = old.id
      and seat.rasic <> 'informed'
      and seat.signer_id is null
  ) then
    raise exception 'Choose a reviewer for every Responsible, Accountable, Support, and Consulted department';
  end if;
  return new;
end;
$$;

drop trigger if exists a_sop_review_seats_staffed_on_submit on public.sops;
create trigger a_sop_review_seats_staffed_on_submit
before update of status on public.sops
for each row execute function public.enforce_sop_review_seats_staffed_on_submit();

revoke execute on function public.enforce_sop_review_seats_staffed_on_submit() from public, anon, authenticated;
