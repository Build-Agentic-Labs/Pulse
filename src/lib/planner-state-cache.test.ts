import { describe, expect, it } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { clearCachedPlannerState, readCachedMainPlannerStateSync, writeCachedPlannerState } from "./planner-state-cache";

function plannerState(projectId: string, scenarioId: string, name: string) {
  return {
    ...emptyPlannerState,
    project: {
      projectId,
      projectName: name,
      workspaceId: "workspace-1",
      workspaceName: "ANA Corp",
    },
    product: {
      ...emptyPlannerState.product,
      projectId,
      name,
    },
    scenario: {
      ...emptyPlannerState.scenario,
      id: scenarioId,
      name: scenarioId,
    },
  };
}

describe("planner state memory cache", () => {
  it("makes a confirmed Main project snapshot available synchronously", async () => {
    const projectId = "cache-project-main";
    const state = plannerState(projectId, "scenario-main", "Cached Product");

    const write = writeCachedPlannerState(projectId, state, "scenario-main");

    expect(readCachedMainPlannerStateSync(projectId)?.state.product.name).toBe("Cached Product");
    await write;
  });

  it("does not let a projection evict the project's warm Main snapshot", async () => {
    const projectId = "cache-project-projection";
    const main = plannerState(projectId, "scenario-main", "Main Product");
    const projection = plannerState(projectId, "scenario-projection", "Projection Product");

    await writeCachedPlannerState(projectId, main, "scenario-main");
    await writeCachedPlannerState(projectId, projection, "scenario-main");

    expect(readCachedMainPlannerStateSync(projectId)?.state.scenario.id).toBe("scenario-main");
    expect(readCachedMainPlannerStateSync(projectId)?.state.product.name).toBe("Main Product");
  });

  it("refuses another project's state and invalidates the stale snapshot", async () => {
    const projectA = "cache-project-a";
    await writeCachedPlannerState(projectA, plannerState(projectA, "scenario-a", "Product A"), "scenario-a");
    expect(readCachedMainPlannerStateSync(projectA)?.state.product.name).toBe("Product A");

    await writeCachedPlannerState(projectA, plannerState("cache-project-b", "scenario-b", "Product B"), "scenario-b");

    expect(readCachedMainPlannerStateSync(projectA)).toBeNull();
    expect(readCachedMainPlannerStateSync("cache-project-b")).toBeNull();
  });

  it("clears a project's snapshot on request", async () => {
    const projectId = "cache-project-clear";
    await writeCachedPlannerState(projectId, plannerState(projectId, "scenario-main", "Clear me"), "scenario-main");
    await clearCachedPlannerState(projectId);
    expect(readCachedMainPlannerStateSync(projectId)).toBeNull();
  });
});
