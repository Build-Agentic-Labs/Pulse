import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}));

import { proxy } from "../../proxy";

describe("proxy session refresh", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("continues the route when an expired-session refresh throws", async () => {
    const getUser = vi.fn().mockRejectedValue(new Error("network offline"));
    createServerClientMock.mockReturnValue({ auth: { getUser } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const request = new NextRequest("http://localhost/sops/example", {
      headers: { cookie: "sb-test-auth-token=invalid-session-cookie" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(getUser).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "Supabase session refresh failed in proxy; continuing request.",
      expect.any(Error),
    );
  });

  it("does not contact auth when there is no session cookie", async () => {
    const getUser = vi.fn();
    createServerClientMock.mockReturnValue({ auth: { getUser } });

    const response = await proxy(new NextRequest("http://localhost/sops/example"));

    expect(response.status).toBe(200);
    expect(getUser).not.toHaveBeenCalled();
  });
});
