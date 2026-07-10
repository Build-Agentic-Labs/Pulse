# SOP RASIC Approval — Design

**Date:** 2026-07-09
**Status:** Approved for planning
**Branch:** `feat/sop-rasic-approval`

## Problem

An SOP today has exactly one owning department, and a single approver from that department
clears the path to Quality. Reviewer signatures can be recorded but gate nothing: no transition
reads `meaning = 'review'`. The result is a workflow that enforces *independence* (approver ≠
submitter, Quality ≠ department approver) but never *completeness* — nobody checks that everyone
who should have reviewed the document actually did.

The business needs multi-department review: an SOP names several responsible departments, each
contributes one designated reviewer, and only when all of them have signed may Quality release it.

## Requirements

1. RASIC (Responsible, Accountable, Support, Informed, Consulted) is assigned **to departments**,
   not to individuals. An SOP names one owning department plus any number of RASIC departments.
2. Each seated department names exactly **one designated reviewer** who signs on its behalf.
3. **Responsible** and **Accountable** seats gate the release. **Support** and **Consulted** sign
   and comment but never block. **Informed** is notified and never signs.
4. The author signs `authorship` — a declaration of origin, not an approval. It never counts
   toward quorum.
5. Only when every blocking seat has signed does the SOP become department-approved. Quality then
   signs alone and releases it.
6. Every party reviewing an SOP can see the full roster: department, RASIC duty, designated
   signer, signed-or-pending, timestamp.
7. Objections show who flagged and why, route to the author, and close exactly one of three ways:
   **withdrawn** (objector rescinds), **sustained** (author edits), **overruled** (named authority
   sets it aside with a written justification).
8. On release the document freezes and an immutable revision snapshot is taken. A **change log
   entry is written only when an already-effective version is revised** — v1.0 carries none.
9. When a designated reviewer is unavailable, a workspace admin **reassigns the seat**. Admins move
   people; admins never sign.

## Non-goals

- Email or push notifications. "Notification" means the SOP appears in the reviewer's queue.
  No notifications table.
- 21 CFR Part 11 re-authentication (`auth_method`, `re_authenticated`), already deferred.
- An "editorial change" classification that carries signatures across a content change. This is
  the most-abused feature in document control; if it is ever added, Quality must own the
  classification, not the author.
- Major-version bumps. All revisions bump minor. `from_version` in the change log is derivable
  only because of this; a future major-bump path must revisit it.

## Defects in existing code that this work fixes

These are live on `main` and the redesign sits on top of them. They are folded into this package
rather than shipped separately, at the user's direction.

### D1 — Department-scoped RLS grants access to everyone (security)

`20260708120000_sops_dept_scoped_rls.sql` grandfathers memberless departments with an **inline
subquery** in the policy:

```sql
or not exists (
  select 1 from public.department_members m
  where m.department_id = public.sops.department_id
)
```

Policy expressions are evaluated under the caller's own RLS, and `department_members_read` exposes
only rows where `user_id = auth.uid()`. To any non-member, every department appears memberless, the
`not exists` returns true, and the branch grants access.

**Effect:** any workspace member with org-tool `view` can read every department's draft and
in-review SOPs; anyone with `edit` can modify them. Contained to the workspace —
`has_org_tool_access(workspace_id, …)` still holds the tenant boundary — but department scoping
does not scope.

**Fix:** a `security definer` `department_has_members(dept_id)` helper. Generalized rule below.

### D2 — The INSERT branch does not strip version columns

`enforce_sop_transition` (guard v2) strips nine lifecycle columns on INSERT but not
`major_version`, `minor_version`, or `version`. A raw PostgREST insert with `major_version: 1`
produces a draft that stamps a forged version on first release, and — under this design — would
emit a change log entry for a first release.

`change_significance` and `requires_retraining` (added in `20260707122000`) are likewise neither
stripped on INSERT nor pinned on UPDATE nor covered by the content freeze, so they are freely
PATCHable at any status. The change log cannot trust them until they are.

### D3 — `has_department_role` folds in two classes of non-member

```sql
or ('approver' = any(roles) and exists (…where m.dept_role = 'approver' and q.is_quality_gate…))
or public.has_workspace_role(workspace_id, array['owner','admin'])
```

A workspace owner/admin, **and any Quality-gate approver**, satisfies the department-approver check
in *every* department. Today a Quality approver can sign a department approval and retire any SOP;
an admin can sign a rejection. Signing must not use this function.

### D4 — `authorship` is a declared meaning the code refuses to create

`sop_signatures.meaning` documents `authorship`, `MEANING_LABELS` in `sop-approval-panel.tsx`
renders a label for it, and `sign_sop` falls through to `raise exception 'Unknown signature
meaning'`. Requirement 4 depends on it existing.

### D5 — "Approve & sign" will break under auto-advance

`sop-approval-panel.tsx:284` calls `signSop(…)` then `transitionSop(…, c.updatedAt)`. Once
`sign_sop` advances the status itself, its UPDATE fires `sops_set_updated_at` first, so the
follow-up transition's optimistic-concurrency predicate misses and every approval raises
`SopConflictError`.

## Architecture

### Signature validity: content hash **and** review cycle

Signatures today bind only to `sop_doc_hash(document)`. Content-only binding replays signatures
across revisions: release v1.0 at hash `H`, open v1.1, edit, revert — the document is byte-identical
to `H`, and every v1.0 signature is again "bound to the current document." Quorum is satisfied
before anyone reviews.

Signatures bind to `(content_hash, review_cycle)`.

- `sops.review_cycle int not null default 0`, incremented **only** on `effective → draft`.
- `sops.content_hash text`, maintained by the transition trigger on every insert/update.

Placement of the increment is the whole design. Incrementing on every `draft → in_review` would
void every signature when a rejected SOP is resubmitted unchanged — destroying the property that
an unedited resubmit disturbs nobody but the objector. Incrementing on revision start yields both
behaviors:

- **Within a cycle**, validity tracks content. Reject → resubmit unchanged: all prior signatures
  stand, only the objector must act. Reject → edit → resubmit: prior signatures void, everyone
  re-affirms against a diff.
- **Across cycles**, a content revert can never replay a prior cycle's approvals or resurrect a
  prior cycle's objections.

`content_hash` is a stored column, not recomputed client-side: `sop_doc_hash` is a sha256 over
Postgres's `jsonb::text` rendering, which JavaScript cannot reliably reproduce (key ordering and
number formatting are Postgres-internal). Clients compare `signature.signed_content_hash =
sop.content_hash` in SQL.

It is maintained by its own `before insert or update` trigger, not by `enforce_sop_transition`.
Postgres fires same-timing triggers in **name order**, so it is named `sops_aa_set_content_hash` to
guarantee it runs before `sops_enforce_transition`, which reads the value it writes. The column is
backfilled in the same migration that adds it.

### RLS rule: no inline cross-table subqueries in policies

D1 is the general failure. Every cross-table predicate in an RLS policy goes through a
`security definer` helper owned by the migration role, which bypasses RLS on the referenced table.
Policies get: `department_has_members`, `holds_sop_seat`, `can_read_sop`.

This also breaks the mutual recursion that would otherwise arise between `sops` (whose read policy
must consult `sop_review_seats`) and `sop_review_seats` (whose read policy must consult `sops`).

`sop_review_seats` policies:

- **select** — `holds_sop_seat(sop_id) or can_read_sop(sop_id)`, both `security definer`.
- **insert / delete** — strict members of the owning department, or workspace managers, and only
  while `sops.status = 'draft'`.
- **update** — workspace owner/admin only. A `before update` trigger restricts the change to
  `signer_id` once `sops.status <> 'draft'`.

New `security definer` functions have `execute` revoked from `public` and `anon`, except
`reassign_sop_seat` and the review-queue RPC, which `authenticated` calls directly.
`snapshot_sop_revision` remains revoked from `authenticated` as well.

## Data model

`sops.department_id` is **unchanged**: the owning department, anchor for `next_sop_number`'s
`DEPT-TYPE-NNN` and for authorship. Seats are additive.

```sql
create type public.sop_rasic as enum
  ('responsible', 'accountable', 'support', 'consulted', 'informed');

create table public.sop_review_seats (
  sop_id        text not null references public.sops(id) on delete cascade,
  department_id text not null references public.departments(id) on delete restrict,
  rasic         public.sop_rasic not null,
  signer_id     uuid references auth.users(id),
  created_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  primary key (sop_id, department_id),
  constraint seat_signer_required
    check (rasic = 'informed' or signer_id is not null)
);

-- At most one Accountable seat. Gate A enforces the lower bound (exactly one).
create unique index sop_review_seats_one_accountable
  on public.sop_review_seats (sop_id) where rasic = 'accountable';
```

**A person may hold blocking seats for more than one department.** This is deliberate: in a small
organization the same person is genuinely the responsible party for two departments. They sign once
per seat, and each signature is stamped with the department it was made for.

```sql
alter table public.sop_signatures
  add column seat_department_id     text references public.departments(id),
  add column review_cycle           int not null default 0,
  add column resolves_signature_id  text references public.sop_signatures(id);
```

`seat_department_id` is required for `dept_approval`, `review`, and `rejection`; null for
`authorship` and `quality_approval`. Without it, one person holding two seats satisfies both with a
single row, and "which department did they sign for?" is underivable — which also makes the
escalation rule (below) impossible to evaluate.

Meanings become: `authorship`, `review`, `dept_approval`, `quality_approval`, `rejection`,
`objection_withdrawn`, `objection_sustained`, `objection_overruled`.

```sql
alter table public.sops
  add column content_hash    text,
  add column review_cycle    int not null default 0,
  add column revision_reason text;

create table public.sop_change_log (   -- write-once
  id            text primary key default gen_random_uuid()::text,
  sop_id        text not null references public.sops(id) on delete cascade,
  revision_id   text references public.sop_revisions(id),
  from_version  text not null,
  to_version    text not null,
  reason        text not null,
  significance  text,
  requires_retraining boolean not null default false,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
```

`sop_revisions` gains `roster jsonb`, populated by `snapshot_sop_revision`. Without it the released
document's approval record is unreconstructible: seats are mutable in draft, so a later revision
rewrites who signed for what on the version already in force.

Seat reassignments are recorded in the existing generic `audit_log` (`target_type =
'sop_review_seat'`). No new audit table.

### Idempotency

`sign_sop` returns the existing row for a repeated signature. The key must widen or the objection
machinery breaks:

```
(sop_id, signer_id, meaning, signed_content_hash, review_cycle,
 coalesce(seat_department_id, ''), coalesce(resolves_signature_id, ''))
```

Without `resolves_signature_id` in the key, one person overruling two objections at the same hash
collides on the second: the resolving row is never written and the objection stays open forever.
Without `review_cycle`, a re-objection after a withdrawal silently returns the resolved original.

## Authorization

`is_department_member(dept_id, roles[])` — strict membership, **no fold-ins**. New function.

| Action | Authorized by |
|---|---|
| `dept_approval` | `auth.uid() = seat.signer_id`, seat is `responsible` or `accountable` |
| `review` | `auth.uid() = seat.signer_id`, seat is `support` or `consulted` |
| `rejection` | `auth.uid() = seat.signer_id`, seat is `responsible` or `accountable` |
| `authorship` | strict member of the owning department — the person submitting this cycle |
| `quality_approval` | strict approver in the `is_quality_gate` department |
| `objection_withdrawn` | `auth.uid() = objection.signer_id` |
| `objection_overruled` | see escalation, below |
| submit, start revision, retire, read | `has_department_role` (permissive fold-ins retained) |

`authorship` is signed by `auth.uid()` at submit, not by `sops.created_by`. A revision may be
opened and submitted by someone other than the original creator, and `created_by` is pinned to OLD
by the trigger — requiring the original creator to sign would deadlock every revision they did not
personally drive. Each review cycle therefore carries its own authorship signature by that cycle's
submitter.

Seat identity closes the admin bypass on the signing path: an admin who does not hold the seat has
nothing to satisfy. It does **not** close it for `review`/`rejection` unless those also move to seat
identity — hence the table above. `has_department_role` is retained only where manager convenience
is wanted and no signature is produced.

### Escalation authority for `objection_overruled`

The overrule must reference an open objection via `resolves_signature_id`. Let `R` be the RASIC
duty of the seat that raised it (`objection.seat_department_id`):

- `R = responsible` → the signer must be the **Accountable seat's** `signer_id`.
- `R = accountable` → the signer must be a strict **Quality** approver.

A written justification is required. `support` and `consulted` seats cannot raise objections, so no
other case exists.

### Invariant: three distinct humans

The submitter holds no blocking seat (Gate A). Quality's signer is neither a seat signer nor the
author nor the submitter (Gate C). Therefore any release requires **at least three distinct people**
— author, seat signer, Quality approver — regardless of how many departments are seated, and
regardless of one person holding several seats.

## Gates

All enforced in `enforce_sop_transition` (v3). `lifecycle.ts` mirrors them for control enablement
only and must change in lockstep.

**Gate A — `draft → in_review`**
- Owning department set.
- At least one `responsible` seat; exactly one `accountable` seat.
- Every seat with a `signer_id` names a strict member of that seat's department.
- The submitter holds no blocking seat.
- An `authorship` signature by `auth.uid()` exists, bound to the current `(content_hash, review_cycle)`.
- No open objection. Before evaluating this, the trigger auto-closes objections from the current
  cycle whose hash no longer matches, writing an `objection_sustained` row referencing each — so
  all three closure modes leave an explicit record. An `objection_sustained` row is a *system
  record of closure*, not an e-signature: its `signer_id` is the person whose edit closed the
  objection, and it asserts only that the objected-to content no longer exists.
- On success the roster freezes.

**Gate B — `in_review → approved`** — not a button.

`sign_sop`, after inserting a `dept_approval`, takes `select … from sops where id = p_sop for
update`, and if the status is still `in_review` and quorum is met, performs the UPDATE itself. The
lock serializes the concurrent-last-signature race; the second caller re-reads the committed row
and finds the status already moved.

Because a `rejection` now transitions to `draft` inside `sign_sop`, an SOP cannot sit in
`in_review` with an open objection. The trigger still re-checks objection openness on this edge as
defense in depth — the state should be unreachable, and a gate that assumes so is a gate that
breaks quietly when the assumption stops holding.

The trigger independently re-validates on the UPDATE:

```sql
not exists (
  select 1 from public.sop_review_seats st
  where st.sop_id = old.id
    and st.rasic in ('responsible', 'accountable')
    and not exists (
      select 1 from public.sop_signatures g
      where g.sop_id = st.sop_id
        and g.signer_id = st.signer_id
        and g.seat_department_id = st.department_id
        and g.meaning = 'dept_approval'
        and g.signed_content_hash = old.content_hash
        and g.review_cycle = old.review_cycle))
```

**Gate C — `approved → effective`**
- A `quality_approval` signature by `auth.uid()`, bound to the current `(content_hash, review_cycle)`.
- `auth.uid()` is a strict approver in the `is_quality_gate` department.
- `auth.uid()` is not any seat's `signer_id`, not `created_by`, not `submitted_by`.
- `auth.uid()` signed no `objection_overruled` for this SOP and cycle.
- Stamps version, `effective_date`, `next_review_date`; snapshots the revision **and its roster**.
- If `old.major_version is not null`, writes one `sop_change_log` row from `revision_reason`,
  `change_significance`, `requires_retraining`, then clears `revision_reason`. `from_version` is
  `(select version_label from sop_revisions where id = old.effective_revision_id)` — the copy that
  was in force until this moment, not `old.version`, which already carries the bumped label from
  Gate D. `to_version` is the newly stamped version. `revision_id` is the snapshot just taken.

**Gate D — `effective → draft`**
- Strict member of the owning department, or a manager.
- `revision_reason` non-blank. Captured before the pin, as `rejected_reason` already is.
- `review_cycle := old.review_cycle + 1`; `minor_version` bumps.

**Reject — `in_review → draft`**

Rejection and recall are different acts and must not share an edge.

- **Reject** is an objection. `auth.uid()` holds a blocking seat. Like Gate B, it is not a separate
  button: `sign_sop`, after inserting a `rejection` bound to the current `(content_hash,
  review_cycle)` and carrying the reason, takes the row lock and sets the status to `draft` itself.
  A rejection therefore cannot exist without the transition that follows it, and an SOP cannot sit
  in `in_review` holding an open objection.
- **Recall** is the submitter withdrawing their own submission. No signature, no objection, no
  reason. Available to `submitted_by` at any point in `in_review`.

The submitter cannot reject: they hold no seat, so there is no `seat_department_id` to stamp on the
signature, and "the author objects to their own document" is a recall.

The trigger mirrors signer and reason into `sops.rejected_by` / `rejected_reason` for cheap list
rendering. These columns are denormalized views of the signature, never the source of truth.

**Objection openness**

```sql
exists (
  select 1 from public.sop_signatures o
  where o.sop_id = s.id
    and o.meaning = 'rejection'
    and o.signed_content_hash = s.content_hash
    and o.review_cycle = s.review_cycle
    and not exists (
      select 1 from public.sop_signatures r where r.resolves_signature_id = o.id))
```

## Seat reassignment

`reassign_sop_seat(p_sop, p_department, p_new_signer)` — `security definer`:

- Caller is a workspace owner or admin.
- The SOP is in `draft` or `in_review`.
- `p_new_signer` is a strict member of the seat's department.
- **Caller is not `p_new_signer`.** Without this, reassignment is a path to self-approval.
- The seat holds no valid signature for the current `(content_hash, review_cycle)` — a signed seat
  is closed.
- Writes `audit_log` (prior holder, new holder, actor, timestamp).

A `before update` trigger on `sop_review_seats` enforces column-level immutability once
`sops.status <> 'draft'`: only `signer_id` may change. RLS restricts that UPDATE to owner/admin.
Seat membership is re-checked here because seat identity alone would let a signer removed from the
department mid-review still sign.

## Application changes

- `src/domain/sop/lifecycle.ts` — mirror the new gates; add seat and objection context.
- `src/lib/sop/review.ts` — seat CRUD, roster read, objection actions; **remove** the
  `in_review → approved` transition call (D5).
- `src/components/sop/sop-approval-panel.tsx` — roster panel (department, duty, signer, signed or
  pending, timestamp); sign / reject / withdraw / overrule; drop "Approve & sign".
- `src/components/sop/review-queue.tsx` — becomes the viewer's own queue: *awaiting your signature*,
  *your SOPs with open objections*, and *awaiting Quality* for Quality approvers. Backed by a
  `security definer` RPC, because openness and signature validity are server-side predicates.
- New: a roster editor on the SOP's departments tab, editable in `draft` only.

## Error handling

- Trigger exceptions stay human-readable; `transitionSop` surfaces them verbatim, as today.
- Optimistic concurrency keeps `updated_at` + `SopConflictError`.
- `sign_sop` stays idempotent on the widened key.
- Gate B's advance is best-effort inside `sign_sop`: if the status has already moved, it returns
  the signature id without error.

## Testing

Unit (`src/domain/sop/lifecycle.test.ts` exists):
- Gate predicates for every edge, including the submitter-holds-a-seat rejection.
- Quorum predicate: no seats, one unsigned blocking seat, all signed, support-only unsigned.
- Objection openness across hash and cycle changes.

Integration, against a local Supabase — the trigger is the enforcement layer and a UI mirror test
proves nothing about it:
- Quorum incomplete → advance refused; quorum complete → auto-advance.
- Admin who holds no seat attempts `dept_approval`, `review`, `rejection` → all refused.
- Quality approver attempts a department approval → refused (regression on D3).
- Quality signer who also holds a seat → refused.
- Author who is a Quality approver attempts release → refused.
- Resubmit with an open objection → refused; after withdrawal → allowed.
- Submitter attempts `rejection` → refused (they hold no seat); recall → allowed.
- Support or Consulted seat attempts `rejection` → refused.
- Author edits after an objection, resubmits → an `objection_sustained` row exists referencing it.
- Overrule of a Responsible objection by someone other than the Accountable signer → refused.
- Two objections overruled by the same person at the same hash → both resolve (idempotency key).
- Revision that reverts content to a prior version's hash → prior signatures do **not** satisfy
  quorum (regression on cycle binding).
- Concurrent last signatures → exactly one advance.
- First release writes no change log; the next release writes exactly one.
- Raw INSERT with `major_version: 1` → stripped to a clean draft (regression on D2).
- Non-member with org-tool `view` cannot read another department's draft (regression on D1).

## Migrations

1. `sop_rls_definer_fixes` — `department_has_members`; rewrite the three `sops` policies (D1).
2. `sops_hash_and_cycle` — `content_hash`, `review_cycle`, `revision_reason`; hash maintained by trigger.
3. `sop_review_seats` — enum, table, `holds_sop_seat`, `can_read_sop`, RLS, freeze trigger.
4. `sop_signatures_seat_cycle` — new columns, meanings, widened idempotency index; widen
   `sop_signatures` and `sop_revisions` read policies to seat holders.
5. `is_department_member` + `sign_sop` v2 — seat auth, `authorship`, objection meanings, escalation
   authority, auto-advance under `for update`.
6. `enforce_sop_transition` v3 — Gates A–D; INSERT strips `version`/`major_version`/`minor_version`/
   `content_hash`/`review_cycle`/`revision_reason`/`change_significance`/`requires_retraining` (D2).
7. `sop_change_log` + `sop_revisions.roster` — written at release.
8. `reassign_sop_seat` — RPC plus `audit_log` integration.

## Open items

- Objection aging (surfacing a stalled objection on Quality's dashboard) is deliberately deferred.
  Not required by ISO 9001:2015; it is how stalls get noticed before an audit notices them.
- `from_version` derivation assumes minor-only bumps. Revisit if major bumps are ever added.
