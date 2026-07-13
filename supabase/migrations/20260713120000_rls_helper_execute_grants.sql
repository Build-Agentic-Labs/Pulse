-- RLS-helper functions are invoked DIRECTLY in policy USING clauses (can_read_sop on sops /
-- sop_signatures / sop_revisions / sop_review_seats; department_has_members on sops; holds_sop_seat
-- on sop_review_seats). A policy function executes as the QUERYING role, so that role must hold
-- EXECUTE or the policy raises "permission denied for function" (42501) instead of filtering rows.
--
-- The earlier migrations revoked these from `anon` as a hardening reflex — but that turned an empty
-- result into a hard error on any table that actually has rows (sop_signatures, sop_revisions).
-- Granting anon is safe: the functions are security definer and gate on auth.uid(), which is null
-- for an unauthenticated caller, so anon simply sees no rows — exactly the prior behaviour.

grant execute on function public.can_read_sop(text) to anon;
grant execute on function public.holds_sop_seat(text) to anon;
grant execute on function public.can_edit_sop_roster(text) to anon;
grant execute on function public.department_has_members(text) to anon;

-- Re-affirm authenticated (idempotent) so both roles are explicit in one place.
grant execute on function public.can_read_sop(text) to authenticated;
grant execute on function public.holds_sop_seat(text) to authenticated;
grant execute on function public.can_edit_sop_roster(text) to authenticated;
grant execute on function public.department_has_members(text) to authenticated;
