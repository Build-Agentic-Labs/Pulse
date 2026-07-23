-- Pin a signature to the exact document the approver reviewed.
--
-- sign_sop stamps signed_content_hash from the CURRENT sops.content_hash at click time. A stale
-- approval tab (opened at content_hash H1, then the doc is rejected, edited, and resubmitted
-- within the SAME review_cycle so it now hashes to H2) would therefore sign H2 — content the
-- approver never saw. The client staleness check runs only on mount, so it cannot catch a
-- revision that lands while the tab sits open. The database is the gate: the caller now passes
-- the hash and cycle it rendered, and sign_sop refuses if the locked row has moved past them.
--
-- Additive: both parameters default to null (no check), so every existing caller keeps working.
-- Patched in place off the live definition with the same pg_get_functiondef splice-guard pattern
-- as 20260715143000 / 172000 / 190000, so all prior authorization and lifecycle behavior is
-- preserved. Adding parameters changes the signature, so the 5-arg function is dropped first;
-- the 7-arg signature is a strict superset reached through the defaults.

do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.sign_sop(text,text,text,text,text)'::regprocedure)
  into v_definition;

  -- Widen the signature with two optional, defaulted parameters.
  if position($from$p_resolves text DEFAULT NULL::text)$from$ in v_definition) = 0 then
    raise exception 'sign_sop signature changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$p_resolves text DEFAULT NULL::text)$from$,
    $to$p_resolves text DEFAULT NULL::text, p_expected_hash text DEFAULT NULL::text, p_expected_cycle integer DEFAULT NULL::integer)$to$
  );

  -- Reject a signature bound to content or a cycle the caller did not render. Placed right after
  -- the FOR UPDATE row read so the check sees the committed, locked row.
  if position($from$  v_hash := s.content_hash;
  v_cycle := s.review_cycle;$from$ in v_definition) = 0 then
    raise exception 'sign_sop lock/read block changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$  v_hash := s.content_hash;
  v_cycle := s.review_cycle;$from$,
    $to$  if p_expected_hash is not null and p_expected_hash is distinct from s.content_hash then
    raise exception 'This SOP was revised since you opened it; reload and review the current version before signing';
  end if;
  if p_expected_cycle is not null and p_expected_cycle is distinct from s.review_cycle then
    raise exception 'This SOP was revised since you opened it; reload and review the current version before signing';
  end if;
  v_hash := s.content_hash;
  v_cycle := s.review_cycle;$to$
  );

  -- The 5-arg function must go or 2-arg calls become ambiguous overloads.
  drop function if exists public.sign_sop(text, text, text, text, text);
  execute v_definition;
end;
$migration$;

revoke execute on function public.sign_sop(text, text, text, text, text, text, integer) from public, anon;
grant execute on function public.sign_sop(text, text, text, text, text, text, integer) to authenticated;
