-- Close the hard-delete hole on public.sops.
--
-- Every document-control rule this system has — "an effective SOP cannot be
-- deleted", the department scoping, the status gates — lives in
-- enforce_sop_transition and enforce_sop_department_content_edit, and BOTH are
-- BEFORE UPDATE triggers. Nothing guarded DELETE:
--
--   * policy "sops workspace delete" = has_workspace_role(workspace_id,
--     ARRAY['owner','admin']) — no department clause, no status clause
--   * no BEFORE DELETE trigger existed on public.sops
--   * `anon` and `authenticated` both held the DELETE grant
--
-- So any workspace owner/admin could issue DELETE /rest/v1/sops?id=eq.… with the
-- public anon key and their own JWT and destroy another department's EFFECTIVE
-- SOP outright — and nine child tables cascade with it, including
-- sop_signatures, sop_revisions, sop_event_log and sop_change_log. The audit
-- trail was one REST call from gone.
--
-- Those child tables already refuse DELETE to `authenticated` on their own; the
-- parent cascade was the only way to reach them. Closing sops closes all of it.
--
-- Nothing in the application hard-deletes an SOP. src/lib/sop/store.ts:356 sets
-- deleted_at (soft delete, fully guarded); every other .delete() in the codebase
-- targets a child table (annotations, annex files, review seats, rasic roles,
-- job titles, extraction requests). No pgTAP test and no seed hard-deletes sops.
-- Removing the capability therefore costs nothing that is used.
--
-- Two layers, deliberately:
--   1. REVOKE the grant — removes the ability outright.
--   2. A BEFORE DELETE trigger — durable if a later migration re-grants (a
--      blanket `grant all on all tables in schema public to anon, authenticated`
--      would silently undo layer 1; it cannot undo layer 2).
--
-- This migration is purely ADDITIVE. It does NOT touch enforce_sop_transition or
-- sign_sop, which are patched in place and must never be rewritten from a file.

create or replace function public.refuse_sop_hard_delete()
returns trigger
language plpgsql
-- SECURITY INVOKER on purpose: the check reads current_user, which must be the
-- caller's role. A SECURITY DEFINER function would see the owner and never fire —
-- the same trap that makes current_user useless inside enforce_sop_transition.
security invoker
set search_path to ''
as $function$
begin
  if current_user = 'authenticated' then
    raise exception 'An SOP is retired, never hard-deleted: set deleted_at instead. A hard delete would cascade away its signatures, revisions and event log.'
      using errcode = '42501';
  end if;
  return old;
end
$function$;

comment on function public.refuse_sop_hard_delete() is
  'Blocks hard DELETE of public.sops from the authenticated role so the soft-delete guards in enforce_sop_transition cannot be bypassed. Owner and service_role remain able to delete for genuine maintenance.';

drop trigger if exists sops_refuse_hard_delete on public.sops;
create trigger sops_refuse_hard_delete
  before delete on public.sops
  for each row execute function public.refuse_sop_hard_delete();

-- TRUNCATE bypasses RLS *and* row-level triggers, and `authenticated` holds it
-- (relacl shows arwdDxtm — the D). A statement-level BEFORE TRUNCATE trigger is
-- the only thing that stops it, since the grant itself is not durable (below).
create or replace function public.refuse_sop_truncate()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
begin
  if current_user = 'authenticated' then
    raise exception 'public.sops cannot be truncated: it holds controlled documents and their signature history.'
      using errcode = '42501';
  end if;
  return null;
end
$function$;

drop trigger if exists sops_refuse_truncate on public.sops;
create trigger sops_refuse_truncate
  before truncate on public.sops
  for each statement execute function public.refuse_sop_truncate();

-- The bigger hole, and the one a delete guard on `sops` alone does not close:
--   sops_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
--     ON DELETE CASCADE
-- `workspaces` grants DELETE to anon/authenticated under policy
-- "workspaces owner delete" (has_workspace_role(id, ARRAY['owner'])) and has NO
-- before-delete trigger. So a workspace owner could DELETE their workspace over
-- REST and cascade away every SOP in it — 24 documents, their signatures,
-- revisions, change log and event log — without ever touching public.sops.
--
-- Nothing in the application deletes a workspace, so refusing while controlled
-- documents exist costs nothing. Retire the SOPs first, deliberately.
create or replace function public.refuse_workspace_delete_with_sops()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
begin
  if current_user = 'authenticated'
     and exists (select 1 from public.sops s where s.workspace_id = old.id) then
    raise exception 'This workspace still holds SOPs; deleting it would cascade away those controlled documents and their signature history.'
      using errcode = '42501';
  end if;
  return old;
end
$function$;

drop trigger if exists workspaces_refuse_delete_with_sops on public.workspaces;
create trigger workspaces_refuse_delete_with_sops
  before delete on public.workspaces
  for each row execute function public.refuse_workspace_delete_with_sops();

-- First layer, deliberately NOT the load-bearing one: supabase/seed.sql:19 runs
-- `grant all on all tables in schema public to anon, authenticated, service_role`,
-- so these revokes are undone on every local reset and by any future blanket
-- grant. The triggers above are what actually holds. Revoking anyway removes the
-- capability wherever the grants have not been reapplied.
revoke delete, truncate on public.sops from anon;
revoke delete, truncate on public.sops from authenticated;
