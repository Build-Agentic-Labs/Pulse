-- A change log entry records a change to an ALREADY-RELEASED version. v1.0 therefore carries
-- none, and every release after it carries exactly one. The row is written at release, not when
-- the revision is opened — at Gate D nothing has changed yet. The trigger already discriminates
-- first-release from re-release via `old.major_version is null`, so the rule falls out of a
-- condition the code was evaluating anyway.

-- The released roster must be frozen with the document. Seats are mutable in draft, so without
-- this a later revision silently rewrites who signed for what on the version already in force.
alter table public.sop_revisions add column if not exists roster jsonb;

create table if not exists public.sop_change_log (   -- write-once
  id                  text primary key default gen_random_uuid()::text,
  sop_id              text not null references public.sops(id) on delete cascade,
  revision_id         text references public.sop_revisions(id),
  from_version        text not null,
  to_version          text not null,
  reason              text not null,
  significance        text,
  requires_retraining boolean not null default false,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now()
);
create index if not exists sop_change_log_sop_idx on public.sop_change_log (sop_id, created_at desc);

alter table public.sop_change_log enable row level security;
revoke insert, update, delete on public.sop_change_log from anon, authenticated;

drop policy if exists sop_change_log_read on public.sop_change_log;
create policy sop_change_log_read on public.sop_change_log
for select to authenticated using (public.can_read_sop(sop_id));

-- Snapshot the current document AND its roster into an immutable revision. Internal only.
create or replace function public.snapshot_sop_revision(p_sop text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare s record; v_id text; v_label text; v_roster jsonb;
begin
  select * into s from public.sops where id = p_sop;
  if s is null then raise exception 'SOP % not found', p_sop; end if;

  v_label := coalesce(s.major_version, 1)::text || '.' || coalesce(s.minor_version, 0)::text;
  v_id := gen_random_uuid()::text;

  select coalesce(jsonb_agg(jsonb_build_object(
           'department_id', st.department_id,
           'rasic',         st.rasic,
           'signer_id',     st.signer_id) order by st.rasic, st.department_id), '[]'::jsonb)
    into v_roster
    from public.sop_review_seats st
   where st.sop_id = p_sop;

  insert into public.sop_revisions
    (id, sop_id, workspace_id, version_label, document, content_hash, created_by, roster)
  values (v_id, p_sop, s.workspace_id, v_label, s.document,
          public.sop_doc_hash(s.document), auth.uid(), v_roster);
  return v_id;
end $$;
revoke execute on function public.snapshot_sop_revision(text) from public, anon, authenticated;
