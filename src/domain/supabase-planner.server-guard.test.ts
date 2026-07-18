import { describe, expect, it } from "vitest";

// Runs in the node project (no `window`), i.e. exactly the server environment the
// guard exists for. Before Stage 4, calling the planner client here returned a
// sessionless anon singleton whose RLS-scoped reads all returned zero rows — pages
// rendered empty instead of erroring. The guard converts that silent failure into
// a loud one while still allowing CONSTRUCTION, because client components build
// the client in render-time useMemo during SSR and only use it in effects.

describe("createPlannerSupabaseClient on the server", () => {
  it("allows construction (client-component SSR) but throws on any real use", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    const { createPlannerSupabaseClient } = await import("./supabase-planner");

    expect(typeof window).toBe("undefined");
    const client = createPlannerSupabaseClient();

    expect(() => client.auth).toThrowError(/browser-only[\s\S]*createSupabaseServerClient/);
    expect(() => client.from("sops")).toThrowError(/browser-only[\s\S]*createSupabaseServerClient/);
  });

  it("answers framework probes (thenable checks, symbols) without throwing", async () => {
    const { createPlannerSupabaseClient } = await import("./supabase-planner");
    const client = createPlannerSupabaseClient() as unknown as Record<PropertyKey, unknown>;

    expect(client.then).toBeUndefined();
    expect(client[Symbol.toPrimitive]).toBeUndefined();
  });
});
