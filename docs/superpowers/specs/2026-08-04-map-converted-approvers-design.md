# Mapping converted approvers onto real seats

**Date:** 2026-08-04
**Status:** Implemented on `feat/map-converted-approvers` (pending live verification)
**Area:** `src/components/sop/converted-approvals-notice.tsx`,
`src/components/sop/sop-roster-editor.tsx`, `src/components/sop/sop-editor.tsx`

## Problem

Converting a legacy document transcribes its approval table into
`sop.approvals`, then tries to map each row to a Pulse department and create an
unstaffed review seat for it (`sop-list.tsx:421`). When the mapping succeeds the
author gets a ready roster. When it fails they get a report saying "No match"
and an **empty roster**, with no way to act on the row — the document told us who
approved it, and the app makes them rebuild that by hand.

Measured on production (project `neaadefipcpxxcqszpud`, all 9 converted SOPs):

| Position title in the legacy document | Mapping result |
|---|---|
| `Process Engineering Manager`, `Production Manager` | resolved → 3 seats |
| `Quality Manager`, `Department Manager`, `Process Owner`, `IC Manager` | **No match** |
| `______________________________`, `<UNKNOWN>` | **No match** |

**Zero** converted SOPs carry a `departmentCode` hint from the extractor, so
`mapApprovalsToDepartments` falls back to matching the position title against
department names — which only works when the title happens to contain one.
Result: **6 of 9 converted SOPs have zero seats**, and 8 of 9 render a notice
listing dead ends.

### What is already right, and stays

- The **roster is fully editable** — add seat, change a seat's department,
  assign/change the reviewer, delete a seat
  (`sop-roster-editor.tsx:261-291`). This design adds an on-ramp to it, it does
  not replace it.
- Seats are created **unstaffed on purpose**. From `sop-list.tsx:415`: *"the old
  document names a person who may not be a Pulse user, and guessing the wrong
  approver is worse than leaving the seat for the author to fill."*
- The notice **never shows the transcribed approver name**. From
  `converted-approvals-notice.tsx:60`: *"It is transcribed text with no account
  behind it, and printing it beside real approver pickers invites the reader to
  treat it as someone in the system."* This design does not revisit that.

## Non-goals

- Editing the legacy approver **names** in `sop.approvals`. That array is the
  historical transcription of the source document; it no longer drives approval
  or printing.
- Pre-selecting a reviewer from the legacy name or email. Deliberately excluded —
  see the unstaffed-on-purpose rule above.
- Any change to the Quality release gate, which is not a seat by design.
- Bulk mapping. Real documents carry 1–4 approval rows.

## Approach

Three were weighed:

**A. Inline department picker per unresolved row** — *chosen.* The decision sits
beside its evidence (the document's role and position title), reuses the
existing seat-write path, and adds no new screen.

**B. "Add as seat" button that prefills the roster's add-row** — fewer controls,
but a two-step dance with a loose link between the row and the outcome.

**C. Bulk mapping modal** — worth building for 20 rows; these documents have 1–4.

## Design

### The choice must persist onto the approval row

`mapApprovalsToDepartments` resolves a row by `departmentCode` **first**,
position title second (`approval-mapping.ts:68-69`), and the notice derives
every row's status from that function. So creating a seat alone is **not
enough**: the row's outcome would stay `unmapped` and it would keep reading
**"No match"** even with its seat sitting right there. A picker that leaves the
row looking unfixed is worse than no picker.

Choosing a department therefore does two things, in this order:

1. **Write the chosen department's code onto that approval row**
   (`approval.departmentCode`) — supplying the hint the extractor could not.
   `findByCodeOrName` is tried first, so it wins over the failed position match,
   permanently.
2. **Upsert the unstaffed seat** — `{ sopId, departmentId, rasic: "responsible",
   signerId: null }`, identical to what conversion itself creates.

The row's status then flips to **"Seat added"** with no new state to track: the
notice keeps deriving from current seats, exactly as its docstring promises.

**Order matters for failure.** If step 2 fails after step 1, the row reads
"Seat removed" — accurate, and it still shows the picker, so a retry heals it.
The reverse order would leave a seat beneath a row still claiming "No match".

### Ownership

The notice stays presentational. Each component gains one callback for work it
already does:

| Component | New prop | Does |
|---|---|---|
| `ConvertedApprovalsNotice` | `onSeatDepartment?: (approvalIndex: number, departmentId: string) => Promise<void>` | renders the picker when present; renders exactly as today when absent |
| `SopRosterEditor` | `onMapApproval?: (approvalIndex: number, departmentCode: string) => Promise<void>` | writes the seat via its existing `upsertSeat`; delegates the document write upward |
| `SopEditor` | — (implements `onMapApproval`) | writes `departmentCode` into `sop.approvals[i]` via its existing `update()` |

`approvalIndex` identifies the row because approval rows have no id and two rows
can share a role and position (`Robbie Miller ×3` on Control Plan).

### Which rows get a picker

| Row status | Picker | Why |
|---|---|---|
| `no-match` | yes | the case this exists for |
| `seat-removed` | yes | mapped but unseated — re-add, and the retry path above |
| `seated` | no | already done |
| `quality-gate` | no | Quality signs the release; the transition guard refuses to release an SOP whose Quality approver holds a seat |

Options exclude the Quality-gate department and any department already seated.
The picker appears only when `onSeatDepartment` is supplied — i.e. persisted,
draft, and edit permission. Read-only viewers and non-draft SOPs see today's
table unchanged.

### Bug fixed alongside

`sop-editor.tsx:2074` shows *"Save the draft to configure department routing"*
whenever the read-only branch has no seats — including on drafts that are
already saved, which is most of them. It is the empty-seats fallback wearing an
unsaved-SOP message. Split it:

- `!hasPersistedSop` → "Save the draft to configure department routing."
- otherwise → "No department routing configured."

## Error handling

- Seat write fails → the row falls back to "Seat removed", keeps its picker, and
  the roster editor surfaces the error the same way its other seat writes do. No
  silent loss: the author sees an unseated row.
- Document write fails → nothing is written, the row stays "No match", the
  picker remains. Retry is safe (`upsertSeat` is an upsert; the document write
  is idempotent per row).
- A department deleted between render and choice → the seat write fails as
  above; the picker re-renders from current departments.

## Testing

- `converted-approvals-notice.test.tsx` (extends ~10 existing cases): picker
  present on `no-match` and `seat-removed`; absent on `seated` and
  `quality-gate`; absent entirely when no callback is supplied; options exclude
  the Quality-gate department and already-seated departments; choosing calls
  back with the right `approvalIndex` and `departmentId`.
- `approval-mapping.test.ts`: a row that fails position matching resolves to the
  chosen department once `departmentCode` is set — the property the whole design
  rests on.
- Component test that choosing fires the document write before the seat write.
- Live (CLAUDE.md): convert-flow SOPs in the browser as an **edit-capable**
  account — map a "No match" row, confirm it becomes "Seat added", confirm the
  seat appears unstaffed in the roster, confirm it survives reload.

## Verification note

The read-only branch is what an account without org-tools `edit` sees; of the
five accounts in production only three carry `edit`. Live verification of this
feature requires one of those, and cannot be done from a `none` account.

## Amendments — 2026-08-04, final whole-branch review

Where this section disagrees with the text above, this section governs. Each
item was **reproduced** by the reviewer, not theorised.

1. **"A retry heals it" was false, and is now true.** The design claimed a
   failed seat write left a row the author could simply re-map. It could not:
   the picker excluded already-seated departments, so once the seat existed the
   department the row needed was filtered out of its own options. The picker now
   offers seated departments too, and `seatConvertedApproval` **skips
   `upsertSeat` when that department is already seated**, performing only the
   document write — because re-upserting with `signerId: null` would wipe a
   reviewer already assigned to that seat. That skip is the load-bearing half.
2. **Duplicate rows can both be mapped.** The same exclusion made a second
   legacy row naming an already-seated department a permanent "No match" — the
   exact dead end this feature exists to remove, on the duplicate rows the spec
   itself calls normal (`Robbie Miller ×3`). Fixed by the same change.
3. **The in-flight row must not claim a deletion.** Between the document write
   and the seat refetch, the row resolved by `departmentCode` but was not yet
   seated, so it rendered "Seat removed — the seat was created and then deleted"
   plus a note telling the author to add the department manually — on the happy
   path, every time, for ~250-700ms. The `pending` row now renders its own
   in-flight label and is excluded from that note.
4. **The picker respects the roster's busy lock.** `guarded()` returns silently
   while another write is in flight; the pickers were disabled only by their own
   pending key, so a second click vanished with no error and no visual trace.
   The lock is now threaded into the notice.
5. **Read-only viewers see no table at all**, not "today's table unchanged" as
   §Which rows get a picker stated. `ConvertedApprovalsNotice` renders inside
   `SopRosterEditor`, which the read-only branch does not render. The
   callback-absent path therefore has no production caller today; its test
   guards an API contract, not a user-visible state.
6. **Fixture rule, learned three times.** Any test `position` must be an exact
   `STANDARD_POSITION_TITLES` entry (`src/domain/departments.ts:27-37`) —
   `findByPositionTitle` compares whole normalised strings. An invented title
   resolves to nothing, the row silently becomes `no-match`, and a test
   asserting any other status passes for the wrong reason.

### Still required before production trust

Live verification never ran: the available session (`rlopez@anacorp.com`) has
`org_tool_access = none`, so the feature is structurally invisible to it. Needs
`jli@`, `tbach@` or `tnguyen@`. The decisive check is **reload after mapping** —
every test mocks the write, so a green suite proves nothing about whether the
debounced autosave actually persists `departmentCode` into the `document` jsonb.

