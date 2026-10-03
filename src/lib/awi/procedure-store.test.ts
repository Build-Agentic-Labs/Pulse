import { describe, expect, it, vi } from "vitest";
import { saveAwiProcedure, type AwiProcedureSave } from "./procedure-store";

const payload: AwiProcedureSave = {
  p_task_id: "awi-task", p_project_id: "awi-project", p_expected_version: 3,
  p_expected_step_versions: { step: 2 }, p_expected_parts: [],
  p_task_patch: { name: "Install" }, p_steps: [], p_parts: [],
};

describe("master AWI transactional save", () => {
  it("sends a single transaction without separate writes", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }), from: vi.fn() };
    await saveAwiProcedure(payload, client as never);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("save_awi_procedure", payload);
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(["40001", "23505"])("does not retry or fall back after conflict %s", async (code) => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: { code, message: "Conflict" } }), from: vi.fn() };
    await expect(saveAwiProcedure(payload, client as never)).rejects.toThrow("AWI save conflict. Your local draft is preserved");
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("propagates connection failure without retrying separate partial writes", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: { code: "08006", message: "Connection lost" } }), from: vi.fn() };
    await expect(saveAwiProcedure(payload, client as never)).rejects.toThrow("Connection lost");
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
  });
});
