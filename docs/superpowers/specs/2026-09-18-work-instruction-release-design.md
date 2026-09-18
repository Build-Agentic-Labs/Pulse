# Work Instruction Release & References — Design

**Date:** 2026-09-18
**Status:** Built. Owner decisions recorded below (2026-09-18).
**Related:** `2026-08-04-assembly-work-instruction-design.md` (the sheet; decision 2 deferred
document control and left `WorkInstructionMeta` as the seam this fills).

## Problem

A work instruction is generated live from a planner task every time it is opened. It therefore
had no revision of its own (the header showed the *product's* revision), an always-blank effective
date, and an always-empty revision history. Anyone editing a step changed what the floor printed,
with no record. Reference documents were limited to two free-text task fields.

## Owner decisions (2026-09-18)

1. **The work instruction has its own revision letter** — Rev A, B, … Z, AA — independent of the
   product revision, which stays in the header's Product field.
2. **The author approves, for now.** One person releases; they are recorded as both preparer and
   approver. Review/approval with separate signers is a later phase (see Out of scope).
3. **One work instruction at a time.** No batch release.

## Core idea: a release is a frozen copy

Releasing saves an immutable snapshot of the built document with a revision letter, an effective
date and a "what changed" note. Everything the header shows about control is *derived* from the
release rows; nobody types a revision or a history line.

- **States.** `unreleased` → `released` (live content matches the latest release) → `modified`
  (it no longer does). The list shows `Rev B`, `Rev B · modified`, `Ready` or `Incomplete`.
- **Drift detection** is a fingerprint of what the operator reads: document number, title,
  context, setup (references included) and every card. It excludes control meta and all photo URLs
  and storage paths (a photo is its id, caption and annotations). It is always computed on the
  **default-layout** build, because cards are split per layout.
- **Two fingerprints.** The planner loads a task's photos lazily, so the list usually holds tasks
  without them. `content_hash` covers photos; `text_hash` does not. The list compares `text_hash`
  for tasks whose photos are not loaded; the preview and the release dialog load photos and compare
  `content_hash`. The release dialog refuses to release until the photos are loaded.
- **Frozen photos.** At release each step photo is server-side copied (no egress) to
  `workspaces/<ws>/projects/<project>/wi-releases/<task>/<batch>/<photo>.<ext>` — the same
  project-scoped prefix the `step-photos` bucket's RLS already governs — and the snapshot points
  at the copy. Deleting a step photo later cannot break a released document.
  `scripts/cleanup-orphaned-storage.mjs` treats these paths as referenced.
- **The draft is never mistaken for a release.** A modified document's header reads `Draft` with
  no effective date; the preview toolbar says "Draft · modified since Rev B" and offers a
  Draft / Released toggle. A released revision prints only in the layout it was released in.

## No second builder

The planner's task editor already *is* the builder (steps, tools, checks, photos, parts). What is
borrowed from the SOP flow is the stepped shape of the release dialog:
**Readiness → References → Release → History**. Readiness blocks on: no steps, no WI number, no
title, unprintable (overflowing) text, no tools, no checklist. Missing photos, purpose and safety
notes are warnings.

## Reference documents

`work_instruction_references`, per task: a Pulse **SOP** (picked; the sheet always shows its
current number, title and version), a **drawing**, a **document**, or a **link**. The task's two
legacy free-text fields (`drawingLink`, `sopLink`) still lead the list. References print in the
setup band (seven lines, then "+N in Pulse") and are frozen into each release, so changing one —
or a referenced SOP gaining a new version — shows the instruction as modified.

### Reference files (owner request, 2026-09-18)

A drawing or document reference can carry the file itself, uploaded in the References step and
stored in Pulse. An SOP is picked and a link is an address, so neither takes a file. A reference
may have a file, a link, or both.

- Private bucket `wi-reference-files`, 20 MB, the same types SOP annexes accept (PDF, Word,
  Excel, CSV, JPG, PNG). The browser uploads straight to Storage, so Vercel's 4.5 MB function
  body limit never applies.
- Object path `workspaces/<ws>/projects/<project>/wi-references/<task>/<upload-id>-<name>`.
  Storage RLS: project `view` reads, project `edit` uploads and deletes. The reference row's
  trigger refuses a `storage_path` outside its own project and task, so a row cannot claim
  another project's file.
- Opened through a one-minute signed URL (PDFs and images inline, everything else downloads
  under its original name). Removing the reference removes the file.
- The file's name is part of the sheet's reference, so swapping a file shows the instruction as
  modified. The file itself is not copied into a release: the sheet prints the reference line,
  not the attachment.

## Data model & enforcement

`work_instruction_releases` and `work_instruction_references` (migrations `20260918120000`,
`20260918121000`, `20260918130000`).

**RLS in one sentence:** anyone with `view` access to the task's project can read its releases
and references; anyone with `edit` access can release and manage references; a release can never
be updated, and its revision, releaser, name, timestamp and project are set by the database, not
the client.

- A `before insert` trigger stamps `project_id` (from `task_project_id`), the next
  `revision_index` under a per-task advisory lock, the letter, `released_by = auth.uid()` and the
  releaser's name. RLS `with check` runs after it, so it judges the *real* project.
- A `before update` trigger refuses every update, including the service role's.
- Neither table has a cascading FK to `tasks`: the planner's full-state save hard-deletes task
  rows absent from memory, and a controlled record must not vanish with them. Rows carry their own
  `project_id` and go only with the project.
- An SOP reference must belong to the project's own workspace (trigger), and keeps a label on the
  row so it survives the SOP being removed.
- Writes are granular (one INSERT per release / reference); nothing touches the full-state save.

## Surfaces

- Work Instructions panel: status chips, stat cards, a **Release** button per row.
- `WorkInstructionControl` dialog (the stepped flow).
- `WorkInstructionPrintPreview`: loads releases + references as an overlay (a failed load leaves
  the control fields blank rather than guessing), applies the header meta, offers Draft/Released,
  and accepts `pinnedReleaseId`. The print route accepts `?release=<id>` for a shareable link to a
  released revision, which renders even if the task has since been deleted.

## Out of scope (next phases)

- Separate reviewer/approver with signatures and notifications. The header's Reviewed-by stays
  blank; when added it should be its own small tables, **not** routed through the SOP
  `enforce_sop_transition` / `sign_sop` functions.
- Freezing a copy of each reference FILE into a release (today a release freezes the reference
  line; the file stays live and goes when its reference is removed). CAD formats are not accepted.
- Batch release; obsoleting a revision; the phone portal showing released copies only.
