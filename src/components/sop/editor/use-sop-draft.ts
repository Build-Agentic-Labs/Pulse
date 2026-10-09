import { useCallback, useEffect, useRef, useState } from "react";
import type { Sop } from "@/domain/sop/schema";
import { DEFAULT_DOC_TYPE } from "@/domain/sop/authoring";
import {
  saveSop,
  SopConflictError,
  type SaveSopOptions,
} from "@/lib/sop/store";
import type { SopPatch } from "./editor-types";

type SaveStatus = "idle" | "saving" | "saved" | "error";
const AUTOSAVE_DELAY_MS = 2000;

function withAnnexIds(sop: Sop): Sop {
  return {
    ...sop,
    // Documents authored before the linked-SOPs / reference-docs features (e.g.
    // restored local drafts) may lack the keys entirely; the editor requires arrays.
    linkedSops: Array.isArray(sop.linkedSops) ? sop.linkedSops : [],
    referenceDocs: Array.isArray(sop.referenceDocs) ? sop.referenceDocs : [],
    annexes: sop.annexes.map((annex, index) => ({
      ...annex,
      id: annex.id || `${sop.id}-annex-${index}`,
    })),
  };
}

interface SopDraftOptions {
  initial: Sop;
  isNew: boolean;
  workspaceId?: string;
  canEditPermission: boolean;
  deptId: string;
  hasSelectedDepartment: boolean;
  reviewCycle: number;
  pauseAutosave: boolean;
}

/** Owns draft edits, serialized persistence, and the optimistic concurrency token.
 * Workflow reads can update status without marking content dirty; workflow writes
 * must advance the token before allowing another save.
 */
export function useSopDraft({
  initial,
  isNew,
  workspaceId,
  canEditPermission,
  deptId,
  hasSelectedDepartment,
  reviewCycle,
  pauseAutosave,
}: SopDraftOptions) {
  const [sop, setSop] = useState<Sop>(() => withAnnexIds(initial));
  const canEdit = canEditPermission && sop.status === "draft";
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  // Edits since the last successful save -- drives the leave guards and autosave.
  const [dirty, setDirty] = useState(false);
  // A save lost the concurrency check: freeze autosave so we never loop against the conflict.
  const [conflicted, setConflicted] = useState(false);
  // Optimistic-concurrency token: the updated_at loaded with the SOP (undefined until the
  // first insert), refreshed from every save response so consecutive saves keep working.
  const [persistedUpdatedAt, setPersistedUpdatedAt] = useState<
    string | undefined
  >(isNew ? undefined : initial.updatedAt);
  // Mirror of the concurrency token read by persist(): an in-flight save advances it
  // synchronously (before its promise resolves), so a click that awaited that save reads the
  // fresh token here rather than this closure's stale state copy.
  const persistedUpdatedAtRef = useRef<string | undefined>(
    isNew ? undefined : initial.updatedAt,
  );
  // Bumped on every user edit so a save that raced with typing doesn't clobber newer edits.
  const editVersionRef = useRef(0);
  const persistedAnnexIdsRef = useRef(
    new Set(
      withAnnexIds(initial).annexes.flatMap((annex) =>
        annex.id ? [annex.id] : [],
      ),
    ),
  );
  // The edit version reflected in this render's `sop`. persist() closes over this snapshot
  // rather than reading the ref when it runs: a stale autosave timer can fire after a
  // keystroke but before its effect cleanup cancels it, and reading the ref at call time
  // would count that keystroke as "already saved" -- the server copy of the older text
  // would then be adopted, resurrecting the deleted characters.
  const sopEditVersion = editVersionRef.current;
  // Blocks overlapped saves from the same timer-vs-cleanup gap; a second in-flight save
  // would reuse the same expectedUpdatedAt and land as a false concurrency conflict.
  const saveInFlightRef = useRef(false);
  // Handle to the save currently running, so a click that races an autosave can await it
  // instead of being silently dropped (persist returned false while a save was in flight).
  const inFlightSaveRef = useRef<Promise<boolean> | null>(null);
  const hasPersistedSop = !isNew || Boolean(persistedUpdatedAt);
  // Version is lifecycle-owned: a new SOP is always 1.0 and only the database's
  // effective -> draft revision transition may increment it. Never trust typed/imported text.
  const controlledVersion =
    reviewCycle > 0
      ? /^\d+\.\d+$/.test(sop.meta.version.trim())
        ? sop.meta.version.trim()
        : `1.${reviewCycle}`
      : "1.0";

  function update(patch: SopPatch) {
    setSop((current) => ({
      ...current,
      ...(typeof patch === "function" ? patch(current) : patch),
    }));
    editVersionRef.current += 1;
    setDirty(true);
    setSaveStatus("idle");
  }

  // Persist the current SOP, returning whether it succeeded. Callers that navigate or export
  // gate on the boolean so a failed save never silently drops the user's work.
  async function persist(): Promise<boolean> {
    if (!canEdit || !workspaceId) {
      setSaveError(
        workspaceId
          ? "You do not have permission to save this SOP."
          : "Select an organization before saving.",
      );
      setSaveStatus("error");
      return false;
    }

    // A save (typically an autosave that a keystroke re-enabled the buttons over) may already be
    // running. Wait for it to settle, then fall through to one fresh save so this click captures
    // the latest edits against the up-to-date token -- never a silent no-op. The loop also
    // serializes two clicks that both awaited the same in-flight save. saveInFlightRef and
    // inFlightSaveRef are always set together, so this can't spin on a null promise.
    while (saveInFlightRef.current) {
      try {
        await inFlightSaveRef.current;
      } catch {
        // The in-flight save reported its own outcome; attempt a fresh save regardless.
      }
    }

    // First save of a new SOP: the owning department mints the number (and is written on INSERT).
    // Read the token from the ref: a save we just awaited advances it synchronously, while this
    // closure's `persistedUpdatedAt` would still show the pre-save value.
    const expectedUpdatedAt = persistedUpdatedAtRef.current;
    const firstSave = isNew && !expectedUpdatedAt;
    if (firstSave && !deptId) {
      setSaveError("Choose an owning department before saving.");
      setSaveStatus("error");
      return false;
    }

    setSaveStatus("saving");
    setSaveError("");
    saveInFlightRef.current = true;
    const run = runSave(firstSave, expectedUpdatedAt);
    inFlightSaveRef.current = run;
    return run;
  }

  async function runSave(
    firstSave: boolean,
    expectedUpdatedAt: string | undefined,
  ): Promise<boolean> {
    try {
      let working: Sop = {
        ...sop,
        meta: { ...sop.meta, version: controlledVersion },
      };
      const saveOptions: SaveSopOptions = { expectedUpdatedAt };
      if (firstSave) {
        // No number is minted here any more -- the `approved -> effective` transition mints it,
        // so creating and discarding drafts no longer burns sequence positions. Persist an empty
        // number rather than the rendered placeholder: `SOP-PRO-###` is a label, not a value, and
        // the database clamps sop_number to null on INSERT regardless.
        working = { ...working, meta: { ...working.meta, sopNumber: "" } };
        saveOptions.departmentId = deptId;
        saveOptions.docType = DEFAULT_DOC_TYPE;
      }

      try {
        const next = await saveSop(working, workspaceId!, saveOptions);
        persistedAnnexIdsRef.current = new Set(
          next.annexes.flatMap((annex) => (annex.id ? [annex.id] : [])),
        );
        // Advance the ref synchronously so a click awaiting this save reads the fresh token.
        persistedUpdatedAtRef.current = next.updatedAt;
        setPersistedUpdatedAt(next.updatedAt);
        if (editVersionRef.current === sopEditVersion) {
          // Nothing changed since the render that produced `sop` -- adopt the server copy wholesale.
          setSop(next);
          setDirty(false);
          setSaveStatus("saved");
        } else {
          // Edits landed after that render: keep them (still dirty, so autosave picks them up)
          // and only fold in the server timestamp. Change history is database-managed.
          setSop((current) => ({
            ...current,
            updatedAt: next.updatedAt,
          }));
          setSaveStatus("idle");
        }
        return true;
      } catch (error) {
        if (error instanceof SopConflictError) {
          // Never retry into a conflict -- the user copies their changes and reloads.
          setConflicted(true);
        }
        setSaveError(error instanceof Error ? error.message : "Save failed.");
        setSaveStatus("error");
        return false;
      }
    } finally {
      saveInFlightRef.current = false;
    }
  }

  const advanceSaveToken = useCallback((updatedAt: string | undefined) => {
    persistedUpdatedAtRef.current = updatedAt;
    setPersistedUpdatedAt(updatedAt);
  }, []);

  const observeWorkflowStatus = useCallback((status: Sop["status"]) => {
    setSop(current => current.status === status ? current : { ...current, status });
  }, []);

  const adoptWorkflowTransition = useCallback((
    control: Pick<Sop, "status" | "updatedAt">,
    expectedSopId?: string,
  ) => {
    advanceSaveToken(control.updatedAt);
    setSop(current => expectedSopId && current.id !== expectedSopId ? current : {
      ...current, status: control.status, updatedAt: control.updatedAt,
    });
  }, [advanceSaveToken]);

  const clearSaveError = useCallback(() => setSaveError(""), []);
  const reportSaveError = useCallback((message: string) => {
    setSaveError(message);
    setSaveStatus("error");
  }, []);
  // Invitation retries report success without claiming that unsaved edits were persisted.
  const reportWorkflowSaved = useCallback(() => {
    setSaveError("");
    setSaveStatus("saved");
  }, []);

  function replaceWithLatest(latest: Sop) {
    const next = withAnnexIds(latest);
    persistedAnnexIdsRef.current = new Set(
      next.annexes.flatMap((annex) => (annex.id ? [annex.id] : [])),
    );
    editVersionRef.current += 1;
    setSop(next);
    advanceSaveToken(next.updatedAt);
    setDirty(false);
    setConflicted(false);
    setSaveError("");
    setSaveStatus("saved");
  }

  function beginControlledDraft(next: Sop) {
    setSop(next);
    advanceSaveToken(next.updatedAt);
    setDirty(false);
    setSaveStatus("idle");
  }

  function isAnnexPersisted(id: string) {
    return persistedAnnexIdsRef.current.has(id);
  }

  // Warn on tab close / hard navigation while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  // Debounced autosave after the latest edit settles. New SOPs use the same path for their
  // initial INSERT and number assignment; simply opening the builder never creates an empty
  // draft. A failed save waits for a retry or the next edit, and conflicts stop autosave.
  const autosaveArmed =
    canEdit &&
    !pauseAutosave &&
    Boolean(workspaceId) &&
    dirty &&
    !conflicted &&
    hasSelectedDepartment &&
    saveStatus === "idle";
  useEffect(() => {
    if (!autosaveArmed) return;
    const timer = window.setTimeout(() => {
      void persist();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // `persist` is recreated per render with the latest sop; re-arming on `sop` restarts
    // the debounce after every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveArmed, sop, deptId]);

  return {
    sop,
    observeWorkflowStatus, adoptWorkflowTransition, clearSaveError, reportSaveError, reportWorkflowSaved,
    canEdit,
    controlledVersion,
    dirty,
    conflicted,
    saveStatus,
    saveError,
    persistedUpdatedAt,
    hasPersistedSop,
    update,
    persist,
    replaceWithLatest,
    beginControlledDraft,
    isAnnexPersisted,
  };
}
