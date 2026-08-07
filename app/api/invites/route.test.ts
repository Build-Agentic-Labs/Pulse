import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  generateLink: vi.fn(),
  grantUpsert: vi.fn(),
  inviteUserByEmail: vi.fn(),
  rpc: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: {
        generateLink: mocks.generateLink,
        inviteUserByEmail: mocks.inviteUserByEmail,
      },
    },
  }),
}));

vi.mock("@/lib/api-auth", () => ({
  callerScopedSupabase: () => ({ from: mocks.from, rpc: mocks.rpc }),
  createApiRateLimiter: () => () => true,
  getBearerToken: () => "caller-token",
  requireApiUser: () => Promise.resolve({ userId: "manager-1" }),
}));

vi.mock("@/lib/sop/notifications-drain", () => ({
  createResendSender: () => mocks.send,
}));

import { POST } from "./route";

function inviteRequest() {
  return new Request("http://localhost:3000/api/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: "workspace-1",
      email: " First.User@anacorp.com ",
      role: "editor",
    }),
  });
}

describe("Quality Module invite route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    process.env.RESEND_API_KEY = "resend-key";
    process.env.RESEND_FROM = "Pulse <notifications@example.com>";
    process.env.NEXT_PUBLIC_SITE_URL = "https://pulse.anacorp.com";

    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const revocationQuery = {
      delete() {
        return this;
      },
      eq() {
        return this;
      },
      then(resolve: (value: { error: null }) => unknown) {
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    mocks.grantUpsert.mockResolvedValue({ error: null });
    mocks.from.mockImplementation((table: string) =>
      table === "workspace_revocations"
        ? revocationQuery
        : { upsert: mocks.grantUpsert },
    );
  });

  it("creates the first user, emails the secure action link, and assigns Editor access", async () => {
    mocks.generateLink.mockResolvedValue({
      data: {
        properties: {
          action_link: "https://project.supabase.co/auth/v1/verify?token=secure-invite",
        },
      },
      error: null,
    });
    mocks.send.mockResolvedValue({ ok: true, id: "email-1" });

    const response = await POST(inviteRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ granted: true, emailSent: true });
    expect(mocks.grantUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "first.user@anacorp.com",
        quality_access: "edit",
        role: "editor",
      }),
      { onConflict: "workspace_id,email" },
    );
    expect(mocks.generateLink).toHaveBeenCalledWith({
      type: "invite",
      email: "first.user@anacorp.com",
      options: { redirectTo: "https://pulse.anacorp.com/?invite=1" },
    });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0]?.[0]).toBe("first.user@anacorp.com");
    expect(mocks.send.mock.calls[0]?.[1].html).toContain("first.user@anacorp.com");
    expect(mocks.send.mock.calls[0]?.[1].html).toContain("secure-invite");
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
  });
});
