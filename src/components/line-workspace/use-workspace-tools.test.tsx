import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import type { ProjectToolCatalogEntry } from "@/domain/project-catalog";
import {
  addStepToolToSupabase,
  deleteToolLibraryFromSupabase,
  loadToolLibraryFromSupabase,
  removeStepToolFromSupabase,
  savePlannerShellToSupabase,
  upsertToolLibraryMetadata,
  type SaveState,
  type ToolLibraryItem,
} from "@/domain/supabase-planner";
import type { PlannerState } from "@/domain/types";
import { WorkspaceWriteTracker } from "@/domain/workspace-save-status";
import { getTaskStepToolListMap, STEP_TOOL_LISTS_FIELD } from "@/domain/step-tools";
import { deferredPromise as deferred, procedureTestTask } from "./procedure-test-fixtures";
import { useWorkspaceTools } from "./use-workspace-tools";

vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  addStepToolToSupabase: vi.fn(async () => undefined),
  deleteToolLibraryFromSupabase: vi.fn(async () => undefined),
  loadToolLibraryFromSupabase: vi.fn(async () => []),
  removeStepToolFromSupabase: vi.fn(async () => undefined),
  savePlannerShellToSupabase: vi.fn(async () => undefined),
  upsertToolLibraryMetadata: vi.fn(async () => undefined),
}));

const PROJECT_ID = "project-tools";
const notifyFeedback = vi.fn();
const flushDeferredRemoteRefresh = vi.fn();
const library = (names: string[]): ToolLibraryItem[] =>
  names.map((toolName, index) => ({ id: `lib-${index}`, toolName, category: "hand" }) as unknown as ToolLibraryItem);

// One task whose step uses a messy tool name ("torque  wrench"); step tools live in customFields.
const toolTask = procedureTestTask("Fit the bracket", 1, {
  customFields: { [STEP_TOOL_LISTS_FIELD]: { "step-1": ["torque  wrench"] } },
});
const stepTools = (task?: PlannerState["tasks"][number]) => (task ? getTaskStepToolListMap(task)["step-1"] ?? [] : []);
const initialState: PlannerState = { ...emptyPlannerState, tasks: [toolTask] };

function renderTools({ confirmed = true, libraryProjectId = PROJECT_ID } = {}) {
  const tracker = new WorkspaceWriteTracker(PROJECT_ID);
  const hook = renderHook(({ libraryProjectId: libraryId }: { libraryProjectId: string }) => {
    const [plannerState, setPlannerState] = useState<PlannerState>(initialState);
    const [saveState, setSaveState] = useState<SaveState>("saved");
    const [saveError, setSaveError] = useState<string>();
    const remoteStateConfirmedRef = useRef(confirmed);
    const tools = useWorkspaceTools({
      projectId: PROJECT_ID,
      libraryProjectId: libraryId,
      derivedState: plannerState,
      setPlannerState,
      writeTracker: tracker,
      remoteStateConfirmedRef,
      setSaveState,
      setSaveError,
      notifyFeedback,
      flushDeferredRemoteRefresh,
    });
    return { plannerState, saveState, saveError, tools };
  }, { initialProps: { libraryProjectId } });
  return { ...hook, tracker };
}

const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadToolLibraryFromSupabase).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

it("loads the library for the active project and ignores a response that arrives after a switch", async () => {
  const first = deferred<ToolLibraryItem[]>();
  vi.mocked(loadToolLibraryFromSupabase).mockReturnValueOnce(first.promise).mockResolvedValueOnce(library(["Hex Key"]));
  const { result, rerender } = renderTools();
  expect(loadToolLibraryFromSupabase).toHaveBeenCalledWith(PROJECT_ID);

  rerender({ libraryProjectId: "project-other" });
  await flush();
  expect(loadToolLibraryFromSupabase).toHaveBeenLastCalledWith("project-other");
  await act(async () => { first.resolve(library(["Stale Wrench"])); });

  expect(result.current.tools.toolLibraryItems.map((item) => item.toolName)).toEqual(["Hex Key"]);
  // The derived list merges step tools and library tools by canonical key, sorted.
  expect(result.current.tools.toolLibrary).toEqual(["Hex Key", "Torque Wrench"]);
});

it("reports a step tool write through its own tracker key and keeps a failure until that key succeeds", async () => {
  vi.mocked(addStepToolToSupabase).mockRejectedValueOnce(new Error("Tool write failed"));
  const { result, tracker } = renderTools();
  await flush();

  await act(async () => { await result.current.tools.persistAddStepTool("task-1", "step-1", "Torque Wrench"); });
  expect(addStepToolToSupabase).toHaveBeenCalledWith("task-1", "step-1", "Torque Wrench", 1, PROJECT_ID);
  expect(result.current.saveState).toBe("error");
  expect(tracker.getSnapshot().failures).toEqual([{ key: "tool:step-1:torque wrench", message: "Tool write failed" }]);

  await act(async () => { await result.current.tools.persistRemoveStepTool("step-1", "Torque Wrench"); });
  // Remove resolves the owning task from the current state, and succeeds on the same key.
  expect(removeStepToolFromSupabase).toHaveBeenCalledWith("step-1", "Torque Wrench", "task-1", PROJECT_ID);
  expect(result.current.saveState).toBe("saved");
  expect(tracker.getSnapshot()).toEqual({ pending: 0, failures: [] });
  expect(flushDeferredRemoteRefresh).toHaveBeenCalledTimes(2);
});

it("renames a catalog tool across tasks with one guarded shell save, keeping the library row's category", async () => {
  vi.mocked(loadToolLibraryFromSupabase).mockResolvedValue(library(["torque  wrench"]));
  const { result } = renderTools();
  await flush();
  const entry = { key: "torque wrench", rawName: "torque  wrench", libraryId: "lib-0" } as ProjectToolCatalogEntry;

  await act(async () => {
    await result.current.tools.saveCatalogTool(entry, { name: "Torque Driver", category: "power" as never });
  });

  expect(savePlannerShellToSupabase).toHaveBeenCalledTimes(1);
  const savedTasks = vi.mocked(savePlannerShellToSupabase).mock.calls[0]?.[0].tasks ?? [];
  expect(stepTools(savedTasks[0])).toEqual(["Torque Driver"]);
  expect(stepTools(result.current.plannerState.tasks[0])).toEqual(["Torque Driver"]);
  expect(upsertToolLibraryMetadata).toHaveBeenCalledWith({
    toolName: "Torque Driver",
    category: "power",
    projectId: PROJECT_ID,
    previousToolName: "torque  wrench",
  });
  expect(result.current.saveState).toBe("saved");
});

it("refuses catalog rewrites before the remote load confirmed the state", async () => {
  const { result } = renderTools({ confirmed: false });
  await flush();
  const entry = { key: "torque wrench", rawName: "torque  wrench" } as ProjectToolCatalogEntry;

  await act(async () => { await result.current.tools.deleteCatalogTool(entry); });

  expect(savePlannerShellToSupabase).not.toHaveBeenCalled();
  expect(notifyFeedback).toHaveBeenCalledWith(expect.objectContaining({ title: "Save blocked" }));
  expect(stepTools(result.current.plannerState.tasks[0])).toEqual(["torque  wrench"]);
});

it("deletes a catalog tool from every task and its library row, then reloads the library", async () => {
  vi.mocked(loadToolLibraryFromSupabase).mockResolvedValueOnce(library(["torque  wrench"])).mockResolvedValueOnce([]);
  const { result } = renderTools();
  await flush();
  const entry = { key: "torque wrench", rawName: "torque  wrench", libraryId: "lib-0" } as ProjectToolCatalogEntry;

  await act(async () => { await result.current.tools.deleteCatalogTool(entry); });

  expect(stepTools(vi.mocked(savePlannerShellToSupabase).mock.calls[0]?.[0].tasks[0])).toEqual([]);
  expect(deleteToolLibraryFromSupabase).toHaveBeenCalledWith("lib-0", PROJECT_ID);
  expect(result.current.tools.toolLibraryItems).toEqual([]);
  expect(result.current.saveState).toBe("saved");
});

it("tidies names, reports partial library failures, and reloads the library even then", async () => {
  vi.mocked(loadToolLibraryFromSupabase).mockResolvedValueOnce(library(["torque  wrench"])).mockResolvedValueOnce(library(["Torque Wrench"]));
  vi.mocked(upsertToolLibraryMetadata).mockRejectedValueOnce(new Error("Library offline"));
  const { result } = renderTools();
  await flush();

  await act(async () => {
    await result.current.tools.tidyCatalogToolNames([{ from: "torque  wrench", to: "Torque Wrench" }]);
  });

  expect(savePlannerShellToSupabase).toHaveBeenCalledTimes(1);
  expect(notifyFeedback).toHaveBeenCalledWith(expect.objectContaining({
    title: "Tool names cleaned up",
    body: "Cleaned up 1 tool name, 1 could not be saved.",
    tone: "warning",
  }));
  expect(result.current.tools.toolLibraryItems.map((item) => item.toolName)).toEqual(["Torque Wrench"]);
});
