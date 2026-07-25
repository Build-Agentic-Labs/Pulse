-- Local-only bootstrap. Runs after every `supabase db reset`; never applied to the hosted
-- project.
--
-- The hosted project carries platform-level default privileges that grant the PostgREST roles
-- DML on everything in `public`. A local stack built purely from supabase/migrations/ does not:
-- no migration grants table privileges, because on the hosted side they have always just been
-- there. The result is that `authenticated` ends up with only REFERENCES/TRIGGER/TRUNCATE on
-- public tables locally, and every pgTAP suite dies on its first INSERT with
-- "permission denied for table sops" -- which is why `supabase test db` could not be run at all
-- before this file existed.
--
-- Verified against production on 2026-07-25: `authenticated` and `anon` there hold
-- DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE on public.sops. This reproduces that.
-- RLS is still the gate -- these are table grants, and every policy applies on top of them
-- exactly as it does in production.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Test helper: drive an in_review SOP to the point where its seats may sign.
--
-- The SOP lifecycle grew two preconditions that every pgTAP suite predates, and eight of them
-- rotted because each encoded the old flow inline:
--   * 20260715172000 — a seat cannot sign `dept_approval` until the author has requested final
--     approval, which itself requires every required approver to have returned "no changes"
--     against the SOP's CURRENT content_hash and review_cycle.
--   * 20260715190000 — a signer needs a saved handwritten signature before `dept_approval` or
--     `quality_approval`.
--
-- Living here rather than being pasted into each suite means the next lifecycle change is one
-- edit, not eight. Local only: seed.sql is never applied to the hosted project.
create or replace function public.test_ready_for_approval(p_sop text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sop    record;
  v_claims text;
begin
  select * into v_sop from public.sops where id = p_sop;
  if v_sop is null then raise exception 'test_ready_for_approval: SOP % not found', p_sop; end if;

  -- Every fixture user can sign. Cheaper than making each suite seed its own profiles, and the
  -- gate under test is never "did the signer draw a signature".
  insert into public.user_signature_profiles (user_id, signature_strokes)
  select u.id, '[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb
    from auth.users u
   where not exists (
     select 1 from public.user_signature_profiles p where p.user_id = u.id);

  -- One "no changes" draft review per required approver, bound to the CURRENT hash and cycle:
  -- a revision moves both, so this is re-runnable per cycle rather than once per SOP.
  insert into public.sop_review_submissions
    (sop_id, review_cycle, reviewer_id, reviewer_name, no_changes, content_hash)
  -- distinct: one signer may hold two seats on the same SOP, and the unique index over
  -- (sop_id, review_cycle, reviewer_id, content_hash) would reject the duplicate row. The NOT
  -- EXISTS below cannot catch it either -- it does not see rows inserted by its own statement.
  select distinct p_sop, v_sop.review_cycle, st.signer_id, 'Reviewer', true, v_sop.content_hash
    from public.sop_review_seats st
   where st.sop_id = p_sop
     and st.signer_id is not null
     and not exists (
       select 1 from public.sop_review_submissions s
        where s.sop_id = p_sop
          and s.reviewer_id = st.signer_id
          and s.review_cycle = v_sop.review_cycle
          and s.content_hash = v_sop.content_hash);

  -- request_sop_final_approval reads auth.uid() and admits only the author or submitter, so
  -- borrow that identity and hand the caller's own back afterwards.
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', coalesce(v_sop.submitted_by, v_sop.created_by)::text,
      'role', 'authenticated')::text,
    true);
  perform public.request_sop_final_approval(p_sop);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end $$;

-- Deliberately NOT granting on functions. Postgres already grants EXECUTE to PUBLIC by default,
-- and several migrations revoke it again on purpose -- `next_sop_number`,
-- `mint_sop_number_internal`, and `snapshot_sop_revision` must stay unreachable by
-- `authenticated`, since a client that can mint a number can reopen the numbering gaps that
-- deferred numbering closed. A blanket `grant all on all functions` here would silently undo
-- those revokes and make the security assertions in sops_enforcement_test pass vacuously.
