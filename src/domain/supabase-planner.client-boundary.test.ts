// @vitest-environment jsdom
// Characterization of the planner client in the browser: one shared client per page (kept on
// globalThis), the one-time legacy localStorage session bridge, the session-user helper, and the
// missing-configuration error. The server trap is covered by supabase-planner.server-guard.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseBrowserClient } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  return { createSupabaseBrowserClient: vi.fn() };
});
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient }));

const globalScope = globalThis as { __buildlogicPlannerSupabaseClient?: unknown };
function fakeClient() {
  return { auth: { setSession: vi.fn(async () => ({ data: {}, error: null })) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete globalScope.__buildlogicPlannerSupabaseClient;
  localStorage.clear();
  document.cookie.split(";").forEach((part) => {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
});

describe("browser planner client", () => {
  it("creates one client per page and keeps returning it", async () => {
    const client = fakeClient();
    createSupabaseBrowserClient.mockReturnValue(client);
    const { createPlannerSupabaseClient } = await import("./supabase-planner");
    expect(createPlannerSupabaseClient()).toBe(client);
    expect(createPlannerSupabaseClient()).toBe(client);
    expect(createSupabaseBrowserClient).toHaveBeenCalledTimes(1);
    expect(globalScope.__buildlogicPlannerSupabaseClient).toBe(client);
  });

  it("uses a client already present on the page", async () => {
    const existing = fakeClient();
    globalScope.__buildlogicPlannerSupabaseClient = existing;
    const { createPlannerSupabaseClient } = await import("./supabase-planner");
    expect(createPlannerSupabaseClient()).toBe(existing);
    expect(createSupabaseBrowserClient).not.toHaveBeenCalled();
  });

  it("moves a legacy localStorage session to the new client once, and only when no cookie session exists", async () => {
    const client = fakeClient();
    createSupabaseBrowserClient.mockReturnValue(client);
    localStorage.setItem("sb-ref-auth-token", JSON.stringify({ access_token: "access", refresh_token: "refresh" }));
    const { createPlannerSupabaseClient } = await import("./supabase-planner");
    createPlannerSupabaseClient();
    expect(client.auth.setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
    expect(localStorage.getItem("sb-ref-auth-token")).toBeNull();

    delete globalScope.__buildlogicPlannerSupabaseClient;
    const second = fakeClient();
    createSupabaseBrowserClient.mockReturnValue(second);
    document.cookie = "sb-ref-auth-token=cookie-session; path=/";
    localStorage.setItem("sb-ref-auth-token", JSON.stringify({ access_token: "older", refresh_token: "older" }));
    createPlannerSupabaseClient();
    expect(second.auth.setSession).not.toHaveBeenCalled();
    expect(localStorage.getItem("sb-ref-auth-token")).not.toBeNull();
  });

  it("reads the session user locally and never calls the auth server", async () => {
    const { getUserFromSession } = await import("./supabase-planner");
    const getUser = vi.fn();
    const signedIn = { auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }), getUser } };
    const signedOut = { auth: { getSession: async () => ({ data: { session: null } }), getUser } };
    expect(await getUserFromSession(signedIn as never)).toEqual({ data: { user: { id: "user-1" } }, error: null });
    expect(await getUserFromSession(signedOut as never)).toEqual({ data: { user: null }, error: null });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("fails clearly when the Supabase configuration is missing", async () => {
    vi.resetModules();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      const { createPlannerSupabaseClient } = await import("./supabase-planner");
      expect(() => createPlannerSupabaseClient()).toThrow("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      vi.resetModules();
    }
  });
});
