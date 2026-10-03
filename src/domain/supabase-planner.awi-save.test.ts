import { describe, expect, it, vi } from "vitest";
import { saveProcedureTaskUpdateToSupabase } from "./supabase-planner";
import type { Task } from "./types";

function draft(): Task {
  return {
    id: "awi-task", version: 3, name: "Install", description: "Latest description",
    plannedDurationMinutes: 5,
    manufacturingSteps: [{ id: "step", sequence: 10, version: 7, instruction: "Latest instruction", durationMinutes: 5 }],
    partReferences: [],
    customFields: {
      awiDocumentNumber: "AWI-0001", stepPhotoAttachments: { step: [{ id: "photo", publicUrl: "signed-photo" }] },
      stepToolLists: { step: ["Wrench"] },
    },
    procedureSaveBaseline: {
      stepVersions: { step: 7, removed: 2 },
      partReferences: [{ id: "removed-part", partNumber: "PN-1", quantity: 2 }],
    },
  } as unknown as Task;
}

function acknowledgement() {
  return {
    task: { id: "awi-task", version: 4, name: "Install", description: "Latest description", planned_duration_minutes: 5,
      custom_fields: { awiDocumentNumber: "AWI-0001" } },
    steps: [{ id: "step", sequence: 1, version: 8, instruction: "Latest instruction", duration_minutes: 5 }],
    parts: [],
  };
}

describe("master AWI editor persistence", () => {
  it("saves once and acknowledges the committed snapshot without a racing follow-up read", async () => {
    const task = draft();
    const client = { rpc: vi.fn().mockResolvedValue({ data: acknowledgement(), error: null }), from: vi.fn() };
    const saved = await saveProcedureTaskUpdateToSupabase(task, [], "awi-project", true, client as never);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("save_awi_procedure", expect.objectContaining({
      p_task_id: "awi-task", p_project_id: "awi-project", p_expected_version: 3,
      p_expected_step_versions: { step: 7, removed: 2 },
      p_expected_parts: [{ id: "removed-part", task_id: "awi-task", part_number: "PN-1", quantity: 2, description: null, disposition: null }],
      p_steps: [expect.objectContaining({ id: "step", sequence: 1, instruction: "Latest instruction" })],
      p_parts: [],
      p_task_patch: expect.objectContaining({ name: "Install", custom_fields: { awiDocumentNumber: "AWI-0001" } }),
    }));
    expect(client.from).not.toHaveBeenCalled();
    expect(saved?.version).toBe(4);
    expect(saved?.manufacturingSteps?.[0].version).toBe(8);
    expect(saved?.procedureSaveBaseline).toEqual({ stepVersions: { step: 8 }, partReferences: [] });
    expect(saved?.customFields.stepPhotoAttachments).toEqual(task.customFields.stepPhotoAttachments);
    expect(saved?.customFields.stepToolLists).toEqual(task.customFields.stepToolLists);
    expect(task.version).toBe(3);
    expect(task.manufacturingSteps?.[0].sequence).toBe(10);
    expect(task.procedureSaveBaseline?.stepVersions.removed).toBe(2);
  });

  it("preserves local edits after a version conflict without reading or rebasing to overwrite it", async () => {
    const task = draft();
    const original = structuredClone(task);
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "40001", message: "Conflict" } }), from: vi.fn() };
    await expect(saveProcedureTaskUpdateToSupabase(task, [], "awi-project", true, client as never)).rejects.toThrow("AWI save conflict");
    expect(task).toEqual(original);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("does not mark an incomplete acknowledgement as a confirmed save", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }), from: vi.fn() };
    await expect(saveProcedureTaskUpdateToSupabase(draft(), [], "awi-project", true, client as never)).rejects.toThrow("Unable to confirm the saved AWI");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("keeps product tasks on their existing persistence path", async () => {
    const task = { ...draft(), customFields: {} };
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    const client = { rpc: vi.fn().mockResolvedValue({ data: "product-project", error: null }), from: vi.fn().mockReturnValue(query) };
    await expect(saveProcedureTaskUpdateToSupabase(task, [], "product-project", false, client as never)).rejects.toThrow("Task save conflict");
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("task_project_id", { target_task_id: task.id });
    expect(client.from).toHaveBeenCalledWith("tasks");
    expect(query.update).toHaveBeenCalledWith(expect.not.objectContaining({ name: "Install" }));
  });
});
