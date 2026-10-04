// Characterization of the scenario functions and SOP picker list Phase 5 moves into
// src/lib/planner/scenario-store.ts. Real functions, recording client as the page's planner client.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecordingSupabase, type RecordedRequest, type ScriptedReply } from "@/test-support/recording-supabase";
import {
  deleteScenario,
  duplicateScenario,
  listSopSummariesFromSupabase,
  loadScenariosForProduct,
  renameScenario,
  updateScenarioTarget,
} from "./supabase-planner";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

const scope = globalThis as { __buildlogicPlannerSupabaseClient?: unknown };
function install(reply?: (request: RecordedRequest) => ScriptedReply | undefined) {
  const db = createRecordingSupabase({ reply });
  scope.__buildlogicPlannerSupabaseClient = db.client;
  return db;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { delete scope.__buildlogicPlannerSupabaseClient; warn.mockRestore(); });

describe("scenarios", () => {
  it("lists a product's scenarios earliest first with only the switcher columns", async () => {
    const db = install(() => ({ data: [{ id: "s1", name: "Main", target_output: "4", target_output_period: "day", created_at: "2026-01-01" }] }));
    const scenarios = await loadScenariosForProduct("product-1");
    expect(db.lines()).toEqual(["scenarios.select(id,name,target_output,target_output_period,notes,created_at) product_id=product-1 | order(created_at)"]);
    expect(scenarios).toEqual([expect.objectContaining({ id: "s1", name: "Main", targetOutput: 4 })]);
  });

  it("duplicates through the RPC and returns the new id as a string", async () => {
    const db = install(() => ({ data: 42 }));
    await expect(duplicateScenario("s1", "Projection")).resolves.toBe("42");
    expect(db.requests).toMatchObject([{ kind: "rpc", target: "duplicate_scenario", payload: { p_source_scenario_id: "s1", p_new_name: "Projection" } }]);
  });

  it("updates the target and the name of exactly one scenario", async () => {
    const db = install();
    await updateScenarioTarget("s2", 12, "week");
    await renameScenario("s2", "Night shift");
    expect(db.lines()).toEqual(["scenarios.update id=s2", "scenarios.update id=s2"]);
    expect(db.requests.map((r) => r.payload)).toEqual([{ target_output: 12, target_output_period: "week" }, { name: "Night shift" }]);
  });

  it("deletes only through the guarded RPC", async () => {
    const db = install();
    await deleteScenario("s2");
    expect(db.requests).toMatchObject([{ kind: "rpc", target: "delete_scenario", payload: { p_scenario_id: "s2" } }]);
    expect(db.writes()).toEqual([]);
  });

  it("propagates each refusal", async () => {
    install(() => ({ error: { message: "cannot delete Main" } }));
    await expect(deleteScenario("main")).rejects.toThrow("cannot delete Main");
    await expect(duplicateScenario("s", "n")).rejects.toThrow("cannot delete Main");
    await expect(renameScenario("s", "n")).rejects.toThrow("cannot delete Main");
    await expect(updateScenarioTarget("s", 1, "day")).rejects.toThrow("cannot delete Main");
    await expect(loadScenariosForProduct("p")).rejects.toThrow("cannot delete Main");
  });
});

describe("SOP picker list", () => {
  it("lists live SOPs by number then title", async () => {
    const db = install(() => ({ data: [{ id: 7, sop_number: "SOP-PRD-001", title: "Wiring", status: "effective" }, { id: "x", sop_number: null, title: null, status: null }] }));
    expect(await listSopSummariesFromSupabase()).toEqual([
      { id: "7", sopNumber: "SOP-PRD-001", title: "Wiring", status: "effective" },
      { id: "x", sopNumber: undefined, title: undefined, status: undefined },
    ]);
    expect(db.lines()).toEqual(["sops.select(id,sop_number,title,status) deleted_at is null | order(sop_number nullslast) order(title)"]);
  });

  it("degrades every failure to an empty list, warning except for a missing table", async () => {
    install(() => ({ error: { message: "missing", code: "42P01" } }));
    await expect(listSopSummariesFromSupabase()).resolves.toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    install(() => ({ error: { message: "denied", code: "42501" } }));
    await expect(listSopSummariesFromSupabase()).resolves.toEqual([]);
    expect(warn).toHaveBeenLastCalledWith("Failed to load SOP summaries for the task picker: denied");
    delete scope.__buildlogicPlannerSupabaseClient;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    vi.stubGlobal("__buildlogicPlannerSupabaseClient", { from: () => { throw new Error("client exploded"); } });
    try {
      await expect(listSopSummariesFromSupabase()).resolves.toEqual([]);
      expect(warn).toHaveBeenLastCalledWith("Failed to load SOP summaries for the task picker: client exploded");
    } finally {
      vi.unstubAllGlobals();
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    }
  });
});
