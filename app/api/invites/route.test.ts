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

function inviteRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost:3000/api/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: "workspace-1",
      email: " First.User@anacorp.com ",
      organizationRole: "member",
      accessPackage: "industrial_engineer",
      qualityAccess: "edit",
      planningAccess: true,
      projectAccess: [{ projectId: "project-1", level: "edit" }],
      departmentAccess: [
        { departmentId: "department-1", role: "author", positionTitle: "Industrial Engineer" },
      ],
      ...overrides,
    }),
  });
}

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
  const workspaceQuery = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({ data: { name: "ANA Corp" }, error: null });
    },
  };
  const projectsQuery = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return Promise.resolve({ data: [{ id: "project-1", name: "FlexBoost" }], error: null });
    },
  };
  const departmentsQuery = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return Promise.resolve({ data: [{ id: "department-1", name: "Process Engineering" }], error: null });
    },
  };
  mocks.grantUpsert.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table === "workspace_revocations") return revocationQuery;
    if (table === "workspaces") return workspaceQuery;
    if (table === "projects") return projectsQuery;
    if (table === "departments") return departmentsQuery;
    return { upsert: mocks.grantUpsert };
  });
});

describe("workspace invite route", () => {

  it("stores the reviewed entitlement snapshot and emails the secure action link", async () => {
    mocks.generateLink.mockResolvedValue({
      data: {
        properties: {
          action_link: "https://project.supabase.co/auth/v1/verify?token=secure-invite",
          hashed_token: "secure-invite-hash",
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
        access_package: "industrial_engineer",
        department_access: [
          { department_id: "department-1", role: "author", position_title: "Industrial Engineer" },
        ],
        planning_access: true,
        project_access: [{ project_id: "project-1", level: "edit" }],
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
    expect(mocks.send.mock.calls[0]?.[1].html).toContain("Process Engineering: Create · Industrial Engineer");
    expect(mocks.send.mock.calls[0]?.[1].html).toContain("FlexBoost: Edit");
    expect(mocks.send.mock.calls[0]?.[1].html).toContain(
      "https://pulse.anacorp.com/invite#email=first.user%40anacorp.com&token_hash=secure-invite-hash&type=invite",
    );
    expect(mocks.send.mock.calls[0]?.[1].html).not.toContain("project.supabase.co/auth/v1/verify");
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("requires an owner before elevating an invitee to Admin", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });

    const response = await POST(inviteRequest({ organizationRole: "admin" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Only an owner can invite another admin." });
    expect(mocks.grantUpsert).not.toHaveBeenCalled();
  });

  it("rejects a workflow duty without a valid job title", async () => {
    const response = await POST(
      inviteRequest({
        departmentAccess: [{ departmentId: "department-1", role: "author", positionTitle: "" }],
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.grantUpsert).not.toHaveBeenCalled();
  });
});

describe("workspace invite route — resend to a pending invitee", () => {
  // GoTrue's response when generateLink(type: "invite") targets an email that already
  // has an auth.users row — which is every invitee after their FIRST invite.
  const emailExists = {
    data: { properties: null, user: null },
    error: Object.assign(new Error("A user with this email address has already been registered"), {
      status: 422,
      code: "email_exists",
    }),
  };

  it("re-sends a setup email to someone who was invited but never signed in", async () => {
    mocks.generateLink.mockImplementation(async ({ type }: { type: string }) => {
      if (type === "invite") return emailExists;
      return {
        data: {
          properties: { hashed_token: "recovery-hash" },
          user: { id: "user-1", email: "first.user@anacorp.com", email_confirmed_at: null, last_sign_in_at: null },
        },
        error: null,
      };
    });
    mocks.send.mockResolvedValue({ ok: true, id: "email-2" });

    const response = await POST(inviteRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ granted: true, emailSent: true });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0]?.[1].html).toContain(
      "https://pulse.anacorp.com/invite#email=first.user%40anacorp.com&token_hash=recovery-hash&type=recovery",
    );
  });

  it("does not email someone who already finished setup and signed in", async () => {
    mocks.generateLink.mockImplementation(async ({ type }: { type: string }) => {
      if (type === "invite") return emailExists;
      return {
        data: {
          properties: { hashed_token: "recovery-hash" },
          user: {
            id: "user-1",
            email: "first.user@anacorp.com",
            email_confirmed_at: "2026-08-01T00:00:00Z",
            last_sign_in_at: "2026-08-02T00:00:00Z",
          },
        },
        error: null,
      };
    });

    const response = await POST(inviteRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ granted: true, emailSent: false, alreadyRegistered: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
