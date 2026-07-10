-- RASIC is assigned to DEPARTMENTS. Each seated department names exactly one designated
-- reviewer who signs on its behalf. sops.department_id is unchanged — it remains the OWNING
-- department, the anchor for DEPT-TYPE-NNN numbering and for authorship. Seats are additive.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'sop_rasic') then
    create type public.sop_rasic as enum
      ('responsible', 'accountable', 'support', 'consulted', 'informed');
  end if;
end $$;

create table if not exists public.sop_review_seats (
  sop_id        text not null references public.sops(id) on delete cascade,
  department_id text not null references public.departments(id) on delete restrict,
  rasic         public.sop_rasic not null,
  signer_id     uuid references auth.users(id),
  created_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  primary key (sop_id, department_id),
  -- Informed departments are notified and never sign; everyone else must name a person.
  constraint seat_signer_required check (rasic = 'informed' or signer_id is not null)
);

-- Accountable is singular by definition — it is what makes the escalation path unambiguous.
create unique index if not exists sop_review_seats_one_accountable
  on public.sop_review_seats (sop_id) where rasic = 'accountable';
create index if not exists sop_review_seats_signer_idx on public.sop_review_seats (signer_id);

-- A person MAY hold blocking seats for two departments (a small shop's reality). They sign once
-- per seat, and each signature is stamped with the department it was made for.

-- ── security definer helpers ───────────────────────────────────────────────────────────────
-- These break the RLS cycle: sops' read policy must consult sop_review_seats, whose read policy
-- must consult sops. A definer function runs as the table owner and bypasses RLS entirely.

create or replace function public.holds_sop_seat(p_sop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sop_review_seats s
    where s.sop_id = p_sop and s.signer_id = auth.uid()
  );
$$;

create or replace function public.can_read_sop(p_sop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sops s
    where s.id = p_sop
      and (
        (s.status = 'effective' and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = s.workspace_id and wm.user_id = auth.uid()))
        or (
          public.has_org_tool_access(s.workspace_id, 'view'::public.access_level)
          and (
            s.department_id is null
            or public.has_department_role(
                 s.department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])
            or not public.department_has_members(s.department_id)))
        -- A cross-department reviewer must be able to see the SOP they are asked to sign.
        or public.holds_sop_seat(s.id)
      )
  );
$$;

/** The roster is editable only while the SOP is a draft. */
create or replace function public.can_edit_sop_roster(p_sop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sops s
    where s.id = p_sop
      and s.status = 'draft'
      and s.deleted_at is null
      and public.has_org_tool_access(s.workspace_id, 'edit'::public.access_level)
      and (
        s.department_id is null
        or public.has_department_role(
             s.department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])
        or not public.department_has_members(s.department_id))
  );
$$;

revoke execute on function public.holds_sop_seat(text) from public, anon;
revoke execute on function public.can_read_sop(text) from public, anon;
revoke execute on function public.can_edit_sop_roster(text) from public, anon;
grant execute on function public.holds_sop_seat(text) to authenticated;
grant execute on function public.can_read_sop(text) to authenticated;
grant execute on function public.can_edit_sop_roster(text) to authenticated;

-- ── the roster freezes on submit ───────────────────────────────────────────────────────────
-- Triggers fire even for security definer callers, so reassign_sop_seat passes through here
-- too. Once the SOP leaves draft, only signer_id may move — that is seat reassignment.
create or replace function public.enforce_seat_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  select status into v_status from public.sops where id = coalesce(new.sop_id, old.sop_id);

  if v_status = 'draft' then
    if tg_op = 'DELETE' then return old; end if;
    new.updated_at := now();
    if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
    return new;
  end if;

  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'The review roster is frozen once the SOP has been submitted';
  end if;

  if new.sop_id is distinct from old.sop_id
     or new.department_id is distinct from old.department_id
     or new.rasic is distinct from old.rasic then
    raise exception 'Only the designated reviewer may change once the SOP has been submitted';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists sop_review_seats_freeze on public.sop_review_seats;
create trigger sop_review_seats_freeze
before insert or update or delete on public.sop_review_seats
for each row execute function public.enforce_seat_freeze();

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────
alter table public.sop_review_seats enable row level security;

drop policy if exists sop_review_seats_read on public.sop_review_seats;
create policy sop_review_seats_read on public.sop_review_seats
for select to authenticated using (public.can_read_sop(sop_id));

-- Authoring the roster. Reassignment after submit goes through reassign_sop_seat (definer),
-- so no update policy is granted here.
drop policy if exists sop_review_seats_write on public.sop_review_seats;
create policy sop_review_seats_write on public.sop_review_seats
for all to authenticated
using (public.can_edit_sop_roster(sop_id))
with check (public.can_edit_sop_roster(sop_id));

-- Now that holds_sop_seat exists, widen SOP visibility to cross-department seat holders.
drop policy if exists "sops workspace read" on public.sops;
create policy "sops workspace read" on public.sops
for select to authenticated using (public.can_read_sop(id));
