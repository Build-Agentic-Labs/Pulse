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

-- Deliberately NOT granting on functions. Postgres already grants EXECUTE to PUBLIC by default,
-- and several migrations revoke it again on purpose -- `next_sop_number`,
-- `mint_sop_number_internal`, and `snapshot_sop_revision` must stay unreachable by
-- `authenticated`, since a client that can mint a number can reopen the numbering gaps that
-- deferred numbering closed. A blanket `grant all on all functions` here would silently undo
-- those revokes and make the security assertions in sops_enforcement_test pass vacuously.
