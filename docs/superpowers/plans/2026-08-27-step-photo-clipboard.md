# Step Photo Clipboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author hover a step photo, press Ctrl/Cmd+C (copy) or Ctrl/Cmd+X (cut), then hover any other step's photo area anywhere in the project and press Ctrl/Cmd+V to place it — replacing the modal that demands a destination step up front.

**Architecture:** An in-memory app clipboard holding one `StepPhotoClipboardEntry`, owned by a React context provider mounted inside `LineWorkspace`. Copy/cut ride a document-level `keydown` listener; paste rides the document-level `paste` event so system-clipboard images and internal entries are resolved at a single decision point. Pasting duplicates the photo's bytes server-side via Supabase Storage `.copy()` into a destination-scoped path, fixing an existing defect where copied photos shared the source's storage object.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Supabase (storage + RLS), Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-08-27-step-photo-clipboard-design.md`

## Global Constraints

- Domain logic lives in `src/domain/`, is pure (no React, no Supabase, no DOM), and gets a test file next to it.
- Never mutate state in place — build new objects (project rule).
- Never introduce a new full-state save path. Writes are granular (`saveTaskCustomFieldsToSupabase` for a single task).
- Feature CSS goes in a component/route-scoped file, never `app/globals.css`.
- `createPlannerSupabaseClient()` is browser-only; all work here is client-side.
- Commands: `npx vitest run <path>` for one file, `npm run typecheck`, `npm run lint`, `npm test`.
- Branch: `feat/step-photo-clipboard`. Commit after each task.

---

### Task 1: Shared clipboard-image helper

Extracts the existing image-detection logic so the provider and the step editor share one implementation instead of two copies.

**Files:**
- Create: `src/domain/clipboard-images.ts`
- Create: `src/domain/clipboard-images.test.ts`
- Modify: `src/components/line-workspace/step-editors.tsx:198-206` (replace local `clipboardImageFiles`)

**Interfaces:**
- Consumes: nothing
- Produces: `clipboardImageFiles(data: DataTransfer | null): File[]`

- [ ] **Step 1: Write the failing test**

Create `src/domain/clipboard-images.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { clipboardImageFiles } from "./clipboard-images";

function dataTransfer(items: unknown[], files: unknown[]) {
  return { items, files } as unknown as DataTransfer;
}

describe("clipboardImageFiles", () => {
  it("returns image files from clipboard items", () => {
    const image = new File(["bytes"], "shot.png", { type: "image/png" });
    const result = clipboardImageFiles(
      dataTransfer([{ kind: "file", type: "image/png", getAsFile: () => image }], []),
    );

    expect(result).toEqual([image]);
  });

  it("falls back to files when items carry nothing usable", () => {
    const image = new File(["bytes"], "shot.png", { type: "image/png" });
    const result = clipboardImageFiles(dataTransfer([], [image]));

    expect(result).toEqual([image]);
  });

  it("ignores non-image content", () => {
    const result = clipboardImageFiles(
      dataTransfer([{ kind: "string", type: "text/plain", getAsFile: () => null }], []),
    );

    expect(result).toEqual([]);
  });

  it("returns an empty list for a null DataTransfer", () => {
    expect(clipboardImageFiles(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/clipboard-images.test.ts`
Expected: FAIL — `Failed to resolve import "./clipboard-images"`

- [ ] **Step 3: Write the implementation**

Create `src/domain/clipboard-images.ts`:

```ts
/**
 * Image files carried by a paste/drop DataTransfer.
 *
 * Prefers `items` and falls back to `files` on purpose: screenshot tools and browsers
 * disagree about which collection they populate, and the fallback is what makes Cmd+V
 * work across both.
 */
export function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) {
    return [];
  }

  const itemFiles = Array.from(data.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const candidates = itemFiles.length > 0 ? itemFiles : Array.from(data.files ?? []);
  return candidates.filter((file) => file.type.startsWith("image/"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/clipboard-images.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Use it from the step editor**

In `src/components/line-workspace/step-editors.tsx`, delete the local `clipboardImageFiles` function (lines 198-206) and add the import alongside the other `@/domain` imports:

```ts
import { clipboardImageFiles } from "@/domain/clipboard-images";
```

Then change the call inside `handlePaste` from:

```ts
    const files = clipboardImageFiles(event);
```

to:

```ts
    const files = clipboardImageFiles(event.clipboardData);
```

- [ ] **Step 6: Run the existing editor tests to prove nothing regressed**

Run: `npx vitest run src/components/line-workspace/step-editors.test.tsx`
Expected: PASS — all existing tests, including the three clipboard paste tests

- [ ] **Step 7: Commit**

```bash
git add src/domain/clipboard-images.ts src/domain/clipboard-images.test.ts src/components/line-workspace/step-editors.tsx
git commit -m "refactor: extract clipboardImageFiles into domain"
```

---

### Task 2: Clipboard entry domain module

**Files:**
- Create: `src/domain/step-photo-clipboard.ts`
- Create: `src/domain/step-photo-clipboard.test.ts`

**Interfaces:**
- Consumes: `StepPhotoAttachment` from `src/domain/step-photos.ts`
- Produces:
  - `type StepPhotoClipboardMode = "copy" | "cut"`
  - `interface StepPhotoClipboardEntry { photo: StepPhotoAttachment; sourceTaskId: string; sourceStepId: string; mode: StepPhotoClipboardMode }`
  - `createStepPhotoClipboardEntry(photo, sourceTaskId, sourceStepId, mode): StepPhotoClipboardEntry`
  - `canPasteInto(entry: StepPhotoClipboardEntry | null, targetTaskId: string, targetStepId: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/domain/step-photo-clipboard.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { StepPhotoAttachment } from "./step-photos";
import { canPasteInto, createStepPhotoClipboardEntry } from "./step-photo-clipboard";

const photo: StepPhotoAttachment = {
  id: "photo-1",
  name: "Panel.png",
  dataUrl: "https://example.test/panel.png",
  capturedAt: "2026-08-27T00:00:00.000Z",
};

const entry = createStepPhotoClipboardEntry(photo, "task-1", "step-1", "copy");

describe("createStepPhotoClipboardEntry", () => {
  it("snapshots the photo with its source location and mode", () => {
    expect(entry).toEqual({
      photo,
      sourceTaskId: "task-1",
      sourceStepId: "step-1",
      mode: "copy",
    });
  });
});

describe("canPasteInto", () => {
  it("rejects an empty clipboard", () => {
    expect(canPasteInto(null, "task-1", "step-2")).toBe(false);
  });

  it("rejects the step the photo came from", () => {
    expect(canPasteInto(entry, "task-1", "step-1")).toBe(false);
  });

  it("allows another step in the same task", () => {
    expect(canPasteInto(entry, "task-1", "step-2")).toBe(true);
  });

  it("allows a step in a different task", () => {
    expect(canPasteInto(entry, "task-2", "step-1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/step-photo-clipboard.test.ts`
Expected: FAIL — `Failed to resolve import "./step-photo-clipboard"`

- [ ] **Step 3: Write the implementation**

Create `src/domain/step-photo-clipboard.ts`:

```ts
import type { StepPhotoAttachment } from "./step-photos";

export type StepPhotoClipboardMode = "copy" | "cut";

/**
 * One photo staged for placement on another step.
 *
 * The photo is a SNAPSHOT taken at copy time, deliberately: annotating the source after
 * copying does not change what a later paste produces, and deleting the source photo
 * still leaves the paste working because single-photo deletes are soft.
 */
export interface StepPhotoClipboardEntry {
  photo: StepPhotoAttachment;
  sourceTaskId: string;
  sourceStepId: string;
  mode: StepPhotoClipboardMode;
}

export function createStepPhotoClipboardEntry(
  photo: StepPhotoAttachment,
  sourceTaskId: string,
  sourceStepId: string,
  mode: StepPhotoClipboardMode,
): StepPhotoClipboardEntry {
  return { photo, sourceTaskId, sourceStepId, mode };
}

/** Pasting onto the step the photo came from is a no-op, for both copy and cut. */
export function canPasteInto(
  entry: StepPhotoClipboardEntry | null,
  targetTaskId: string,
  targetStepId: string,
): boolean {
  if (!entry) {
    return false;
  }

  return !(entry.sourceTaskId === targetTaskId && entry.sourceStepId === targetStepId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/step-photo-clipboard.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/step-photo-clipboard.ts src/domain/step-photo-clipboard.test.ts
git commit -m "feat: add step photo clipboard domain module"
```

---

### Task 3: Clipboard provider with key handling

The provider owns the entry, tracks which photo/step is *active* (hovered **or** focused), and installs the two document-level listeners.

**Files:**
- Create: `src/components/line-workspace/step-photo-clipboard-provider.tsx`
- Create: `src/components/line-workspace/step-photo-clipboard-provider.test.tsx`

**Interfaces:**
- Consumes: `canPasteInto`, `createStepPhotoClipboardEntry`, `StepPhotoClipboardEntry`, `StepPhotoClipboardMode` (Task 2); `clipboardImageFiles` (Task 1)
- Produces:
  - `interface StepPhotoTarget { taskId: string; stepId: string }`
  - `interface ActiveStepPhoto extends StepPhotoTarget { photo: StepPhotoAttachment }`
  - `StepPhotoClipboardProvider({ children, onPaste, onNotify })` where
    `onPaste: (entry: StepPhotoClipboardEntry, target: StepPhotoTarget) => Promise<void> | void` and
    `onNotify?: (message: { title: string; body?: string; tone: "success" | "danger" }) => void`
  - `useStepPhotoClipboard(): { entry, putOnClipboard, clear, setActivePhoto, setActiveStep }` with
    `putOnClipboard(photo: StepPhotoAttachment, taskId: string, stepId: string, mode: StepPhotoClipboardMode): void`,
    `clear(): void`,
    `setActivePhoto(target: ActiveStepPhoto | null): void`,
    `setActiveStep(target: StepPhotoTarget | null): void`

- [ ] **Step 1: Write the failing test**

Create `src/components/line-workspace/step-photo-clipboard-provider.test.tsx`:

```tsx
// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StepPhotoAttachment } from "@/domain/step-photos";
import {
  StepPhotoClipboardProvider,
  useStepPhotoClipboard,
  type StepPhotoTarget,
} from "./step-photo-clipboard-provider";
import type { StepPhotoClipboardEntry } from "@/domain/step-photo-clipboard";

const photo: StepPhotoAttachment = {
  id: "photo-1",
  name: "Panel.png",
  dataUrl: "https://example.test/panel.png",
  capturedAt: "2026-08-27T00:00:00.000Z",
};

function Harness() {
  const { entry, setActivePhoto, setActiveStep } = useStepPhotoClipboard();

  return (
    <div>
      <button type="button" onPointerEnter={() => setActivePhoto({ photo, taskId: "task-1", stepId: "step-1" })}>
        thumbnail
      </button>
      <div
        role="region"
        aria-label="destination"
        onPointerEnter={() => setActiveStep({ taskId: "task-1", stepId: "step-2" })}
      >
        destination
      </div>
      <textarea aria-label="instruction" defaultValue="text" />
      <span data-testid="mode">{entry?.mode ?? "empty"}</span>
    </div>
  );
}

function renderProvider(
  onPaste: (entry: StepPhotoClipboardEntry, target: StepPhotoTarget) => Promise<void> | void = vi.fn(),
) {
  const onNotify = vi.fn();
  render(
    <StepPhotoClipboardProvider onPaste={onPaste} onNotify={onNotify}>
      <Harness />
    </StepPhotoClipboardProvider>,
  );
  return { onNotify };
}

describe("StepPhotoClipboardProvider", () => {
  it("copies the active photo on Ctrl+C", () => {
    renderProvider();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });

    expect(screen.getByTestId("mode")).toHaveTextContent("copy");
  });

  it("cuts the active photo on Ctrl+X", () => {
    renderProvider();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(document, { key: "x", ctrlKey: true });

    expect(screen.getByTestId("mode")).toHaveTextContent("cut");
  });

  it("ignores Ctrl+C when no photo is active", () => {
    renderProvider();
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });

    expect(screen.getByTestId("mode")).toHaveTextContent("empty");
  });

  it("ignores Ctrl+C raised from a textarea", () => {
    renderProvider();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(screen.getByLabelText("instruction"), { key: "c", ctrlKey: true });

    expect(screen.getByTestId("mode")).toHaveTextContent("empty");
  });

  it("pastes onto the active step", async () => {
    const onPaste = vi.fn().mockResolvedValue(undefined);
    renderProvider(onPaste);

    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    fireEvent.pointerEnter(screen.getByRole("region", { name: "destination" }));
    fireEvent.paste(document, { clipboardData: { items: [], files: [] } });

    await waitFor(() =>
      expect(onPaste).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "copy", sourceStepId: "step-1" }),
        { taskId: "task-1", stepId: "step-2" },
      ),
    );
  });

  it("yields to a system clipboard image instead of pasting the internal entry", () => {
    const onPaste = vi.fn();
    renderProvider(onPaste);
    const image = new File(["bytes"], "shot.png", { type: "image/png" });

    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    fireEvent.pointerEnter(screen.getByRole("region", { name: "destination" }));
    fireEvent.paste(document, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => image }], files: [image] },
    });

    expect(onPaste).not.toHaveBeenCalled();
  });

  it("keeps a copy entry after pasting but clears a cut entry", async () => {
    const onPaste = vi.fn().mockResolvedValue(undefined);
    renderProvider(onPaste);

    fireEvent.pointerEnter(screen.getByRole("button", { name: "thumbnail" }));
    fireEvent.keyDown(document, { key: "x", ctrlKey: true });
    fireEvent.pointerEnter(screen.getByRole("region", { name: "destination" }));
    fireEvent.paste(document, { clipboardData: { items: [], files: [] } });

    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("empty"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/line-workspace/step-photo-clipboard-provider.test.tsx`
Expected: FAIL — `Failed to resolve import "./step-photo-clipboard-provider"`

- [ ] **Step 3: Write the implementation**

Create `src/components/line-workspace/step-photo-clipboard-provider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { clipboardImageFiles } from "@/domain/clipboard-images";
import {
  canPasteInto,
  createStepPhotoClipboardEntry,
  type StepPhotoClipboardEntry,
  type StepPhotoClipboardMode,
} from "@/domain/step-photo-clipboard";
import type { StepPhotoAttachment } from "@/domain/step-photos";

export interface StepPhotoTarget {
  taskId: string;
  stepId: string;
}

export interface ActiveStepPhoto extends StepPhotoTarget {
  photo: StepPhotoAttachment;
}

interface StepPhotoClipboardValue {
  entry: StepPhotoClipboardEntry | null;
  putOnClipboard: (
    photo: StepPhotoAttachment,
    taskId: string,
    stepId: string,
    mode: StepPhotoClipboardMode,
  ) => void;
  clear: () => void;
  setActivePhoto: (target: ActiveStepPhoto | null) => void;
  setActiveStep: (target: StepPhotoTarget | null) => void;
}

const StepPhotoClipboardContext = createContext<StepPhotoClipboardValue | null>(null);

/** A no-op clipboard so the editor renders outside a provider (tests, storybook-style use). */
const inertClipboard: StepPhotoClipboardValue = {
  entry: null,
  putOnClipboard: () => undefined,
  clear: () => undefined,
  setActivePhoto: () => undefined,
  setActiveStep: () => undefined,
};

export function useStepPhotoClipboard(): StepPhotoClipboardValue {
  return useContext(StepPhotoClipboardContext) ?? inertClipboard;
}

/** Typing in a field must never be hijacked by the photo clipboard. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function hasTextSelection(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0);
}

export function StepPhotoClipboardProvider({
  children,
  onPaste,
  onNotify,
}: {
  children: ReactNode;
  onPaste: (entry: StepPhotoClipboardEntry, target: StepPhotoTarget) => Promise<void> | void;
  onNotify?: (message: { title: string; body?: string; tone: "success" | "danger" }) => void;
}) {
  const [entry, setEntry] = useState<StepPhotoClipboardEntry | null>(null);
  const entryRef = useRef<StepPhotoClipboardEntry | null>(null);
  const activePhotoRef = useRef<ActiveStepPhoto | null>(null);
  const activeStepRef = useRef<StepPhotoTarget | null>(null);
  const onPasteRef = useRef(onPaste);
  const onNotifyRef = useRef(onNotify);

  entryRef.current = entry;
  onPasteRef.current = onPaste;
  onNotifyRef.current = onNotify;

  const setActivePhoto = useCallback((target: ActiveStepPhoto | null) => {
    activePhotoRef.current = target;
  }, []);

  const setActiveStep = useCallback((target: StepPhotoTarget | null) => {
    activeStepRef.current = target;
  }, []);

  const putOnClipboard = useCallback(
    (photo: StepPhotoAttachment, taskId: string, stepId: string, mode: StepPhotoClipboardMode) => {
      setEntry(createStepPhotoClipboardEntry(photo, taskId, stepId, mode));
      onNotifyRef.current?.({
        title: mode === "cut" ? "Photo cut" : "Photo copied",
        body: "Hover another step's photos and press Ctrl+V.",
        tone: "success",
      });
    },
    [],
  );

  const clear = useCallback(() => setEntry(null), []);

  // Copy/cut cannot ride the native `copy` event: that fires on the focused element, and
  // this feature keys off what the pointer is over. keydown is the only signal available.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "x") {
        return;
      }

      if (isEditableTarget(event.target) || hasTextSelection()) {
        return;
      }

      const active = activePhotoRef.current;
      if (!active) {
        return;
      }

      event.preventDefault();
      putOnClipboard(active.photo, active.taskId, active.stepId, key === "x" ? "cut" : "copy");
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [putOnClipboard]);

  // Paste rides the native `paste` event rather than keydown so that "did the system
  // clipboard bring an image?" is answered synchronously, at one decision point. A
  // screenshot taken seconds ago always beats a photo copied minutes ago.
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const currentEntry = entryRef.current;
      if (!currentEntry) {
        return;
      }

      if (clipboardImageFiles(event.clipboardData).length > 0) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const target = activeStepRef.current;
      if (!target || !canPasteInto(currentEntry, target.taskId, target.stepId)) {
        return;
      }

      event.preventDefault();
      void Promise.resolve(onPasteRef.current(currentEntry, target))
        .then(() => {
          if (currentEntry.mode === "cut") {
            setEntry(null);
          }
        })
        .catch(() => undefined);
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  const value = useMemo<StepPhotoClipboardValue>(
    () => ({ entry, putOnClipboard, clear, setActivePhoto, setActiveStep }),
    [entry, putOnClipboard, clear, setActivePhoto, setActiveStep],
  );

  return <StepPhotoClipboardContext.Provider value={value}>{children}</StepPhotoClipboardContext.Provider>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/line-workspace/step-photo-clipboard-provider.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/line-workspace/step-photo-clipboard-provider.tsx src/components/line-workspace/step-photo-clipboard-provider.test.tsx
git commit -m "feat: add step photo clipboard provider"
```

---

### Task 4: Server-side photo byte copy

Fixes defect D1 from the spec: a copied photo must own its bytes, or deleting the source task destroys the pasted copy.

**Files:**
- Modify: `src/domain/supabase-planner.ts` (add export near `uploadStepPhotoAttachment`, around line 4306)

**Interfaces:**
- Consumes: existing private helpers `plannerClient`, `assertTaskInProject`, `throwIfError`, `stepPhotoBucket`, `projectScopedStoragePath`, `projectScopedThumbnailStoragePath`, `signedStorageUrl`, `safeStorageSegment`, `saveStepPhotoMetadataToSupabase`
- Produces: `copyStepPhotoAttachmentToStep(targetTaskId: string, targetStepId: string, photo: StepPhotoAttachment, sourceStoragePath: string, sourceThumbnailStoragePath: string | undefined, project?: PlannerProjectContext): Promise<StepPhotoAttachment>`

- [ ] **Step 1: Read the function it is modelled on**

Run: `sed -n '4241,4310p' src/domain/supabase-planner.ts`

Note the shape of `uploadStepPhotoAttachment`: assert task in project, derive path, write, sign, throw if unsigned, save metadata, return the updated attachment. The new function mirrors it exactly, swapping the upload for a storage-side copy.

- [ ] **Step 2: Add the implementation**

Insert immediately after `removeStepPhotoAttachmentObject` (which ends at line 4315):

```ts
/**
 * Duplicate a stored photo object onto another step, server-side.
 *
 * `uploadStepPhotoAttachment` deliberately short-circuits for photos that already live in
 * Storage — it only re-saves metadata — which is right for re-saving but wrong for a copy:
 * the duplicate would inherit the source's `storage_path`, and deleting the source TASK
 * hard-deletes every object belonging to its photos, breaking the copy. So a paste gets its
 * own object. Storage `.copy()` does this on the server; no download/upload round trip.
 *
 * `photo` must already carry the NEW id (see `duplicateStepPhotoAttachment`) — destination
 * paths key on it, which is what keeps the copy on a distinct path.
 */
export async function copyStepPhotoAttachmentToStep(
  targetTaskId: string,
  targetStepId: string,
  photo: StepPhotoAttachment,
  sourceStoragePath: string,
  sourceThumbnailStoragePath: string | undefined,
  project?: PlannerProjectContext,
): Promise<StepPhotoAttachment> {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, targetTaskId, project?.projectId);

  const extension = photo.contentType?.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const storagePath = projectScopedStoragePath(
    targetTaskId,
    targetStepId,
    photo,
    project,
    safeStorageSegment(extension),
  );
  // Verified present in the installed client: storage-js exposes
  // copy(fromPath, toPath, options?) — node_modules/@supabase/storage-js/dist/index.d.mts:1149
  await throwIfError(supabase.storage.from(stepPhotoBucket).copy(sourceStoragePath, storagePath));

  let thumbnailStoragePath: string | undefined;
  let thumbnailUrl: string | undefined;
  if (sourceThumbnailStoragePath) {
    thumbnailStoragePath = projectScopedThumbnailStoragePath(targetTaskId, targetStepId, photo, project);
    await throwIfError(
      supabase.storage.from(stepPhotoBucket).copy(sourceThumbnailStoragePath, thumbnailStoragePath),
    );
    thumbnailUrl = await signedStorageUrl(supabase, thumbnailStoragePath, { cache: true });
  }

  const signedUrl = await signedStorageUrl(supabase, storagePath, { cache: true });
  if (!signedUrl) {
    throw new Error("The photo was copied, but a signed URL could not be created for it. Reload to retry.");
  }

  const copiedPhoto: StepPhotoAttachment = {
    ...photo,
    dataUrl: signedUrl,
    storagePath,
    thumbnailUrl,
    thumbnailStoragePath,
  };

  await saveStepPhotoMetadataToSupabase(targetTaskId, targetStepId, copiedPhoto, project);
  return copiedPhoto;
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors. If `safeStorageSegment` or `signedStorageUrl` resolve differently, run `grep -n "function safeStorageSegment\|function signedStorageUrl" src/domain/supabase-planner.ts` and match the real signatures.

- [ ] **Step 4: Commit**

```bash
git add src/domain/supabase-planner.ts
git commit -m "feat: copy step photo bytes server-side instead of sharing the source object"
```

---

### Task 5: Paste store function and provider mount

**Files:**
- Modify: `src/components/line-workspace.tsx:4615-4673` (replace `copyStepPhoto` with `pasteStepPhoto`)
- Modify: `src/components/line-workspace.tsx:6043-6048` (wrap the root element in the provider)

**Interfaces:**
- Consumes: `copyStepPhotoAttachmentToStep` (Task 4); `StepPhotoClipboardProvider`, `StepPhotoTarget` (Task 3); `StepPhotoClipboardEntry` (Task 2); existing `duplicateStepPhotoAttachment`, `upsertStepPhotoAttachments`, `removeStepPhotoAttachment`, `uploadStepPhotoAttachment`, `saveTaskCustomFieldsToSupabase`, `softDeleteStepPhotoAttachmentFromSupabase`, `notifyFeedback`
- Produces: `pasteStepPhoto(entry: StepPhotoClipboardEntry, target: StepPhotoTarget): Promise<void>` — passed to the provider as `onPaste`

- [ ] **Step 1: Add the imports**

In `src/components/line-workspace.tsx`, add to the existing `@/domain/supabase-planner` import list:

```ts
  copyStepPhotoAttachmentToStep,
```

and add two new imports:

```ts
import {
  StepPhotoClipboardProvider,
  type StepPhotoTarget,
} from "@/components/line-workspace/step-photo-clipboard-provider";
import type { StepPhotoClipboardEntry } from "@/domain/step-photo-clipboard";
```

- [ ] **Step 2: Replace `copyStepPhoto` with `pasteStepPhoto`**

Delete the whole `copyStepPhoto` function (lines 4615-4673) and put this in its place:

```ts
  /**
   * Place a clipboard photo onto a step, in this or any other task in the project.
   *
   * Order matters: the destination write must land before the source is touched, or a
   * failed paste loses the photo. When source and destination are the SAME task, both
   * edits must be folded into one task object and saved once — two sequential saves of
   * the same task would clobber each other.
   */
  async function pasteStepPhoto(entry: StepPhotoClipboardEntry, target: StepPhotoTarget) {
    const state = latestDerivedStateRef.current;
    const targetTask = state.tasks.find((task) => task.id === target.taskId);
    const targetStep = targetTask?.manufacturingSteps?.find((step) => step.id === target.stepId);
    if (!targetTask || !targetStep) {
      throw new Error("The destination step is no longer available.");
    }

    const isCut = entry.mode === "cut";
    const sameTask = entry.sourceTaskId === target.taskId;
    const pastedPhoto = duplicateStepPhotoAttachment(entry.photo);

    saveInFlightRef.current = true;
    setSaveError(undefined);
    setSaveState("saving");
    setPlannerState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => {
        if (task.id === target.taskId) {
          const withPhoto = upsertStepPhotoAttachments(task, target.stepId, [pastedPhoto]);
          return isCut && sameTask
            ? removeStepPhotoAttachment(withPhoto, entry.sourceStepId, entry.photo.id)
            : withPhoto;
        }

        if (isCut && task.id === entry.sourceTaskId) {
          return removeStepPhotoAttachment(task, entry.sourceStepId, entry.photo.id);
        }

        return task;
      }),
    }));

    let metadataSaved = false;
    try {
      // A photo still held only as a data: URL has never been uploaded, so there is no
      // object to copy — upload it the normal way instead.
      const persistedPhoto = entry.photo.storagePath
        ? await copyStepPhotoAttachmentToStep(
            target.taskId,
            target.stepId,
            pastedPhoto,
            entry.photo.storagePath,
            entry.photo.thumbnailStoragePath,
            activeProjectContext,
          )
        : await uploadStepPhotoAttachment(target.taskId, target.stepId, pastedPhoto, activeProjectContext);
      metadataSaved = true;

      const freshTargetTask = latestDerivedStateRef.current.tasks.find((task) => task.id === target.taskId);
      if (freshTargetTask) {
        let nextTargetTask = upsertStepPhotoAttachments(freshTargetTask, target.stepId, [persistedPhoto]);
        if (isCut && sameTask) {
          nextTargetTask = removeStepPhotoAttachment(nextTargetTask, entry.sourceStepId, entry.photo.id);
        }
        await saveTaskCustomFieldsToSupabase(target.taskId, nextTargetTask.customFields, projectId);
      }

      if (isCut && !sameTask) {
        const freshSourceTask = latestDerivedStateRef.current.tasks.find(
          (task) => task.id === entry.sourceTaskId,
        );
        if (freshSourceTask) {
          const nextSourceTask = removeStepPhotoAttachment(
            freshSourceTask,
            entry.sourceStepId,
            entry.photo.id,
          );
          await saveTaskCustomFieldsToSupabase(entry.sourceTaskId, nextSourceTask.customFields, projectId);
        }
      }

      if (isCut) {
        await softDeleteStepPhotoAttachmentFromSupabase(entry.photo.id, entry.sourceTaskId, projectId);
      }

      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === target.taskId
            ? upsertStepPhotoAttachments(task, target.stepId, [persistedPhoto])
            : task,
        ),
      }));
      setSaveState("saved");
      notifyFeedback({
        title: isCut ? "Photo moved" : "Photo copied",
        body: `${isCut ? "Moved" : "Added"} to Step ${targetStep.sequence}${
          targetStep.name?.trim() ? ` — ${targetStep.name.trim()}` : ""
        }.`,
        tone: "success",
      });
    } catch (error) {
      setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) => {
          if (task.id === target.taskId) {
            const withoutPaste = removeStepPhotoAttachment(task, target.stepId, pastedPhoto.id);
            return isCut && sameTask
              ? upsertStepPhotoAttachments(withoutPaste, entry.sourceStepId, [entry.photo])
              : withoutPaste;
          }

          if (isCut && task.id === entry.sourceTaskId) {
            return upsertStepPhotoAttachments(task, entry.sourceStepId, [entry.photo]);
          }

          return task;
        }),
      }));

      if (metadataSaved) {
        await softDeleteStepPhotoAttachmentFromSupabase(pastedPhoto.id, target.taskId, projectId).catch(
          () => undefined,
        );
      }

      const message = error instanceof Error ? error.message : "Unable to paste this photo.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Photo paste failed", body: message, tone: "danger" });
      throw error;
    } finally {
      saveInFlightRef.current = false;
      flushDeferredRemoteRefresh();
    }
  }
```

- [ ] **Step 3: Mount the provider**

At line 6043, change the root return from:

```tsx
  return (
    <div
      className="fixed inset-0 h-[100dvh] overflow-hidden bg-canvas text-ink"
      style={workspaceGridStyle}
    >
```

to:

```tsx
  return (
    <StepPhotoClipboardProvider onPaste={pasteStepPhoto} onNotify={notifyFeedback}>
    <div
      className="fixed inset-0 h-[100dvh] overflow-hidden bg-canvas text-ink"
      style={workspaceGridStyle}
    >
```

and close it at the end of the file — change the last three lines from:

```tsx
    </div>
  );
}
```

to:

```tsx
    </div>
    </StepPhotoClipboardProvider>
  );
}
```

- [ ] **Step 4: Remove the two `onCopyStepPhoto` props**

At lines 6123 and 6371, delete the line:

```tsx
            onCopyStepPhoto={copyStepPhoto}
```

Typecheck will still fail here until Task 6 removes the prop from the child components. That is expected — the two tasks land together.

- [ ] **Step 5: Commit (with Task 6 — do not commit a red tree)**

Hold this commit until Task 6 completes; the tree does not typecheck between them.

---

### Task 6: Wire the editor and delete the dialog

**Files:**
- Modify: `src/components/line-workspace/step-editors.tsx` (props, hover registration, Copy button, remove dialog)
- Modify: `src/components/line-workspace/procedure.tsx:1078-1088`
- Modify: `src/components/line-workspace/drawer.tsx:860-870`
- Modify: `src/components/line-workspace/step-editors.test.tsx`

**Interfaces:**
- Consumes: `useStepPhotoClipboard` (Task 3)
- Produces: `StepPhotoAttachmentEditor` with `taskId: string` added and `copyTargets` / `onCopyToStep` removed

- [ ] **Step 1: Update the editor's props type**

In `step-editors.tsx`, replace the `StepPhotoAttachmentEditorProps` type (lines 186-196) with:

```ts
type StepPhotoAttachmentEditorProps = {
  taskId: string;
  step: ManufacturingStep;
  photos: StepPhotoAttachment[];
  compact?: boolean;
  isUploading?: boolean;
  onFilesSelected: (files: File[]) => void;
  onRequestRemove: (photo: StepPhotoAttachment) => void;
  onUpdatePhoto?: (photoId: string, patch: Partial<StepPhotoAttachment>) => void;
};
```

- [ ] **Step 2: Replace the component's copy state with the clipboard hook**

Change the signature and the state block at the top of `StepPhotoAttachmentEditor` to:

```tsx
export function StepPhotoAttachmentEditor({
  taskId,
  step,
  photos,
  compact = false,
  isUploading = false,
  onFilesSelected,
  onRequestRemove,
  onUpdatePhoto,
}: StepPhotoAttachmentEditorProps) {
  const [previewPhoto, setPreviewPhoto] = useState<StepPhotoAttachment | null>(null);
  const { entry, putOnClipboard, setActivePhoto, setActiveStep } = useStepPhotoClipboard();
```

Delete `copyPhoto`, `copyTargetStepId`, `copyError`, `isCopying`, `copyDialogTitleId`, `availableCopyTargets`, `closeCopyDialog`, and `copyPhotoToSelectedStep` entirely. Add the import:

```ts
import { useStepPhotoClipboard } from "./step-photo-clipboard-provider";
```

- [ ] **Step 3: Register the step region as an active paste target**

On the outer `<div>` of the component (the one with `role="region"`), add four handlers alongside the existing `onPaste`:

```tsx
      onPointerEnter={() => setActiveStep({ taskId, stepId: step.id })}
      onPointerLeave={() => setActiveStep(null)}
      onFocus={() => setActiveStep({ taskId, stepId: step.id })}
      onBlur={() => setActiveStep(null)}
```

and update its `aria-label` to mention the new gesture:

```tsx
      aria-label={`Step ${step.sequence} photos. Paste an image, press Ctrl+V to paste a copied photo, or use Upload.`}
```

- [ ] **Step 4: Register each thumbnail as the active photo and show cut state**

Replace the thumbnail wrapper (`<div key={photo.id} className="shrink-0">` and its `<div className="group relative">`) with:

```tsx
            <div
              key={photo.id}
              className="shrink-0"
              onPointerEnter={() => setActivePhoto({ photo, taskId, stepId: step.id })}
              onPointerLeave={() => setActivePhoto(null)}
              onFocus={() => setActivePhoto({ photo, taskId, stepId: step.id })}
              onBlur={() => setActivePhoto(null)}
            >
              <div
                className={`group relative transition ${
                  entry?.mode === "cut" && entry.photo.id === photo.id ? "opacity-40" : ""
                }`}
              >
```

- [ ] **Step 5: Turn the Copy button into a clipboard action**

Replace the copy button block (the one guarded by `onCopyToStep && availableCopyTargets.length > 0`) with an unguarded button:

```tsx
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    putOnClipboard(photo, taskId, step.id, "copy");
                  }}
                  className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded bg-black/55 text-white opacity-0 transition hover:bg-black/75 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-white group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-label={`Copy photo from step ${step.sequence}`}
                  title="Copy photo (Ctrl+C) — then Ctrl+V on another step"
                >
                  <Copy size={11} />
                </button>
```

- [ ] **Step 6: Delete the dialog**

Remove the entire `{copyPhoto && onCopyToStep && typeof document !== "undefined" ? createPortal(...) : null}` block. If `createPortal` and `X` are now unused in this file, remove those imports too — `npm run lint` will name them.

- [ ] **Step 7: Update both call sites**

In `procedure.tsx` (around line 1078) and `drawer.tsx` (around line 860), delete the `copyTargets` and `onCopyToStep` lines and add `taskId`. Procedure becomes:

```tsx
                          <StepPhotoAttachmentEditor
                            taskId={task.id}
                            step={step}
                            photos={stepPhotos}
                            isUploading={(stepPhotoUploadCounts[step.id] ?? 0) > 0}
                            onFilesSelected={(files) => void uploadManufacturingStepPhotos(step.id, files)}
                            onRequestRemove={(photo) => requestRemoveManufacturingStepPhoto(step.id, photo)}
                            onUpdatePhoto={(photoId, patch) => updateManufacturingStepPhoto(step.id, photoId, patch)}
                          />
```

Drawer becomes the same with `taskId={taskId}` and `compact` retained. Then remove the now-unused `onCopyStepPhoto` prop from both components' props types and from any interface that declares it — `npm run typecheck` will list every site.

- [ ] **Step 8: Update the editor tests**

In `step-editors.test.tsx`, change `renderEditor` to drop the copy props, add `taskId`, and wrap in the provider:

```tsx
function renderEditor(overrides: {
  isUploading?: boolean;
  onFilesSelected?: (files: File[]) => void;
  photos?: StepPhotoAttachment[];
} = {}) {
  const onFilesSelected = overrides.onFilesSelected ?? vi.fn();
  render(
    <StepPhotoClipboardProvider onPaste={vi.fn()}>
      <StepPhotoAttachmentEditor
        taskId="task-1"
        step={step}
        photos={overrides.photos ?? []}
        isUploading={overrides.isUploading}
        onFilesSelected={onFilesSelected}
        onRequestRemove={vi.fn()}
      />
    </StepPhotoClipboardProvider>,
  );

  return {
    onFilesSelected,
    pasteTarget: screen.getByRole("region", {
      name: "Step 1 photos. Paste an image, press Ctrl+V to paste a copied photo, or use Upload.",
    }),
  };
}
```

Add the import `import { StepPhotoClipboardProvider } from "./step-photo-clipboard-provider";`, delete the existing test at line 133, `"copies a selected photo to another manufacturing step"` (it drives the removed dialog and will fail once the dialog is gone), and add:

```tsx
  it("puts a photo on the clipboard when the copy button is pressed", () => {
    const photo: StepPhotoAttachment = {
      id: "photo-1",
      name: "Panel.png",
      dataUrl: "https://example.test/panel.png",
      capturedAt: "2026-08-27T00:00:00.000Z",
    };
    renderEditor({ photos: [photo] });

    fireEvent.click(screen.getByRole("button", { name: "Copy photo from step 1" }));

    expect(screen.getByRole("button", { name: "Copy photo from step 1" })).toHaveAttribute(
      "title",
      "Copy photo (Ctrl+C) — then Ctrl+V on another step",
    );
  });
```

- [ ] **Step 9: Run the full gate**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: all green. Typecheck is the one that proves Task 5's prop removal and this task's signature change agree.

- [ ] **Step 10: Commit Tasks 5 and 6 together**

```bash
git add src/components/line-workspace.tsx src/components/line-workspace/step-editors.tsx src/components/line-workspace/step-editors.test.tsx src/components/line-workspace/procedure.tsx src/components/line-workspace/drawer.tsx
git commit -m "feat: paste step photos across steps with Ctrl+C/Ctrl+V"
```

---

### Task 7: Live verification

A green suite does not prove a rendered screen (project rule). This task is not optional.

**Files:** none — verification only.

- [ ] **Step 1: Start the dev server**

Use the `dev` config in `.claude/launch.json` (port 3000, `autoPort: false`). If the port is taken, stop the process holding it first.

- [ ] **Step 2: Sign in and open a procedure with photos**

Navigate to a task in the Product space whose steps carry photos — `project-flexboost`, `task-flexboost-1` has them.

- [ ] **Step 3: Copy within a task**

Hover a thumbnail, press Ctrl+C, confirm the "Photo copied" toast. Hover another step's photo area, press Ctrl+V. Expect the photo to appear there and a "Photo copied" toast naming the destination step.

- [ ] **Step 4: Confirm the bytes are genuinely separate**

In the browser console, compare the two photos' storage paths — they must differ:

```js
document.querySelectorAll('image[href*="step-photos"]').length
```

Then read the network requests for `/storage/v1/object/sign/step-photos/...` and confirm the pasted photo's path contains the **destination** step id, not the source's. This is the D1 regression check and the whole reason Task 4 exists.

- [ ] **Step 5: Cut across tasks**

Hover a photo, press Ctrl+X (thumbnail dims). Navigate to a different task, hover a step's photo area, press Ctrl+V. Expect the photo to appear there, disappear from the source, and a "Photo moved" toast.

- [ ] **Step 6: Confirm the guards**

- Select text in a step instruction, press Ctrl+C — the text must go to the system clipboard and no "Photo copied" toast may appear.
- Click into an instruction textarea and press Ctrl+V — the textarea must paste text normally.
- Take a screenshot with the OS, hover a step's photo area, press Ctrl+V — the screenshot must upload, not the internal clipboard photo.

- [ ] **Step 7: Check the console and server logs**

Read console messages (expect no errors) and dev-server logs (expect no failed writes).

- [ ] **Step 8: Update the spec's open question**

The spec's Risks section says storage `.copy()` under RLS is "to be confirmed live during implementation". Replace that sentence with what actually happened, and commit:

```bash
git add docs/superpowers/specs/2026-08-27-step-photo-clipboard-design.md
git commit -m "docs: record live verification of storage copy under RLS"
```

---

## Self-Review

**Spec coverage:** §1 clipboard state → Tasks 2, 3. §2 key handling and guards → Task 3. §3 paste behaviour including cut ordering and rollback → Tasks 4, 5. §4 UI changes and removals → Task 6. Testing section → tests in Tasks 1, 2, 3, 6. Defect D1 → Task 4, regression-checked in Task 7 Step 4. Defect D2 (cut ordering) → Task 5 Step 2. The spec's `putOnClipboard` / `setActivePhoto` / `setActiveStep` names match Task 3's context value. Non-goals are respected: no OS-clipboard writes, no multi-select, no persistence, no cross-project paste.

**Known deviation:** the spec named the shared helper only implicitly; Task 1 adds `src/domain/clipboard-images.ts` to avoid a second copy of the image-detection logic in the provider. This is a DRY extraction, not a scope change.

**Type consistency:** `StepPhotoClipboardEntry` (Task 2) is consumed unchanged by Tasks 3 and 5. `StepPhotoTarget` is defined in Task 3 and consumed in Task 5. `copyStepPhotoAttachmentToStep`'s six-parameter signature in Task 4 matches its call in Task 5 Step 2. `clipboardImageFiles(data: DataTransfer | null)` in Task 1 matches both call sites (Task 1 Step 5, Task 3's provider).
