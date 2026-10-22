# Controlled SOP change confirmation screenshots

These are captures of the actual Pulse Next.js app at localhost:3008, connected exclusively to the isolated `pulse-confirm-review` Docker stack (API 58421, database 58422). They use synthetic users and a synthetic equipment-inspection SOP. No current SOPs or hosted database migrations were changed, and outbound email credentials were empty.

1. `phase-1.png`: select minor revision or major version in the Effective Library.
2. `phase-2.png`: identify sections affected and record the author/process-owner assessment in the builder.
3. `phase-3.png`: the original version remains effective while the revision awaits release.
4. `phase-4.png`: Quality verifies classification, the document and change history before a fresh release signature.
5. `phase-5.png`: released version 1.1 with the sections affected, confirming actors, release identity and approval provenance.

The synthetic minor revision was submitted and released through the real browser UI. The existing departmental signatures were preserved. The database regression suite separately covers major versions, changed approvers, Quality returns/escalation, missing confirmations, and stale content/rosters.

## Automatic changes detection

The latest screenshots are `automatic-changes-purpose.png` and `automatic-changes-released.png`. These supersede the earlier manual sections-entry screenshots. The field is now read-only and derived from the released baseline. A separate synthetic SOP completed the real author submission and Quality release flow with automatically recorded sections. Existing SOP rows were verified unchanged when applying the local-only detection migration.

## Final local verification and release — October 22, 2026

- `new-approver-signed.png` and `new-approver-released.png`: a separate Docker fixture retained two original departmental approvals, required only the added approver to review/sign, routed automatically to independent Quality, and released version 1.1. Existing SOP/revision/signature/seat/change-request/carry-forward records matched their before-test fingerprints.
- `library-progress-icon.png`: the final library uses a compact progress icon beside Effective, with the actual pending revision in its hover/focus tooltip.
- Validation: 320 test files / 2,635 tests, 399 Docker SOP assertions, lint, build and standalone typecheck passed.
- The three controlled revision, impact confirmation and automatic section detection migrations were rehearsed against the linked database with rollback, then applied together transactionally. In-transaction fingerprints verified no changes to existing SOP documents/statuses, released revision contents, signatures, reviewer assignments, review submissions, annexes, events or SOP notifications. No change requests were created by migration.
- Only these migration versions were registered: `20261022202248`, `20261022210018`, `20261022230647`. Older unrelated local/remote migration-history differences were left untouched. Security advisors reported no error-level issues.
