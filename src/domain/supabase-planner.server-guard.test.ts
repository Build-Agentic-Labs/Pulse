import { describe, expect, it } from "vitest";

// Runs in the node project (no `window`), i.e. exactly the server environment the
// guard exists for. Before Stage 4, calling the planner client here returned a
// sessionless anon singleton whose RLS-scoped reads all returned zero rows — pages
// rendered empty instead of erroring. The guard converts that silent failure into
// a loud one; this test pins the contract Stage 5's server components rely on.

describe("createPlannerSupabaseClient on the server", () => {
  it("throws with guidance instead of returning a sessionless anon client", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    const { createPlannerSupabaseClient } = await import("./supabase-planner");

    expect(typeof window).toBe("undefined");
    expect(() => createPlannerSupabaseClient()).toThrowError(/browser-only[\s\S]*createSupabaseServerClient/);
  });
});
