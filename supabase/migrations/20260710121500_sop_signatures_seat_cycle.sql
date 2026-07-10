-- Signatures gain the seat they were made for, the cycle they belong to, and — for the three
-- disposition meanings — the objection they close.
--
-- seat_department_id is what lets one person hold blocking seats for two departments: they sign
-- once per seat, and "which department did they sign for?" stays answerable. Without it a single
-- row satisfies both seats and the escalation rule (who may overrule a Responsible objection?)
-- becomes underivable.

alter table public.sop_signatures
  add column if not exists seat_department_id    text references public.departments(id),
  add column if not exists review_cycle          int not null default 0,
  add column if not exists resolves_signature_id text references public.sop_signatures(id);

create index if not exists sop_signatures_resolves_idx
  on public.sop_signatures (resolves_signature_id) where resolves_signature_id is not null;
create index if not exists sop_signatures_seat_idx
  on public.sop_signatures (sop_id, seat_department_id, meaning);

-- Deliberately NO unique index on the widened idempotency key. sign_sop matches an existing row
-- only when nothing RESOLVES it, so a withdrawn objection can be raised again at the same
-- hash+cycle. A unique constraint would turn that legitimate re-objection into a constraint
-- violation. Idempotency is enforced in sign_sop, where it can see the resolution state.

-- ── widen the WORM read policies to cross-department seat holders ──────────────────────────
-- A reviewer must see the roster's signatures and the revision history of a document they are
-- being asked to sign, even though it belongs to another department. This is the transparency
-- requirement: every party can see who has reviewed and approved.

drop policy if exists sop_signatures_read on public.sop_signatures;
create policy sop_signatures_read on public.sop_signatures for select using (
  public.can_read_sop(sop_id)
);

drop policy if exists sop_revisions_read on public.sop_revisions;
create policy sop_revisions_read on public.sop_revisions for select using (
  public.can_read_sop(sop_id)
);

-- ── shared predicates, used by both sign_sop and enforce_sop_transition ─────────────────────

/** Has every Responsible and Accountable seat signed for the CURRENT content and cycle? */
create or replace function public.sop_quorum_met(p_sop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.sop_review_seats st
                 where st.sop_id = p_sop and st.rasic = 'responsible')
     and not exists (
    select 1
    from public.sop_review_seats st
    join public.sops s on s.id = st.sop_id
    where st.sop_id = p_sop
      and st.rasic in ('responsible', 'accountable')
      and not exists (
        select 1 from public.sop_signatures g
        where g.sop_id = st.sop_id
          and g.signer_id = st.signer_id
          and g.seat_department_id = st.department_id
          and g.meaning = 'dept_approval'
          and g.signed_content_hash = s.content_hash
          and g.review_cycle = s.review_cycle));
$$;

/**
 * An objection is OPEN while it is bound to the document as it stands now and nothing resolves
 * it. An edit moves the hash and the objection is moot; a revision moves the cycle and it can
 * never resurrect.
 */
create or replace function public.sop_has_open_objection(p_sop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sop_signatures o
    join public.sops s on s.id = o.sop_id
    where o.sop_id = p_sop
      and o.meaning = 'rejection'
      and o.signed_content_hash = s.content_hash
      and o.review_cycle = s.review_cycle
      and not exists (
        select 1 from public.sop_signatures r where r.resolves_signature_id = o.id));
$$;

/**
 * Write an explicit closure row for every objection this cycle whose content no longer exists.
 * "Sustained" would otherwise be the one disposition that leaves no audit record — the objection
 * simply stops matching the hash. An auditor asking "how was this closed?" deserves an answer.
 */
create or replace function public.close_moot_objections(p_sop text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s record; o record; v_name text;
begin
  select * into s from public.sops where id = p_sop;
  select full_name into v_name from public.profiles where id = auth.uid();

  for o in
    select sg.id from public.sop_signatures sg
    where sg.sop_id = p_sop
      and sg.meaning = 'rejection'
      and sg.review_cycle = s.review_cycle
      and sg.signed_content_hash <> s.content_hash
      and not exists (select 1 from public.sop_signatures r where r.resolves_signature_id = sg.id)
  loop
    insert into public.sop_signatures
      (id, sop_id, signer_id, meaning, signer_printed_name, signed_content_hash,
       review_cycle, resolves_signature_id)
    values (gen_random_uuid()::text, p_sop, auth.uid(), 'objection_sustained', coalesce(v_name, ''),
            s.content_hash, s.review_cycle, o.id);
  end loop;
end $$;

revoke execute on function public.sop_quorum_met(text) from public, anon;
revoke execute on function public.sop_has_open_objection(text) from public, anon;
revoke execute on function public.close_moot_objections(text) from public, anon, authenticated;
grant execute on function public.sop_quorum_met(text) to authenticated;
grant execute on function public.sop_has_open_objection(text) to authenticated;
