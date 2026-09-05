import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Characterization tests: pin the current auth contract before any of it moves
// (cookie sessions, server-side reads). The single most important invariant here
// is that callerScopedSupabase forwards the caller's bearer token — silently
// losing it downgrades every RLS-scoped query to anon and blanks or leaks data.

const createClientMock = vi.fn();
const createServerClientMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}));

import { callerScopedSupabase, createApiRateLimiter, getBearerToken, requireApiUser } from "./api-auth";

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  createClientMock.mockReset();
  createServerClientMock.mockReset();
  createServerClientMock.mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  vi.useRealTimers();
});

function requestWithAuth(header?: string) {
  return new Request("http://localhost/api/test", {
    headers: header === undefined ? {} : { authorization: header },
  });
}

describe("getBearerToken", () => {
  it("extracts the token from a Bearer header", () => {
    expect(getBearerToken(requestWithAuth("Bearer abc123"))).toBe("abc123");
  });

  it("accepts any casing of the Bearer scheme", () => {
    expect(getBearerToken(requestWithAuth("bearer abc123"))).toBe("abc123");
    expect(getBearerToken(requestWithAuth("BEARER abc123"))).toBe("abc123");
  });

  it("returns empty string for missing or malformed headers", () => {
    expect(getBearerToken(requestWithAuth())).toBe("");
    expect(getBearerToken(requestWithAuth("Bearer"))).toBe("");
    expect(getBearerToken(requestWithAuth("Token abc123"))).toBe("");
    expect(getBearerToken(requestWithAuth(""))).toBe("");
  });
});

describe("callerScopedSupabase", () => {
  it("forwards the caller's bearer token as the Authorization header (the RLS-scoping invariant)", () => {
    createClientMock.mockReturnValue({ tag: "client" });

    callerScopedSupabase("caller-token");

    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [url, anonKey, options] = createClientMock.mock.calls[0] as [
      string,
      string,
      { auth: Record<string, unknown>; global: { headers: Record<string, string> } },
    ];
    expect(url).toBe("https://example.supabase.co");
    expect(anonKey).toBe("anon-key");
    expect(options.global.headers.Authorization).toBe("Bearer caller-token");
  });

  it("creates a sessionless client (no persistence, no refresh)", () => {
    createClientMock.mockReturnValue({ tag: "client" });

    callerScopedSupabase("caller-token");

    const options = createClientMock.mock.calls[0][2] as {
      auth: { autoRefreshToken: boolean; persistSession: boolean };
    };
    expect(options.auth.autoRefreshToken).toBe(false);
    expect(options.auth.persistSession).toBe(false);
  });
});

describe("requireApiUser", () => {
  it("returns 503 when Supabase env vars are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const result = await requireApiUser(requestWithAuth("Bearer abc"));

    expect(result.userId).toBeNull();
    expect(result.failure?.status).toBe(503);
  });

  it("returns 401 when no bearer token is present", async () => {
    const result = await requireApiUser(requestWithAuth());

    expect(result.userId).toBeNull();
    expect(result.failure?.status).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the token does not verify", async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "bad token" } });
    createClientMock.mockReturnValue({ auth: { getUser } });

    const result = await requireApiUser(requestWithAuth("Bearer expired-token"));

    expect(getUser).toHaveBeenCalledWith("expired-token");
    expect(result.userId).toBeNull();
    expect(result.failure?.status).toBe(401);
  });

  it("verifies the token against Supabase auth and returns the user id", async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "user-42" } }, error: null });
    createClientMock.mockReturnValue({ auth: { getUser } });

    const result = await requireApiUser(requestWithAuth("Bearer good-token"));

    expect(getUser).toHaveBeenCalledWith("good-token");
    expect(result.userId).toBe("user-42");
    expect(result.supabase).toBe(createClientMock.mock.results[0].value);
    expect(result.failure).toBeNull();
  });

  it("falls back to a cookie session when no bearer header is present", async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "cookie-user" } }, error: null });
    createServerClientMock.mockReturnValue({ auth: { getUser } });

    const request = new Request("http://localhost/api/test", {
      headers: { cookie: "sb-ref-auth-token.0=abc; sb-ref-auth-token.1=def; other=1" },
    });
    const result = await requireApiUser(request);

    expect(result.userId).toBe("cookie-user");
    expect(result.failure).toBeNull();
    expect(result.supabase).toBe(createServerClientMock.mock.results[0].value);
    // The cookie client received the parsed request cookies.
    const options = createServerClientMock.mock.calls[0][2] as {
      cookies: { getAll: () => Array<{ name: string; value: string }> };
    };
    expect(options.cookies.getAll()).toContainEqual({ name: "sb-ref-auth-token.0", value: "abc" });
  });

  it.each(["Bearer", "Bearer a b", "Basic abc", ""])(
    "rejects malformed authorization %j even with valid cookies",
    async (authorization) => {
      const request = new Request("http://localhost/api/test", {
        headers: { authorization, cookie: "sb-ref-auth-token=valid" },
      });
      const result = await requireApiUser(request);
      expect(result.failure?.status).toBe(401);
      expect(result.supabase).toBeNull();
      expect(createServerClientMock).not.toHaveBeenCalled();
    },
  );

  it("does NOT substitute a cookie session for an explicitly-presented invalid bearer token", async () => {
    const bearerGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    createClientMock.mockReturnValue({ auth: { getUser: bearerGetUser } });
    const cookieGetUser = vi.fn().mockResolvedValue({ data: { user: { id: "cookie-user" } }, error: null });
    createServerClientMock.mockReturnValue({ auth: { getUser: cookieGetUser } });

    const request = new Request("http://localhost/api/test", {
      headers: { authorization: "Bearer expired", cookie: "sb-ref-auth-token.0=abc" },
    });
    const result = await requireApiUser(request);

    expect(result.userId).toBeNull();
    expect(result.failure?.status).toBe(401);
    expect(cookieGetUser).not.toHaveBeenCalled();
  });
});

describe("createApiRateLimiter", () => {
  it("allows up to maxRequests within the window, then blocks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const check = createApiRateLimiter({ windowMs: 60_000, maxRequests: 3 });

    expect(check("user-1")).toBe(true);
    expect(check("user-1")).toBe(true);
    expect(check("user-1")).toBe(true);
    expect(check("user-1")).toBe(false);
  });

  it("tracks callers independently", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const check = createApiRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    expect(check("user-1")).toBe(true);
    expect(check("user-1")).toBe(false);
    expect(check("user-2")).toBe(true);
  });

  it("resets the bucket after the window elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const check = createApiRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    expect(check("user-1")).toBe(true);
    expect(check("user-1")).toBe(false);

    vi.setSystemTime(60_001);
    expect(check("user-1")).toBe(true);
  });
});
