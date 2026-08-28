# Step photo clipboard — Ctrl+C / Ctrl+V across steps

**Date:** 2026-08-27
**Status:** Approved, ready for implementation plan

## Problem

Authoring a procedure means attaching photos to manufacturing steps, then routinely
discovering a photo belongs on a different step. Today the only way to move one is the
hover **Copy** button on a thumbnail, which opens a modal demanding a destination step
from a `<select>` before it will act
(`StepPhotoAttachmentEditor`, `src/components/line-workspace/step-editors.tsx`).

Two things are wrong with that:

1. **It forces the destination up front.** You must know where the photo is going at the
   moment you copy it, and pick it from a dropdown of step numbers rather than by looking
   at the step.
2. **It cannot cross tasks.** `copyTargets={task.manufacturingSteps ?? []}`
   (`procedure.tsx:1081`, `drawer.tsx:863`) restricts destinations to the current task.

Pasting an image from the *system* clipboard into a step already works and is unaffected
by this change (`handlePaste`, `step-editors.tsx:325`).

## Goal

Hover a photo, press Ctrl/Cmd+C (or Ctrl/Cmd+X to move it), hover any other step's photo
area anywhere in the project, press Ctrl/Cmd+V. No dialog, no destination picker.

## Defects this must fix

### D1 — A copied photo does not get its own bytes

`uploadStepPhotoAttachment` (`src/domain/supabase-planner.ts:4247`) early-returns when
`photo.dataUrl` is not a `data:` URL:

```ts
if (!photo.dataUrl.startsWith("data:image/")) {
  if (photo.storagePath && /^https?:\/\//.test(photo.dataUrl)) {
    await saveStepPhotoMetadataToSupabase(taskId, stepId, photo, project);
  }
  return photo;
}
```

For any photo already in storage this is always taken, so `copyStepPhoto`
(`line-workspace.tsx:4615`) writes a **metadata row only**. `duplicateStepPhotoAttachment`
gives the copy a fresh `id` but spreads `...photo`, so it inherits the source's
`storagePath` and `thumbnailStoragePath`. Both step photos then reference one object.

The early return is correct for its original purpose — re-saving an existing photo's
metadata should not re-upload it. The defect is that `copyStepPhoto` reuses the same
function for a genuinely new object and inherits the shortcut.

**Why it matters more once paste crosses tasks.** Single-photo deletes are soft
(`softDeleteStepPhotoAttachmentFromSupabase`, line 3591) and leave bytes intact, so
sharing is currently survivable. But deleting a *task* hard-deletes every storage object
belonging to its photos (line ~3651). Copy a photo from Task A into Task B, delete Task A,
and Task B's photo becomes a broken image. Cross-task paste must materialize real bytes.

### D2 — Cut must not destroy bytes the destination depends on

A move implemented as "insert at destination, delete source" is only safe once D1 is
fixed. Ordering is fixed by the design: the source row is soft-deleted **only after** the
destination write resolves.

## Non-goals

- Writing image bytes to the OS clipboard. A round trip through `image/png` would drop the
  photo's annotation document, and annotations are the whole point of these photos.
- Multi-select copy. One photo per clipboard entry.
- Persisting the clipboard across reloads. A stale entry pointing at a deleted photo is
  worse than an empty clipboard.
- Pasting across projects. Storage paths are project-scoped; out of scope.
- Fixing orphaned storage bytes on photo delete (`removeStepPhotoAttachmentObject`,
  line 4306, has zero call sites). Tracked separately.

## Design

### 1. Clipboard state

`src/domain/step-photo-clipboard.ts` (pure, tested) defines the entry and its rules:

```ts
export type StepPhotoClipboardMode = "copy" | "cut";

export interface StepPhotoClipboardEntry {
  photo: StepPhotoAttachment;
  sourceTaskId: string;
  sourceStepId: string;
  mode: StepPhotoClipboardMode;
}
```

plus `canPasteInto(entry, targetTaskId, targetStepId)` — false when the target is the
source step (a no-op paste), true otherwise.

`src/components/line-workspace/step-photo-clipboard-provider.tsx` holds the single entry
in React state and tracks what the pointer is over. It follows the existing provider
convention (`sop-workspace-provider.tsx`, `planning-workspace-provider.tsx`) and mounts
inside `LineWorkspace` so the entry survives navigation between tasks. In memory only.

Context value:

| Member | Purpose |
|---|---|
| `entry` | Current clipboard entry, or `null` |
| `putOnClipboard(photo, taskId, stepId, mode)` | Set the entry |
| `clear()` | Drop the entry |
| `setActivePhoto(ref \| null)` | Thumbnail hover **or** focus registration |
| `setActiveStep(ref \| null)` | Photo-region hover **or** focus registration |

### 2. Key handling

Copy and cut ride a **document-level `keydown`** listener in the provider. Paste rides the
**document-level `paste` event**, not `keydown` — this is deliberate and is what removes
the race between the internal clipboard and the system clipboard. One handler, one
decision:

```
on paste event:
  if event.clipboardData carries image files  -> existing system-image upload path
  else if internal entry and a step is hovered -> internal paste
  else                                         -> do nothing
```

A screenshot taken thirty seconds ago always beats a photo copied ten minutes ago, which
matches what a user expects.

**Guards.** Copy/cut/paste are all ignored when:

- the event target is an `input`, `textarea`, or `contenteditable` element, or
- a non-empty text selection exists (`window.getSelection()`), or
- for copy/cut, no thumbnail is active; for paste, no photo region is active.

**"Active" means hovered by the pointer OR holding keyboard focus**, whichever happened
last. Thumbnails are already `<button>` elements and the photo region already carries
`tabIndex={0}`, so Tab-navigation gets the same behaviour as the mouse with no extra
markup. Where this document says "hovered" it means active in this sense.

When a guard trips, `preventDefault` is **not** called and the browser does its normal
thing. This is what keeps ordinary text copying inside the procedure editor working.

### 3. Paste behaviour

New store function `pasteStepPhoto({ entry, targetTaskId, targetStepId })` in
`line-workspace.tsx`, replacing `copyStepPhoto`. It keeps that function's
optimistic-insert-with-rollback shape, which is correct and should not change:

1. `duplicateStepPhotoAttachment(entry.photo)` — fresh `id`, annotations normalized.
2. Optimistically upsert into the destination task's state; `setSaveState("saving")`.
3. Copy the bytes server-side. New export in `supabase-planner.ts`:
   `copyStepPhotoObject(sourcePath, destinationPath)` wrapping
   `supabase.storage.from(stepPhotoBucket).copy(from, to)`. Both the full image and the
   thumbnail are copied. Destination paths come from the existing
   `projectScopedStoragePath` / `projectScopedThumbnailStoragePath` called with the
   **target** task and step and the **new** photo id — since those functions key on
   `photo.id`, the copy lands on a distinct path automatically.
4. Sign the new paths, write the metadata row, and
   `saveTaskCustomFieldsToSupabase(targetTaskId, ...)`.
5. If `entry.mode === "cut"`: only now remove the photo from the source step, save the
   source task's custom fields, and `softDeleteStepPhotoAttachmentFromSupabase` the source
   row. Then `clear()` the clipboard.
6. On any failure: roll the optimistic insert back, soft-delete the destination row if it
   was written, surface the error through `notifyFeedback`, leave the source untouched.

A `copy` entry stays on the clipboard after pasting, so the same photo can be pasted onto
several steps in a row.

**The entry is a snapshot, deliberately.** It holds the `StepPhotoAttachment` as it was at
copy time. Two consequences, both acceptable: annotating the source photo after copying
does not change what a later paste produces, and deleting the source photo after copying
still leaves the paste working — single-photo deletes are soft, so the bytes the copy
reads are still there. Deleting the source *task* between copy and paste does destroy the
bytes; that paste fails at the storage copy and rolls back with an error, which is the
correct outcome.

Source and destination may be different tasks. `copyStepPhoto` already resolves its task
from `latestDerivedStateRef.current.tasks`, so the data layer needs no new plumbing for
cross-task — only the UI ever constrained it.

### 4. UI changes

- `StepPhotoThumbnail` wrapper registers pointer enter/leave and renders a dimmed state
  while it is the source of a pending `cut`.
- The hover **Copy** button no longer opens the modal; it calls `putOnClipboard(..., "copy")`,
  giving mouse-only users a path to the same clipboard. Its tooltip becomes
  "Copy photo (Ctrl+C)".
- **Removed:** the destination-select dialog, `copyTargets`, `onCopyToStep`,
  `onCopyStepPhoto`, and the `copyPhoto`/`copyTargetStepId`/`copyError`/`isCopying` state
  in `StepPhotoAttachmentEditor`. Paste strictly dominates them.
- Feedback via the existing `notifyFeedback`: "Photo copied — hover another step and press
  Ctrl+V", and on paste "Photo moved to Step N" / "Photo copied to Step N".

`step-editors.tsx` is 1137 lines. The clipboard provider goes in its own file rather than
growing it further.

## Testing

Domain (`src/domain/step-photo-clipboard.test.ts`):
- `canPasteInto` rejects the source step, accepts a different step in the same task, and
  accepts a step in another task.

Component (extending `src/components/line-workspace/step-editors.test.tsx`):
- Hover a thumbnail + Ctrl+C sets the clipboard entry.
- Ctrl+X sets a `cut` entry and dims the source thumbnail.
- Paste precedence: a paste event carrying image files uses the upload path even when an
  internal entry exists.
- Guard: Ctrl+C with a text selection, or focus in a textarea, does not set an entry and
  does not call `preventDefault`.
- Paste with no hovered step region is a no-op.

Store (`line-workspace` paste function):
- `cut` removes the source only after the destination write resolves.
- A failed destination write rolls back the optimistic insert and leaves the source
  present.
- A copy produces a photo whose `storagePath` differs from the source's (the D1
  regression test).

## Risks

**Globally intercepting Ctrl+C.** The mitigation is the guard set in §2 — hover required,
no text selection, focus not in a field — and never calling `preventDefault` when a guard
trips. The guard tests above are the regression net.

**Storage `.copy()` and RLS — confirmed live 2026-08-27.** The copy is issued with the
browser client and is subject to the same storage policies as the original upload;
destination paths stay inside the same project prefix, so the policy that permits the
upload permits the copy. Verified against the live database on the `project-flexboost`
planner: a copy from Fluid Drain Step 1 to Step 3 produced
`.../tasks/task-flexboost-1/steps/<step-3>/thumbnails/photo-1787931065511-b34d7s.webp`
against a source of `.../steps/<step-1>/thumbnails/photo-1787326495132-sqm01y.webp` —
distinct step folder AND distinct photo id, i.e. the copy owns its bytes (defect D1 fixed).
A cross-task cut then produced `.../tasks/task-flexboost-2/steps/<step-2>/...` under the
DESTINATION task, and removed the photo from the source. No console errors, no server-side
write failures. Test artifacts were deleted afterwards; the project's photos are unchanged.

**Automation note for anyone re-running this.** Synthetic Ctrl+V from browser automation
does NOT reproduce this feature's paste: CDP key events deliver a `keydown` (verified:
`ctrlKey: true`) but never invoke the browser's clipboard command, so no native `paste`
event fires and nothing happens. The handler itself was exercised by dispatching a real
`ClipboardEvent('paste')`, which is what a genuine keypress delivers. Ctrl+C and Ctrl+X
ride `keydown` and DO work under automation — only paste has this gap.

**Guards — confirmed live.** With a photo hovered and no text selected, Ctrl+C called
`preventDefault` (the feature acted). With a text selection active and the same photo
hovered, `preventDefault` was NOT called, so the browser's own text copy proceeded
untouched. That is the property that keeps the global key listener from breaking ordinary
copying in the procedure editor.
