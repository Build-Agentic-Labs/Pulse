-- Phase 3: frozen version history + e-signatures, both write-once (WORM). The in-force copy
-- is named by sops.effective_revision_id (added here so its FK target exists). Signatures bind
-- to a content hash (sop_doc_hash) so they can't be transferred to another version. Full
-- 21 CFR Part 11 re-authentication (auth_method/re_authenticated) is reserved for Phase 4.

-- Deterministic content hash of an SOP document (jsonb text form is normalized).
create or replace function public.sop_doc_hash(doc jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(doc::text, 'UTF8')), 'hex');
$$;

create table if not exists public.sop_revisions (
  id            text primary key default gen_random_uuid()::text,
  sop_id        text not null references public.sops(id) on delete cascade,
  workspace_id  text not null,
  version_label text not null,
  document      jsonb not null,
  content_hash  text not null,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists sop_revisions_sop_idx on public.sop_revisions (sop_id, created_at desc);

create table if not exists public.sop_signatures (
  id                  text primary key default gen_random_uuid()::text,
  sop_id              text not null references public.sops(id) on delete cascade,
  revision_id         text references public.sop_revisions(id) on delete set null,
  signer_id           uuid not null references auth.users(id),
  meaning             text not null,  -- authorship | review | dept_approval | quality_approval | rejection
  signer_printed_name text not null default '',
  signed_content_hash text not null,
  rejected_reason     text,
  auth_method         text,
  re_authenticated    boolean not null default false,
  signed_at           timestamptz not null default now()
);
create index if not exists sop_signatures_sop_idx on public.sop_signatures (sop_id, signed_at desc);

alter table public.sops add column if not exists effective_revision_id text references public.sop_revisions(id);

-- WORM: clients read only; inserts happen exclusively through the definer functions below.
alter table public.sop_revisions enable row level security;
alter table public.sop_signatures enable row level security;
revoke update, delete on public.sop_revisions from anon, authenticated;
revoke update, delete on public.sop_signatures from anon, authenticated;

drop policy if exists sop_revisions_read on public.sop_revisions;
create policy sop_revisions_read on public.sop_revisions for select using (
  exists (
    select 1 from public.sops s where s.id = sop_id and (
      public.has_workspace_role(s.workspace_id, array['owner', 'admin']::public.workspace_role[])
      or public.has_department_role(s.department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])
      or (s.status = 'effective' and exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = s.workspace_id and wm.user_id = auth.uid()))
    )
  )
);

drop policy if exists sop_signatures_read on public.sop_signatures;
create policy sop_signatures_read on public.sop_signatures for select using (
  exists (
    select 1 from public.sops s where s.id = sop_id and (
      public.has_workspace_role(s.workspace_id, array['owner', 'admin']::public.workspace_role[])
      or public.has_department_role(s.department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])
    )
  )
);

-- Snapshot the current SOP document into an immutable revision. Internal only (called by the
-- transition trigger); revoked from clients so nobody can forge a frozen revision directly.
create or replace function public.snapshot_sop_revision(p_sop text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare s record; v_id text; v_label text;
begin
  select * into s from public.sops where id = p_sop;
  if s is null then raise exception 'SOP % not found', p_sop; end if;
  v_label := coalesce(s.major_version, 1)::text || '.' || coalesce(s.minor_version, 0)::text;
  v_id := gen_random_uuid()::text;
  insert into public.sop_revisions (id, sop_id, workspace_id, version_label, document, content_hash, created_by)
  values (v_id, p_sop, s.workspace_id, v_label, s.document, public.sop_doc_hash(s.document), auth.uid());
  return v_id;
end $$;
revoke execute on function public.snapshot_sop_revision(text) from public, anon, authenticated;

-- Record an e-signature bound to the SOP's current content hash. Authorizes the caller for the
-- claimed meaning and enforces segregation of duties (author≠approver, dept-approver≠quality).
create or replace function public.sign_sop(p_sop text, p_meaning text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare s record; v_hash text; v_name text; v_id text; v_existing text;
begin
  select * into s from public.sops where id = p_sop and deleted_at is null;
  if s is null then raise exception 'SOP % not found', p_sop; end if;
  v_hash := public.sop_doc_hash(s.document);
  select full_name into v_name from public.profiles where id = auth.uid();

  if p_meaning = 'dept_approval' then
    if not public.has_department_role(s.department_id, array['approver']::public.department_sop_role[]) then
      raise exception 'Only a department approver can sign the approval';
    end if;
    if auth.uid() is not distinct from coalesce(s.submitted_by, s.created_by) then
      raise exception 'You cannot approve an SOP you submitted for review';
    end if;
  elsif p_meaning = 'quality_approval' then
    if not exists (
      select 1 from public.department_members m
      join public.departments q on q.id = m.department_id
      where m.user_id = auth.uid() and m.dept_role = 'approver'
        and q.is_quality_gate and q.workspace_id = s.workspace_id) then
      raise exception 'Only a Quality approver can sign the quality approval';
    end if;
    if auth.uid() is not distinct from s.approved_by then
      raise exception 'The Quality approver must differ from the department approver';
    end if;
  elsif p_meaning = 'review' then
    if not public.has_department_role(s.department_id, array['reviewer', 'approver']::public.department_sop_role[]) then
      raise exception 'Only a reviewer can sign a review';
    end if;
  elsif p_meaning = 'rejection' then
    if p_reason is null or btrim(p_reason) = '' then raise exception 'A rejection needs a reason'; end if;
    if not (public.has_department_role(s.department_id, array['reviewer', 'approver']::public.department_sop_role[])
            or auth.uid() is not distinct from s.submitted_by) then
      raise exception 'Only a reviewer, approver, or the submitter can reject this SOP';
    end if;
  else
    raise exception 'Unknown signature meaning %', p_meaning;
  end if;

  -- Idempotent: a retried sign (e.g. after a transient transition failure) must not append a
  -- duplicate immutable signature for the same signer/meaning/content.
  select id into v_existing from public.sop_signatures
    where sop_id = p_sop and signer_id = auth.uid() and meaning = p_meaning and signed_content_hash = v_hash
    limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  v_id := gen_random_uuid()::text;
  insert into public.sop_signatures
    (id, sop_id, signer_id, meaning, signer_printed_name, signed_content_hash, rejected_reason)
  values (v_id, p_sop, auth.uid(), p_meaning, coalesce(v_name, ''), v_hash, p_reason);
  return v_id;
end $$;
