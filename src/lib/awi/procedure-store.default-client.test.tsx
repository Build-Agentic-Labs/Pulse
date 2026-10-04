// The AWI procedure save without an injected client: it uses the page's shared planner client (the
// same implementation the planner facade re-exports), an injected client always wins, and on the
// server the default is the browser-only trap rather than a working client.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as facade from "@/domain/supabase-planner";
import * as plannerClientModule from "@/lib/planner/client";
import { saveAwiProcedure, type AwiProcedureSave } from "./procedure-store";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

const payload: AwiProcedureSave = {
  p_task_id: "awi-task", p_project_id: "awi-project", p_expected_version: 3,
  p_expected_step_versions: {}, p_expected_parts: [], p_task_patch: {}, p_steps: [], p_parts: [],
};
const scope = globalThis as { __buildlogicPlannerSupabaseClient?: unknown; window?: unknown };
const fakeClient = () => ({ rpc: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }), from: vi.fn() });

beforeEach(() => {
  delete scope.__buildlogicPlannerSupabaseClient;
});

describe("AWI procedure save client", () => {
  it("is the same client factory the planner facade exports", () => {
    expect(facade.createPlannerSupabaseClient).toBe(plannerClientModule.createPlannerSupabaseClient);
  });

  it("uses the page's shared planner client when none is injected", async () => {
    const shared = fakeClient();
    scope.__buildlogicPlannerSupabaseClient = shared;
    await expect(saveAwiProcedure(payload)).resolves.toEqual({ ok: true });
    expect(shared.rpc).toHaveBeenCalledExactlyOnceWith("save_awi_procedure", payload);
    expect(facade.createPlannerSupabaseClient()).toBe(shared);
  });

  it("prefers an injected client over the shared one", async () => {
    const shared = fakeClient();
    const injected = fakeClient();
    scope.__buildlogicPlannerSupabaseClient = shared;
    await saveAwiProcedure(payload, injected as never);
    expect(injected.rpc).toHaveBeenCalledTimes(1);
    expect(shared.rpc).not.toHaveBeenCalled();
  });

  it("refuses to run on the server without an injected client", async () => {
    const browserWindow = scope.window;
    try {
      delete scope.window;
      await expect(saveAwiProcedure(payload)).rejects.toThrow("createPlannerSupabaseClient() is browser-only: 'rpc'");
    } finally {
      scope.window = browserWindow;
    }
  });
});
