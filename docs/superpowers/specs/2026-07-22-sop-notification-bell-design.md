# SOP Notification Bell — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorm complete, pending implementation plan)
**Problem:** SOP work is invisible outside the SOP space. Email (shipped 2026-07-21)
reaches people away from the app; the bell makes the same work visible to people
*inside* the app but in other spaces (dashboard, planner, Planning, Production).

## Decisions (user-confirmed)

1. **Badge semantics: things waiting on ME, now.** The count is the number of
   SOPs currently blocked on the viewer — reviews to return, formal signatures
   to give, releases to approve, sent-backs to rework. It is recomputed from
   live state, so it self-clears the moment the user acts. There is NO
   read-state, no cursor, no "mark as read", and no event feed.
2. **Placement: everywhere, via the shared top bar.** Mounted once inside
   `UserNav` (`src/components/user-nav.tsx`), which renders in every space's
   chrome.
3. **Click: dropdown with grouped items.** Sections mirror the Review queue;
   each row deep-links to its SOP. Footer links to `/sops/review`.

## Rejected alternatives

- **Server endpoint for the count** — new authed route producing output the
  client can already derive; pays off only at user counts far beyond current
  scale. YAGNI.
- **Feed from `sop_notifications` ledger** — wrong semantics (that table
  records what was *emailed*, not what is *actionable*), and reading it would
  relax the deliberately service-role-only RLS posture. Rejected outright.
- **Realtime subscription** — polling on mount/focus/interval is sufficient for
  a badge; a Supabase channel adds lifecycle complexity with no user-visible
  win at this scale. Revisit only if the 60s staleness ever matters.

## Components

### 1. `src/domain/sop/queue-summary.ts` (+ colocated test) — pure

```ts
export interface QueueSummaryItem { sopId: string; sopNumber: string | null; title: string | null }
export interface QueueSummarySection {
  key: "awaitingMe" | "finalApprovals" | "awaitingQuality" | "sentBack";
  label: string;            // "Awaiting my review" | "Signature needed" | "Ready for release" | "Sent back"
  items: QueueSummaryItem[];
}
export interface QueueSummary { total: number; sections: QueueSummarySection[] }
export function summarizeQueue(queue: QueueData): QueueSummary
export function badgeLabel(total: number): string   // "0".."9", then "9+"
```

Rules (all tested):
- Section order is fixed: awaitingMe, finalApprovals, awaitingQuality, sentBack.
- Empty sections are omitted from `sections`; `total` is the sum of item counts
  across the four sections (`allInFlight` is NOT counted — it is informational
  on the queue page, not actionable).
- An SOP appearing in two sections counts once per section (each entry is a
  distinct action); no cross-section dedupe.
- `badgeLabel` caps at `9+`.
- Imports the `QueueData` TYPE from `@/lib/sop/review-queue-data` (type-only
  import keeps the domain module free of runtime lib dependencies).

### 2. `src/components/notification-bell.tsx` + `notification-bell.css` — client

- `"use client"`; reasons: interactivity (dropdown), browser APIs
  (localStorage, focus events), background polling.
- Renders `null` until it has BOTH a session user and a workspace id; renders
  nothing when signed out. The chrome must never break or flash because of
  this component.
- Workspace resolution, in order: `localStorage["pulse:sops:workspace-id"]`
  (the SOP provider's stored choice) → else first group from
  `loadWorkspaceProjectGroups(userId)` (`src/domain/supabase-planner.ts:1895`)
  → else render nothing (user has no workspaces).
- Data: `fetchReviewQueueData(workspaceId, userId)` with the browser client —
  the SAME derivation the Review queue page uses, so badge and queue can never
  disagree — then `summarizeQueue`.
- Refresh: on mount, on `window` focus, and on a 60_000 ms interval; interval
  and listeners cleaned up on unmount. Failures are swallowed and keep the
  last good summary (a fetch error must never blank the chrome or throw).
- Renders: bell icon button; badge when `total > 0`; dropdown on click with
  the grouped sections; row click navigates to `/sops/{sopId}`; footer
  "Open review queue" → `/sops/review`; empty-state text "Nothing waiting on
  you." when opened at zero.

### 3. Mount in `UserNav`

One-line mount in the top-bar cluster in `src/components/user-nav.tsx`, before
the avatar. No other changes to UserNav. Because every space shell renders
UserNav, the bell appears app-wide with a single mount point.

## UI details

- Lucide `Bell` icon, sized/styled to match the existing top-bar icon buttons.
- Squared geometry per the app's design language (4px radii, **no pills**) —
  the badge is a small squared tag, ink background, white text.
- Badge shows `badgeLabel(total)`; hidden entirely at `total === 0`.
- Dropdown: right-aligned panel matching UserNav's dropdown styling and its
  open/close mechanics (hover-intent close timer pattern already in UserNav);
  section headers in small caps; rows show `{sopNumber ?? "SOP"} · {title}`.
- All styles in `notification-bell.css`, imported by the component — never
  `app/globals.css` (CLAUDE.md hard rule).

## Error handling

| Failure | Behavior |
|---|---|
| Signed out / session expired | Render nothing (null) |
| No workspace membership | Render nothing |
| `fetchReviewQueueData` throws | Keep last good summary; retry at next trigger; never surface an error in the chrome |
| localStorage unavailable | Treat as no stored choice; use the membership fallback |

## Testing

- `src/domain/sop/queue-summary.test.ts`: section order; empty-section
  omission; total excludes `allInFlight`; per-section counting without
  cross-section dedupe; `badgeLabel` at 0, 1, 9, 10, 47; label strings exact.
- Component verified live in the browser (CLAUDE.md rule 6): badge count
  matches `/sops/review` contents; dropdown rows navigate; badge hidden at
  zero; bell visible from a non-SOP space (dashboard/planner).
- Full gate: typecheck, lint, all tests, build.

## YAGNI cuts

- No read-state, no cursor, no per-item dismiss, no "mark all read".
- No event feed, no realtime channel, no server endpoint.
- No per-workspace switcher inside the dropdown (it reflects the active/stored
  SOP workspace; switching workspaces is the SOP space's job).
- No animation/sound/toast; no mobile-specific layout beyond the dropdown
  fitting small screens.
