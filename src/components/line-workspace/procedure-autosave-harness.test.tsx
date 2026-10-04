import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import type { PlannerState } from "@/domain/types";
import { installProcedureAutosaveHarness } from "./procedure-autosave-harness";
import { procedureDraftStorageKey } from "./state";
import { useProcedureDrafts } from "./use-procedure-drafts";
import { createProcedureSaveQueueStore } from "./use-procedure-save-queue";

type HarnessWindow = Window & { __PULSE_PROCEDURE_AUTOSAVE_HARNESS__?: { runAll: () => Array<{ name: string; pass: boolean }> } };

function renderWorkspaceDrafts() {
  return renderHook(() => {
    const [plannerState, setPlannerState] = useState<PlannerState>(emptyPlannerState);
    const latestDerivedStateRef = useRef(plannerState);
    const mainScenarioIdRef = useRef<string | undefined>(undefined);
    const autosaveHarnessRanRef = useRef(false);
    const [store] = useState(createProcedureSaveQueueStore);
    const drafts = useProcedureDrafts({
      projectId: "project-harness",
      mainScenarioIdRef,
      latestDerivedStateRef,
      setPlannerState,
      queueProbe: store,
    });
    return { drafts, store, autosaveHarnessRanRef };
  });
}

afterEach(() => {
  window.localStorage.clear();
});

it("runs every scenario against isolated state and restores the workspace's drafts and storage", () => {
  const { result } = renderWorkspaceDrafts();
  const { drafts, store, autosaveHarnessRanRef } = result.current;
  const liveDrafts = drafts.procedureDraftsRef.current;
  const liveQueues = store.procedureSaveQueuesRef.current;
  window.localStorage.setItem(procedureDraftStorageKey("project-harness"), "live-snapshot");

  const uninstall = installProcedureAutosaveHarness({
    projectId: "project-harness",
    hasAutosaveHarnessParam: false,
    autosaveHarnessRanRef,
    procedureSaveQueuesRef: store.procedureSaveQueuesRef,
    drafts,
  });
  const harness = (window as HarnessWindow).__PULSE_PROCEDURE_AUTOSAVE_HARNESS__;
  expect(document.documentElement.dataset.pulseProcedureAutosaveHarnessReady).toBe("true");
  expect(document.documentElement.dataset.pulseProcedureAutosaveHarnessResult).toBeUndefined();

  let results: Array<{ name: string; pass: boolean }> = [];
  act(() => {
    results = harness?.runAll() ?? [];
  });
  expect(results.map((entry) => entry.name)).toHaveLength(7);
  expect(results.filter((entry) => !entry.pass)).toEqual([]);
  expect(drafts.procedureDraftsRef.current).toBe(liveDrafts);
  expect(store.procedureSaveQueuesRef.current).toBe(liveQueues);
  expect(window.localStorage.getItem(procedureDraftStorageKey("project-harness"))).toBe("live-snapshot");

  uninstall();
  expect((window as HarnessWindow).__PULSE_PROCEDURE_AUTOSAVE_HARNESS__).toBeUndefined();
  expect(document.documentElement.dataset.pulseProcedureAutosaveHarnessReady).toBeUndefined();
});

it("runs once on install for ?autosaveHarness=1 and publishes the result", () => {
  const { result } = renderWorkspaceDrafts();
  const { drafts, store, autosaveHarnessRanRef } = result.current;
  const options = {
    projectId: "project-harness",
    hasAutosaveHarnessParam: true,
    autosaveHarnessRanRef,
    procedureSaveQueuesRef: store.procedureSaveQueuesRef,
    drafts,
  };

  let uninstall = () => {};
  act(() => {
    uninstall = installProcedureAutosaveHarness(options);
  });
  const published = JSON.parse(document.documentElement.dataset.pulseProcedureAutosaveHarnessResult ?? "[]");
  expect(published.every((entry: { pass: boolean }) => entry.pass)).toBe(true);
  expect(autosaveHarnessRanRef.current).toBe(true);

  uninstall();
  expect(autosaveHarnessRanRef.current).toBe(false);
  expect(document.documentElement.dataset.pulseProcedureAutosaveHarnessResult).toBeUndefined();
});
