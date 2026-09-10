-- Author-nominated reviewers, 1/3.
-- Spec: docs/superpowers/specs/2026-09-10-author-reviewer-invites-design.md
--
-- (a) department_members.pending_invite_at — the provisional-membership marker. Null for every
--     ordinary member; set when a membership is minted ahead of the invitee accepting.
--     redeem_workspace_access_grants() clears it without new code: it deletes and reinserts the
--     user's department rows from the grant, and the reinsert takes the column default.
-- (b) is_department_member gains one clause: a provisional row counts only when the database is
--     asked about someone OTHER than the caller (Gate A checking a seat's signer, an admin seating
--     a nominee) — never when the provisional person is the one acting. Every read/sign path still
--     joins workspace_members, so a nominee who can already sign in still has no usable access.
--
-- is_department_member is NOT live-patched: its full current text is 20260904120000. The guard
-- below still refuses to replace a body that has drifted from that definition.

alter table public.department_members
  add column if not exists pending_invite_at timestamptz;

create index if not exists department_members_pending_idx
  on public.department_members (department_id)
  where pending_invite_at is not null;

do $$
declare
  v_def text := pg_get_functiondef('public.is_department_member(text, uuid)'::regprocedure);
begin
  if position('join public.workspace_members wm' in v_def) = 0 then
    raise exception 'is_department_member has drifted from its 20260904120000 definition; review before widening';
  end if;
end $$;

create or replace function public.is_department_member(dept_id text, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select dept_id is not null and p_user is not null and (
    exists (
      select 1 from public.department_members m
      join public.departments d on d.id = m.department_id
      join public.workspace_members wm on wm.workspace_id = d.workspace_id and wm.user_id = m.user_id
      where m.department_id = dept_id and m.user_id = p_user)
    or (
      auth.uid() is distinct from p_user
      and exists (
        select 1 from public.department_members m
        where m.department_id = dept_id and m.user_id = p_user and m.pending_invite_at is not null)
    )
  );
$$;
