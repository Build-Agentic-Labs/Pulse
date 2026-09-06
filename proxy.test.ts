import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser } }),
}));

import { proxy } from "./proxy";

describe("proxy host handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pulse.agenticlabs.studio");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects a production vercel.app host to the canonical domain with a permanent redirect", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await proxy(
      new NextRequest("https://buildlogic-line-planner-abc-team.vercel.app/settings?section=account"),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://pulse.agenticlabs.studio/settings?section=account");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("serves the canonical host normally", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await proxy(new NextRequest("https://pulse.agenticlabs.studio/settings"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("serves preview deployments on their own host", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const response = await proxy(new NextRequest("https://buildlogic-line-planner-git-x-team.vercel.app/"));
    expect(response.status).toBe(200);
  });
});
