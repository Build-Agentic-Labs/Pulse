import { describe, expect, it } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { readCachedMainPlannerStateSync, writeCachedPlannerState } from "./planner-state-cache";

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
});
