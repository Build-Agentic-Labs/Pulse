# Author-Nominated Reviewers — Design

**Date:** 2026-09-10
**Status:** Approved by owner 2026-09-10 (open items decided below)
**Related:** `2026-07-09-sop-rasic-approval-design.md` (seats, gates, three-humans invariant),
`docs/runbooks/notifications.md` (stall ladder), memory `pulse-user-access-layers`.

## Problem

An SOP author can only pick an approver who is *already* a member of the seat's department
with a `reviewer` or `approver` role. When the right person is not in the department (or not
in Pulse at all) the author is stuck: the dropdown reads "No reviewers or approvers assigned",
and only a workspace owner/admin can invite people or add them to a department. The author
knows who their reviewer is; the admin does not. Every new reviewer therefore becomes a
round-trip through the admin before the SOP can move.

A second, related delay: even once an invite is sent, nothing in the SOP can reference the
invitee until they accept. The author waits for the accept before sending for review.

## Requirements

1. An author can nominate a reviewer **for their own department only**, from inside the SOP
   roster editor, without admin involvement.
2. Nomination grants the **`reviewer`** department role and nothing higher. It never touches
   the Quality-gate department, never creates approvers, never grants admin.
3. If the nominee is already in the workspace, they are added to the department immediately
   with no email. If not, a workspace invite goes out and they land in the department as a
   reviewer when they accept.
4. The author can seat the nominee and **send the SOP for review before the nominee accepts**.
   When the nominee joins, the review is already waiting in their queue.
5. Owners/admins see who nominated whom (in-app notification + the existing invite audit).
6. Stall handling: while the seat holder has not joined, nudges go to the author ("your
   reviewer hasn't joined — resend the invite or ask an admin to reassign"), not to an inbox
   that cannot act. The existing escalation ladder to managers still applies.
7. Existing invite defenses stay intact: approved-domain restriction, rate limiting,
   fragment-based invite links, 30-day grant expiry.

## Non-goals

- Authors inviting into any department other than their own.
- Authors creating approvers, Quality approvers, admins, or changing anyone's access level.
- Bulk invites, custom invite copy per SOP, or a "reviews waiting" welcome digest.
- Any change to `enforce_sop_transition`, `sign_sop`, or `reassign_sop_seat`. The design is
  chosen specifically so those live-patched functions are **not touched**.
- Automatic deletion of never-accepted invites (see Expiry).

## Approaches considered

**A. Provisional department membership at nomination time (chosen).** Supabase creates the
`auth.users` row the moment an invite is generated, so the nominee has a stable `user_id`
before accepting. Both `sop_review_seats.signer_id` and `department_members.user_id`
reference that id. Minting the `department_members` row at nomination (flagged as pending)
makes the nominee appear in the roster dropdown and satisfies the transition guard's
"every seat's reviewer must belong to that seat's department" check with **no change to the
guard**. A pending member cannot sign in until they accept, so the early row grants no
usable access.

**B. Relax the transition guard to accept a pending grant as membership.** Requires an
in-place patch of `enforce_sop_transition` (the guarded-replace pattern) and teaches the
guard to parse `workspace_access_grants.department_access` JSON. More risk, more coupling,
for the same outcome. Rejected.

**C. Keep membership at acceptance; block send-for-review until joined.** Solves the
invite gap but not the waiting gap (requirement 4). Rejected.

## Architecture

```
Roster editor ("Invite a reviewer")
        │  POST /api/sops/reviewers/nominate  {sopId, departmentId, email, positionTitle}
        ▼
Route (cookie/bearer auth, per-user rate limit)
  1. rpc nominate_department_reviewer(dept, email, title)      ← authorization + grant/membership
  2. if mode = 'invite' and no auth user yet:
        admin.generateLink(type: invite) → auth.users row + email (existing helper)
        rpc mint_pending_department_reviewer(dept, user_id)    ← provisional row, verified against the grant
  3. record transactional-email ledger + manager notification (existing helpers)
        │
        ▼
Roster dropdown lists the nominee (tag: "Invited · not yet joined") → author seats them → Send for review passes
        │
        ▼ nominee accepts (existing /invite flow) → redeem_workspace_access_grants()
          deletes + reinserts department_members from the grant → pending marker gone, seat untouched
        │
        ▼ first sign-in: "Awaiting me" queue already contains the seat (computed from seats, no new machinery)
```

The one-sentence RLS statement: **a department member may create a reviewer-level
membership or invite for their own department only; the Quality-gate department and every
other role remain owner/admin-only.**

## Data model

### `department_members.pending_invite_at timestamptz null`

- Set when a membership is minted ahead of acceptance. Null for every ordinary member.
- Cleared by the existing redeem path without new code: `redeem_workspace_access_grants()`
  already deletes the user's department rows for the workspace and reinserts them from the
  grant, and the reinsert takes the column default (null).
- Expiry is derived, not stored: `pending_invite_at + 30 days` (the same
  `GRANT_EXPIRY_DAYS` the grant uses). "Resend" simply re-runs the nomination; both
  functions are idempotent and refresh the grant's `expires_at` and this column together, so
  the two stay aligned without a cross-table read. Authors cannot read
  `workspace_access_grants` (manager-only RLS), which is why the marker lives here.

### `workspace_access_grants` — fixed "department reviewer" package

A nomination writes a grant with a fixed, non-negotiable entitlement shape:

| Field | Value |
|---|---|
| `role` (workspace) | `editor` (the `member` organization role) |
| `quality_access` | `edit` — mirrors the existing Quality Reviewer package (see Open items) |
| `planning_access` | `false` |
| `project_access` | `[]` |
| `department_access` | `[{ department_id, role: "reviewer", position_title }]` |
| `granted_by` | the nominating author |
| `expires_at` | now + 30 days |

The route never accepts these fields from the client. If a grant for the email already
exists, the nomination **merges** the department entry into `department_access` and leaves
every other field as the admin set it; it never downgrades.

### No other schema changes

Seats, signatures, SOP status, and the transition/sign/reassign functions are unchanged.

## Authorization (in the database)

### `nominate_department_reviewer(p_department_id text, p_email text, p_position_title text)`

`security definer`, returns `{ mode: 'added' | 'lifted' | 'already_eligible' | 'invite',
user_id uuid | null }`. Checks, in order, each raising a clear exception:

1. `auth.uid()` present; workspace resolved from the department.
2. Caller is a member of `p_department_id` (`is_department_member`). Owners/admins also pass
   (they already have the Members UI, but the roster shortcut should not refuse them).
3. `departments.is_quality_gate` is false for the target department.
4. Email normalized (lower/trim) and its domain is on the workspace's approved list — checked
   here so the author gets a clean message instead of an admin-API failure later.
5. `p_position_title` non-empty (the existing invite contract requires it).
6. No `workspace_revocations` tombstone for (workspace, email). The admin invite route lifts
   revocations deliberately; an author never does — the nomination is refused with "ask an
   admin".
7. Resolve `auth.users` by email. Then:
   - **User is a workspace member and a department member with `author`** → update to
     `reviewer` (`lifted`).
   - **… with `reviewer` or `approver`** → no-op (`already_eligible`).
   - **User is a workspace member, not in the department** → insert membership as `reviewer`
     with `granted_by = auth.uid()` (`added`).
   - **User exists but is not a workspace member** (unconfirmed from a prior invite, or a
     confirmed account elsewhere) → upsert the fixed grant, insert the provisional membership
     with `pending_invite_at = now()` (`invite`, `user_id` set).
   - **No auth user** → upsert the fixed grant only (`invite`, `user_id` null). The route
     creates the user and calls the second function.

The `protect_manager_invitation` trigger on grants only guards owner/admin-role grants;
member-role grants written by this function pass it unchanged.

### `mint_pending_department_reviewer(p_department_id text, p_user_id uuid)`

`security definer`. Inserts the provisional membership **only if** an unexpired, unredeemed
grant exists for (workspace, the user's email) whose `department_access` names
`p_department_id` as `reviewer` and whose `granted_by = auth.uid()`. Idempotent (upsert on
the primary key, refreshing `pending_invite_at`). This keeps the enforcement in the database:
the route holds the service-role key for the email send only, exactly as the admin invite
route does today.

### Cascade on grant removal

`after delete on workspace_access_grants`: resolve the grant's email to an `auth.users` id
and delete that user's `department_members` rows in the grant's workspace where
`pending_invite_at is not null`. Seats are **not** touched (see Expiry).

### Existing gates, unchanged and still correct

- `enforce_sop_transition` draft → in_review: "every seat's reviewer must belong to that
  seat's department" — satisfied by the provisional row.
- `sign_sop`: only the designated reviewer for the seat can sign — a pending user cannot sign
  in, so cannot sign.
- `reassign_sop_seat`: "the new reviewer must be a member of that seat's department" — a
  provisional member qualifies, which is desirable (an admin may seat them too).
- Three-humans invariant: unaffected; the nominee is a distinct user id.
- `holds_sop_seat` (which `can_read_sop` and `sign_sop` lean on) already joins
  `workspace_members`. So even a nominee who *can* sign in (a confirmed account that is not
  yet a member of this workspace) cannot read or sign the SOP from the provisional row alone.
  `redeem_workspace_access_grants()` runs during workspace bootstrap on sign-in, so that
  window closes the first time they sign in: they become a member and the marker clears.

## Application changes

### Route `app/api/sops/reviewers/nominate/route.ts` (new)

- `requireApiUser` (bearer-first, cookie fallback), `createApiRateLimiter` per user.
- Body: `{ sopId, departmentId, email, positionTitle }`. `sopId` is used only for the audit
  detail and the manager notification ("from SOP …"); authorization is department-based.
- Calls the RPC; on `invite` with `user_id = null`, generates the invite link with the
  existing helper (fragment link, Supabase mail fallback), then calls `mint_pending…`. On
  `invite` with `user_id` set, generates the link for the existing unconfirmed user (the
  existing helper already handles this case).
- Records the transactional-email ledger row and a manager notification (below).
- Response: `{ mode, userId, emailSent, seated }`. If the mint step fails after the email
  went out, respond `200` with `emailSent: true, seated: false` and an `error` string so the
  UI can offer "Retry" — the nomination is idempotent end to end, so a retry is safe.

### Domain `src/domain/workspace/reviewer-nomination.ts` (new, pure, tested)

- `buildReviewerGrant(existingGrant | null, departmentId, positionTitle)` — the fixed package
  and the merge-never-downgrade rule.
- `nominationOutcomeMessage(mode)` — copy for the four modes.
- `pendingInviteState(pendingInviteAt, now)` → `"none" | "pending" | "expired"`.

### Roster editor `src/components/sop/sop-roster-editor.tsx`

- Members list gains `pendingInviteAt` (from `department_members`), and `RosterMember` gains
  the derived state.
- Dropdown options render pending members with a tag: **"Invited · not yet joined"**, or
  **"Invite expired · resend"**. Both remain selectable; expired is selectable so a draft can
  keep its seat while the author resends.
- New "Invite a reviewer" action beside the approver select, shown only when the caller is a
  member of that seat's department and the department is not the Quality gate. Opens an
  inline form: email, position title (standard titles for the department + custom). Submits
  to the route; on success reloads members for that department and preselects the nominee.
- On other departments' seats the action is absent; the existing "ask an admin" state stands.
- Extend the existing ineligible-signer handling so a seat whose signer is **absent** from the
  member list (a removed pending invite) still renders, labelled "No longer in department",
  rather than showing an empty select.

### Members settings `src/components/workspace-members-settings.tsx`

Pending invites already list here. Add the "nominated by <author>" line from the grant's
`granted_by` so admins see the provenance without a new screen. Removing a pending invite
cascades to the provisional membership via the trigger.

## Notifications

`SeatSnapshot` gains `signerPending: boolean`, loaded from `pending_invite_at is not null`
for the seat's (department, signer). Rules:

- **First-touch** `review_requested` / `final_approval_requested`: recipients with
  `signerPending` are excluded. Nothing to act on until they join; the queue shows the item
  on first sign-in.
- **Stall nudges** (`resolveReminders`): a pending blocking seat produces a candidate for the
  **SOP author** with new kind `reviewer_not_joined`, anchored on `reviewSentAt`, on the same
  reminder ladder (`REMINDER_AFTER_DAYS`, `MAX_REMINDERS`) and the same escalation to managers.
  Template: who has not joined, which department, a Resend action, and "or ask an admin to
  reassign the seat".
- **After the nominee joins**, `signerPending` flips to false at the next drain and the
  standard signer nudge fires with no special case — their first touch is effectively "you
  have a review waiting", anchored on the original send time.
- **Manager visibility**: new membership kind `reviewer_nominated` (in-app bell to
  owners/admins): "<author> invited <email> as a reviewer for <department> (from SOP …)".
  In-app only, no email — it is informational.

## Expiry and cleanup

- **Nothing is deleted automatically.** An expired nomination shows as "Invite expired" in
  the roster and in Members; the author resends (refreshes grant + marker) or an admin removes
  the pending invite (cascade deletes the provisional row).
- **Seats are never cleared by cleanup.** If a provisional member is removed while seated,
  the roster shows the seat with an ineligible signer (existing handling) and the standard
  path applies: the author picks another reviewer in draft, or an admin reassigns in review.
  The `reviewer_not_joined` nudges keep the author and managers informed meanwhile.

## Error handling

Every RPC exception maps to a user-facing message in the roster form, never a toast that
loses the typed email:

| Condition | Message |
|---|---|
| Not a member of the department | "You can only invite reviewers into your own department." |
| Quality-gate department | "Quality approvers are managed by an admin." |
| Domain not approved | "That email domain isn't approved for this organization." |
| Revoked address | "That address was removed by an admin — ask an admin to re-invite." |
| Already reviewer/approver | "They can already be selected as an approver." (and preselect) |
| Rate limited | "Too many invites right now — try again in a few minutes." |
| Email send failed after grant | "Added, but the email didn't send — use Resend." |

Server logs keep the full RPC error; the client never sees stack detail.

## Testing

**pgTAP (`supabase/tests/`)** — the gate that matters, since the enforcement is in the DB:
- Author nominates into own department: `added` / `lifted` / `already_eligible` / `invite`.
- Author nominating into another department raises; into the Quality department raises;
  a revoked email raises and the tombstone is left in place.
- `lifted` never touches `approver`; nomination never creates `approver`.
- `mint_pending…` refuses without a matching unexpired grant by the caller; idempotent with one.
- Grant delete cascades the provisional row; seat row unchanged.
- Redeem clears `pending_invite_at` and keeps the seat's `signer_id`.
- `draft → in_review` succeeds with a provisional signer (guard untouched, still passes).
- `protect_manager_invitation` still blocks an author from producing an admin-role grant.

**Vitest**
- `reviewer-nomination.ts`: fixed package, merge-never-downgrade, expiry derivation.
- `notifications.ts`: pending signer excluded from first touch; `reviewer_not_joined`
  candidate for the author; normal nudge resumes after join.
- Roster option builder: pending/expired tags, selectability, action visibility per department.
- Route: input validation, mode handling, idempotent retry after a failed mint.

**Live drive (required before merge, per CLAUDE.md)**
1. As an author, nominate a real approved-domain address (not plus-addressed — Exchange
   bounces those). Confirm the grant, the provisional row, and the invite email in Resend.
2. Seat the nominee, send for review, confirm the transition succeeds and the author receives
   no nudge before day 3.
3. Accept the invite in a private window; confirm the queue shows the review immediately and
   `pending_invite_at` is null.
4. Remove a different pending nomination from Members; confirm the provisional row is gone
   and the seat still lists the (now ineligible) signer.

## Migrations

1. `department_members.pending_invite_at` + index on `(department_id) where pending_invite_at is not null`.
2. `nominate_department_reviewer`, `mint_pending_department_reviewer` (`security definer`,
   `search_path` pinned, execute granted to `authenticated` only).
3. `after delete` cascade trigger on `workspace_access_grants`.
4. `npm run gen:types`; commit `src/lib/database.types.ts`.

No migration reads or rewrites `enforce_sop_transition` or `sign_sop`.

## Decisions (owner, 2026-09-10)

1. **Quality access level for nominated reviewers: `edit`.** Mirrors the existing Quality
   Reviewer package so a nominee can open and annotate. Re-evaluate to `view` only if the
   live drive shows `view` is sufficient for signing and annotating.
2. **Nudge timing for "not joined": the standard 3-day ladder.** Same `REMINDER_AFTER_DAYS`
   and `MAX_REMINDERS` as other stalls; a shorter first nudge stays a one-constant change if
   invites tend to sit.
3. **Lifting `author` → `reviewer`: allowed for the nominating author.** The nominator is a
   department peer, the change is audited via `granted_by`, and the role gained is the lowest
   signing role. Approver remains admin-only.
