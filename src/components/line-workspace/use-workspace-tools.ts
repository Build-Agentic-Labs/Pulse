"use client";

import { useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { applyCalculatedFields } from "@/domain/calculations";
import type { ProjectToolCatalogEntry } from "@/domain/project-catalog";
import { buildStepToolLibrary, removeToolFromAllTasks, renameToolInTasks } from "@/domain/step-tools";
import {
  addStepToolToSupabase,
  deleteToolLibraryFromSupabase,
  loadToolLibraryFromSupabase,
  removeStepToolFromSupabase,
  savePlannerShellToSupabase,
  upsertToolLibraryMetadata,
  type ToolLibraryItem,
} from "@/domain/supabase-planner";
import { buildProjectToolRegistry } from "@/domain/tool-registry";
import { canonicalToolKey, formatToolName } from "@/domain/tool-name-format";
import type { ToolTypeValue } from "@/domain/tool-types";
import type { PlannerState, Task } from "@/domain/types";
import type { WorkspaceWriteTracker } from "@/domain/workspace-save-status";
import type { ReportedSaveStatusSetters, WorkspaceFeedback } from "./workspace-controller-types";

// Step tools and the project tool catalog: the project tool library (loaded per active project), the
// derived tool list and registry, per-step tool writes, and catalog rename / tidy / delete. Catalog
// renames and deletes rewrite every task through the guarded shell save (applyProjectTasksUpdate),
// which stays refused until a remote load confirmed the state being edited.

export type UseWorkspaceToolsOptions = ReportedSaveStatusSetters &
  Pick<WorkspaceFeedback, "notifyFeedback"> & {
    projectId?: string;
    /** The active project context's id; the tool library loads for it. */
    libraryProjectId?: string;
    derivedState: PlannerState;
    setPlannerState: Dispatch<SetStateAction<PlannerState>>;
    writeTracker: WorkspaceWriteTracker;
    /** True only once this project's remote load confirmed the edited state. */
    remoteStateConfirmedRef: RefObject<boolean>;
    /** Runs a realtime refresh that was deferred while local saves were pending. */
    flushDeferredRemoteRefresh: () => void;
  };

// Re-declared every render like the component code it came from: async continuations keep the values
// of the render that started them.
export function useWorkspaceTools({
  projectId,
  libraryProjectId,
  derivedState,
  setPlannerState,
  writeTracker,
  remoteStateConfirmedRef,
  setSaveState,
  setSaveError,
  notifyFeedback,
  flushDeferredRemoteRefresh,
}: UseWorkspaceToolsOptions) {
  const [toolLibraryItems, setToolLibraryItems] = useState<ToolLibraryItem[]>([]);
  const toolLibrary = useMemo(() => {
    const toolsByKey = new Map<string, string>();
    buildStepToolLibrary(derivedState.tasks).forEach((tool) => {
      toolsByKey.set(canonicalToolKey(tool), tool);
    });
    toolLibraryItems.forEach((item) => {
      const toolName = formatToolName(item.toolName);
      const key = canonicalToolKey(toolName);
      if (key && !toolsByKey.has(key)) {
        toolsByKey.set(key, toolName);
      }
    });
    return [...toolsByKey.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [derivedState.tasks, toolLibraryItems]);
  const projectToolRegistry = useMemo(
    () => buildProjectToolRegistry(derivedState.tasks, toolLibraryItems),
    [derivedState.tasks, toolLibraryItems],
  );

  useEffect(() => {
    let active = true;

    loadToolLibraryFromSupabase(libraryProjectId)
      .then((tools) => {
        if (active) {
          setToolLibraryItems(tools);
        }
      })
      .catch(() => {
        if (active) {
          setToolLibraryItems([]);
        }
      });

    return () => {
      active = false;
    };
  }, [libraryProjectId]);

  // Tool-name cleanup is user-triggered from the Tools catalog ("Tidy names"),
  // not automatic on load — see tidyCatalogToolNames / ProjectCatalogSetupPanel.

  async function persistAddStepTool(taskId: string, stepId: string, toolName: string, sequence = 1) {
    const finishWrite = writeTracker.begin(`tool:${stepId}:${canonicalToolKey(toolName)}`);
    setSaveError(undefined);
    setSaveState("saving");

    try {
      await addStepToolToSupabase(taskId, stepId, toolName, sequence, projectId);
      setSaveState("saved");
    } catch (error) {
      finishWrite(error);
      setSaveError(error instanceof Error ? error.message : "Unable to add the tool.");
      setSaveState("error");
    } finally {
      finishWrite();
      flushDeferredRemoteRefresh();
    }
  }

  async function persistRemoveStepTool(stepId: string, toolName: string) {
    const finishWrite = writeTracker.begin(`tool:${stepId}:${canonicalToolKey(toolName)}`);
    setSaveError(undefined);
    setSaveState("saving");

    try {
      const taskId = derivedState.tasks.find((task) =>
        (task.manufacturingSteps ?? []).some((step) => step.id === stepId),
      )?.id;
      await removeStepToolFromSupabase(stepId, toolName, taskId, projectId);
      setSaveState("saved");
    } catch (error) {
      finishWrite(error);
      setSaveError(error instanceof Error ? error.message : "Unable to remove the tool.");
      setSaveState("error");
    } finally {
      finishWrite();
      flushDeferredRemoteRefresh();
    }
  }

  async function applyProjectTasksUpdate(nextTasks: Task[], options?: { silent?: boolean }) {
    // This path runs the destructive shell diff-save directly; refuse it until the remote load has
    // confirmed the state being edited (a cached snapshot could delete teammates' newer tasks).
    if (!remoteStateConfirmedRef.current) {
      const message = "The latest database state hasn't finished loading yet. Try again in a moment.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Save blocked", body: message, tone: "warning" });
      return;
    }

    setSaveError(undefined);
    setSaveState("saving");

    const finishWrite = writeTracker.begin("planner");
    const calculated = applyCalculatedFields(derivedState.product, derivedState.stations, nextTasks);
    const nextState = {
      ...derivedState,
      product: calculated.product,
      stations: calculated.stations,
      tasks: calculated.tasks,
    };

    setPlannerState(nextState);

    try {
      await savePlannerShellToSupabase(nextState);
      setSaveState("saved");
      if (!options?.silent) {
        notifyFeedback({
          title: "Build catalog updated",
          body: "Tool assignments were saved across the workspace.",
          tone: "success",
        });
      }
    } catch (error) {
      finishWrite(error);
      const message = error instanceof Error ? error.message : "Unable to save build catalog changes.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({
        title: "Save failed",
        body: message,
        tone: "danger",
      });
      throw error;
    } finally {
      finishWrite();
      flushDeferredRemoteRefresh();
    }
  }

  async function saveCatalogTool(
    entry: ProjectToolCatalogEntry,
    draft: { name: string; category: ToolTypeValue },
  ) {
    const formattedName = formatToolName(draft.name);
    if (!formattedName) {
      notifyFeedback({
        title: "Tool name required",
        body: "Enter a tool name before saving.",
        tone: "danger",
      });
      return;
    }

    const nameChanged = canonicalToolKey(formattedName) !== entry.key;
    const finishWrite = writeTracker.begin(`tool-catalog:${entry.key}`);
    try {
      if (nameChanged) {
        // Match the raw stored occurrence by canonical key, rewriting it in place.
        const nextTasks = renameToolInTasks(derivedState.tasks, entry.rawName, formattedName);
        await applyProjectTasksUpdate(nextTasks);
      }

      // Target the real library row by canonical key, so a messy stored name still
      // migrates (and its category survives — the upsert wipes category otherwise).
      const existingItem = toolLibraryItems.find(
        (item) => canonicalToolKey(item.toolName) === entry.key,
      );

      await upsertToolLibraryMetadata({
        toolName: formattedName,
        category: draft.category,
        projectId,
        previousToolName:
          existingItem && existingItem.toolName.trim() !== formattedName ? existingItem.toolName : undefined,
      });

      const tools = await loadToolLibraryFromSupabase(projectId);
      setToolLibraryItems(tools);
      setSaveState("saved");

      if (!nameChanged) {
        notifyFeedback({
          title: "Tool updated",
          body: `${formattedName} type saved.`,
          tone: "success",
        });
      }
    } catch (error) {
      finishWrite(error);
      throw error;
    } finally {
      finishWrite();
      flushDeferredRemoteRefresh();
    }
  }

  async function tidyCatalogToolNames(plan: Array<{ from: string; to: string }>) {
    if (plan.length === 0) {
      return;
    }

    try {
      // 1. Rewrite every stored occurrence in one project write. Silent: the
      //    "Tool names cleaned up" toast below is the user-facing signal.
      const nextTasks = plan.reduce(
        (tasks, rename) => renameToolInTasks(tasks, rename.from, rename.to),
        derivedState.tasks,
      );
      await applyProjectTasksUpdate(nextTasks, { silent: true });

      // 2. Migrate library rows that exist (preserving category); collect failures.
      let metadataFailures = 0;
      for (const rename of plan) {
        const key = canonicalToolKey(rename.from);
        const existingItem = toolLibraryItems.find((item) => canonicalToolKey(item.toolName) === key);
        if (!existingItem || existingItem.toolName.trim() === rename.to) {
          continue;
        }
        try {
          await upsertToolLibraryMetadata({
            toolName: rename.to,
            category: existingItem.category,
            projectId,
            previousToolName: existingItem.toolName,
          });
        } catch {
          metadataFailures += 1;
        }
      }

      const failureNote = metadataFailures > 0 ? `, ${metadataFailures} could not be saved` : "";
      notifyFeedback({
        title: "Tool names cleaned up",
        body: `Cleaned up ${plan.length} tool name${plan.length === 1 ? "" : "s"}${failureNote}.`,
        tone: metadataFailures > 0 ? "warning" : "neutral",
      });
    } catch {
      // applyProjectTasksUpdate already surfaced an error toast; abandon the
      // tidy (no partial task write — the shell save is atomic) without
      // rejecting, since this runs fire-and-forget from the load effect.
    } finally {
      // Always reflect whatever persisted, even on partial failure.
      try {
        const tools = await loadToolLibraryFromSupabase(projectId);
        setToolLibraryItems(tools);
      } catch {
        // Reload failure is non-fatal; the next load will reconcile.
      }
    }
  }

  async function deleteCatalogTool(entry: ProjectToolCatalogEntry) {
    const finishWrite = writeTracker.begin(`tool-catalog:${entry.key}`);
    try {
      const nextTasks = removeToolFromAllTasks(derivedState.tasks, entry.rawName);
      await applyProjectTasksUpdate(nextTasks);

      if (entry.libraryId) {
        await deleteToolLibraryFromSupabase(entry.libraryId, projectId);
        const tools = await loadToolLibraryFromSupabase(projectId);
        setToolLibraryItems(tools);
      }
      setSaveState("saved");
    } catch (error) {
      finishWrite(error);
      throw error;
    } finally {
      finishWrite();
      flushDeferredRemoteRefresh();
    }
  }

  return {
    toolLibraryItems,
    toolLibrary,
    projectToolRegistry,
    persistAddStepTool,
    persistRemoveStepTool,
    saveCatalogTool,
    tidyCatalogToolNames,
    deleteCatalogTool,
  };
}
