# C1 — scoped phone recovery drafts: design for approval (planning only)

Prepared 2026-10-04 on `codex/mobile-capture-session` after B2. Nothing here is implemented. No UI change,
dependency, migration, merge or push is proposed by this document; where a user decision or a visible
control is required, it is marked **APPROVAL**.

Problem (demonstrated, `docs/deferred-work.md` §8e): one IndexedDB record under
`mobile-new-step-draft-v1` serves every project and every signed-in user of a browser. A draft left in
project X is overwritten by the next draft in project Y; a draft whose task is not in the open project is
neither restored nor cleared; nothing records who wrote it.

## 1. Decision table

| # | Question | Options considered | Decision | Why |
|---|---|---|---|---|
| D1 | Who owns a legacy (unowned) draft? | (a) attribute to the current user if its task is in the open project; (b) never attribute; preserve and show only as an unowned draft | **(b)** | Task membership proves nothing about authorship. Attribution could submit another user's text under the current user's session. |
| D2 | What happens to a legacy draft on restore? | (a) auto-restore and auto-save as today; (b) keep the record, show it as "an unsaved draft from before sign-in scoping" with Restore / Discard; (c) ignore forever | **(b), APPROVAL** — needs a small UI element | (a) is D1(a). (c) silently loses work. (b) keeps the original record byte-for-byte until the user acts. |
| D3 | Key granularity | user+project; user+project+task | **user+project+task** | Project-level keys collide between tasks (the existing park/resume flow already holds one draft per task). |
| D4 | Several pending new steps for the same task | allow N per task; one per task | **One per task, keyed by `stepId` inside the record; a newer draft for the same task with a different `stepId` replaces the older one only after that older one is acknowledged or explicitly discarded; otherwise the older is kept and the newer is not written** — the UI already permits only one open New Step panel per task | Matches the interface; avoids an unbounded store. |
| D5 | Acknowledgment | delete on any successful save; conditional delete on exact revision | **Conditional, atomic, exact-match delete** inside one readwrite transaction | An older save finishing late must never clear a newer edit. |
| D6 | Identity source | cookie session (`getUserFromSession`), server `getUser`, none | **Session user id from `getUserFromSession` (no network), treated as a scoping label, not as proof** | It is the only identity the client has without a round trip; the database still authorizes every write by RLS. |
| D7 | Behaviour without identity | shared anonymous key; memory only | **Memory only; no IndexedDB write; existing "could not store the local recovery draft" message** | Never fall back to a shared key. |
| D8 | IndexedDB schema | bump DB version; same store, new keys | **Same database `buildlogic-mobile-drafts`, store `drafts`, version 1, keyPath `key`** | Old clients keep working; no upgrade transaction; legacy records untouched. |
| D9 | Legacy record lifecycle | migrate in place; leave alone | **Leave alone. Never rewritten by new code. Deleted only by the user choosing Discard, or after the user chose Restore and that restored draft was acknowledged with the legacy record still byte-equal to what was restored** | Another old client may still be writing that key. |

## 2. Record and key format

```
key:        "mobile-new-step-draft-v2:" + userId + ":" + projectId + ":" + taskId
record: {
  key, schemaVersion: 2,
  userId, projectId, taskId,           // scope, repeated inside the record so the key is not the only source
  draftId: string,                      // identity of this draft: the stepId the panel is editing
  revision: number,                     // monotonic per draftId, incremented on every local change
  stepId: string | null, name?, instruction, durationText, tools, photos, checks, checkValues,  // unchanged payload
  updatedAt: ISO string
}
```
Legacy records (`mobile-new-step-draft-v1`, no `schemaVersion`) are read-only to the new code. Unknown
`schemaVersion` values are left in place and ignored.

`draftId` = the panel's `stepId` (already unique per task: `step-<taskId>-<time>-<random>`).
`revision` lives in component state next to the draft (`newStepRevisionRef`), reset when a new draft id
is opened, incremented in `scheduleNewStepAutosave` before the record is written.

## 3. Sequences

**Save (each change):** `scheduleNewStepAutosave` increments `revision`, writes the scoped record
(`put`, whole record) — same timing as today, immediately and asynchronously — then arms the 450 ms timer
as today. Without a `userId` (D7) the write is skipped and the existing message shown.

**Database save completes (persist success):** the component passes `{draftId, revision}` of the snapshot
it sent. The store runs **one readwrite transaction**: `get(key)`; if the stored record has the same
`draftId` **and** `revision <= acknowledgedRevision`, `delete(key)`; otherwise leave it. Both operations
are in the same transaction, so a concurrent writer in another tab either sees the deletion or the
newer record; there is no read-then-delete window. Today's extra guard (no timer armed, no other local
write in flight) stays as a component-side precondition.

**Restore (mount / project load):**
1. Resolve `userId`; if none, skip restore entirely.
2. For the open project, list scoped records whose key starts with the `userId:projectId` prefix (an
   `IDBKeyRange.bound` over the keyPath; no index needed).
3. Keep only records whose `taskId` exists in the loaded state and whose content is non-empty
   (`hasDraftStepContent`), as today; empty ones are deleted (same as today).
4. **Selection:** the interface shows one New Step panel for the selected task. The restore therefore
   re-opens the record for the task the capture session says is selected (`pulse:mobile-capture-session`
   `selectedTaskId`), or if none, the most recently `updatedAt` record, and selects that task — this is
   what today's code does with the single record. Other tasks' records stay stored and are re-opened
   when the user selects that task and opens New Step (`openNewStepForm` checks the store for that task
   before creating a fresh id). The park/resume flow for timed drafts is unchanged; parked draft fields
   continue to live in the capture session, and the store is the durable copy.
5. Re-save after 250 ms as today, with the record's `draftId`/`revision` carried into the acknowledgment.
6. Legacy record present: never restored automatically (D1/D2). **APPROVAL:** a one-line notice with
   Restore and Discard inside the existing New Step area, shown only when a legacy record exists whose
   `taskId` is in the open project. Restore copies its payload into a new scoped record for the current
   user (the legacy record is left in place until acknowledgment, D9) and opens the panel; Discard deletes
   the legacy record. Until approved, legacy records are simply left alone and never auto-submitted —
   which is already safer than today.

**Task switch:** nothing changes in the component flow; because keys include `taskId`, the record of the
task being left is not overwritten by the next task's draft.

**Concurrent tabs (same user, same task):** both tabs write the same key; last write wins on the record,
as with today's single key but now confined to one task. A stale tab's late save clears nothing newer
(D5). A visible "this draft was changed in another tab" is **not** proposed.

**Late callbacks after project/account change:** every save and acknowledgment carries the
`{userId, projectId, taskId, draftId, revision}` captured when it was scheduled; the store acts only on
that exact key, never on "the current" project or user. A callback arriving after logout therefore
touches only the signed-out user's own key.

**Legacy cleanup after another client overwrote the legacy key:** the new code compares the legacy
record to the payload it restored (D9) before deleting it; if it differs, it is left for that other
client.

## 4. Identity lifecycle (D6/D7)

- Source: `getUserFromSession(client)` → `session.user.id`, read once per mount and on auth state change
  (`auth-project-gate.tsx:368` already subscribes; the portal would subscribe the same way). The id is
  **not** cryptographically verified on the client; it scopes local drafts only. Authorization of the
  actual database write remains RLS on the server.
- Unavailable (no session, expired, still loading): no scoped read or write; drafts are memory-only and
  the existing storage message is shown (D7). No anonymous or shared key, ever.
- Logout: in-memory draft state is dropped with the component; scoped records stay in IndexedDB under
  the old user's key and are invisible to anyone who signs in with another id. They are not deleted.
- Account switch in the same tab: the auth listener changes `userId`; pending timers are cleared; records
  of the previous user are not read; a late acknowledgment uses its captured key.
- **Limits, stated plainly:** this is application-level isolation. Anyone with access to the browser
  profile (DevTools, another extension, a shared unlocked device) can read every record regardless of
  key. The design does not protect against that and does not claim to.

## 5. Test matrix

| Area | Case | Layer |
|---|---|---|
| Cross-project | user U, project X draft; open project Y, type → X's record untouched, Y's own record written; return to X → X restored | double + real browser |
| Cross-user | U1 draft; sign in as U2 in the same profile → U2 sees nothing, U1's record untouched; U1 returns → restored | real browser (two sessions) + double |
| Cross-task | drafts on tasks A and B; switch A→B→A → both records present, A restored on return | double + real browser |
| Same task, two tabs | tab 1 revision 3, tab 2 revision 5; tab 1's save acknowledges revision 3 → record (rev 5) stays; tab 2's acknowledgment of 5 deletes it | double (atomic transaction semantics) + real browser with two pages |
| Stale acknowledgment | save of revision 2 completes after revision 4 was written → record kept; later save of 4 clears | double |
| Late callback after project change | acknowledgment captured for X arrives while Y is open → only X's key affected | double |
| No identity | no session → no write, message shown, save still succeeds | double |
| Logout / switch | records of U1 invisible to U2; U1's late ack does not touch U2 | double |
| Legacy preservation | v1 record present: never auto-restored, never rewritten; if Restore approved: copied, legacy kept until exact-match ack; Discard deletes; legacy changed by another client → not deleted | double + real browser |
| Malformed records | unknown `schemaVersion`, missing `revision`, non-string key parts, record for a task not in project → ignored and left in place | double |
| Storage failure | open/transaction/request errors on write, read and ack → surfaced as today (message / ignored), never throws past the component | double |
| Durability bound | real browser: type, read record, reload **without** waiting for a save outcome; repeat with the save blocked; document which keystroke survived | real browser (new, see §6) |

## 6. Evidence wording (corrected)

The current real-browser spec waits for the blocked save to fail before reading the record, and reads it
again after reload. It establishes that the record is readable once that write completed and that reload
recovery works; it does **not** establish that a change is durable at the moment of typing. Starting an
asynchronous IndexedDB write immediately does not guarantee it completes before a page teardown. The
earlier "fixed 450 ms local-recovery loss window" claim is withdrawn; the loss window is "until the
asynchronous put commits", whose length this test does not measure. `docs/deferred-work.md` §8b is
updated to say so.

## 7. Estimated scope

| File | Change | Lines (est.) |
|---|---|---|
| `src/components/mobile-photo-portal/recovery-draft-store.ts` | scoped key builder, record v2 type, `listRecoveryDrafts(userId, projectId)`, `acknowledgeRecoveryDraft(key, draftId, revision)` (atomic), legacy read kept | +80 / −0 |
| `src/components/mobile-photo-portal.tsx` | user id from session + auth listener; revision ref; pass scope/draftId/revision into save/ack; restore selection per §3; legacy notice only if approved | +60 / −15 |
| `src/components/mobile-photo-portal/recovery-draft-store.test.ts` | matrix rows: keys, list, atomic ack, stale ack, legacy, malformed, failures | +150 |
| `src/components/mobile-photo-portal.recovery-draft.test.tsx` | cross-project, cross-task, no identity, logout/switch, late callback | +120 |
| `src/test-support/indexeddb-double.ts` | key-range listing, transaction-scoped get+delete | +40 |
| `e2e/mobile-recovery-draft.spec.ts` (+ a second spec) | cross-user, two tabs, durability bound | +140 |
| docs | ledger, deferred-work §8e closure, this document's status | +30 |

No dependency, no migration, no production-data change. One **APPROVAL** item: the legacy-draft
Restore/Discard notice (D2). Without it, C1 still ships the scoping, the atomic acknowledgment and the
preservation rules; legacy records are then left untouched and unrecovered until that UI is approved.
