import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  callerFrom: vi.fn(),
  adminFrom: vi.fn(),
  inviteUserByEmail: vi.fn(),
  generateSetupLink: vi.fn(),
  deliverInvitationEmail: vi.fn(),
  insertInboxRows: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { admin: { inviteUserByEmail: mocks.inviteUserByEmail } },
    from: mocks.adminFrom,
  }),
}));

vi.mock("@/lib/api-auth", () => ({
  createApiRateLimiter: () => () => true,
  requireApiUser: () => Promise.resolve({ userId: "author-1", supabase: { from: mocks.callerFrom, rpc: mocks.rpc }, failure: null }),
}));

vi.mock("@/lib/sop/notifications-drain", () => ({
  createResendSender: () => mocks.send,
}));

vi.mock("@/lib/workspace/invite-delivery", () => ({
  generateSetupLink: mocks.generateSetupLink,
  deliverInvitationEmail: mocks.deliverInvitationEmail,
}));

vi.mock("@/lib/notifications/inbox-writer", () => ({
  insertInboxRows: mocks.insertInboxRows,
}));

import { POST } from "./route";

function nominateRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost:3000/api/sops/reviewers/nominate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sopId: "sop-1",
      departmentId: "dept-prd",
      email: " New.Reviewer@AnaCorp.com ",
      positionTitle: "Line Lead",
      ...overrides,
    }),
  });
}

/** A chainable query stub resolving to `result` for any terminal call. */
function query(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "maybeSingle"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  chain.maybeSingle = () => Promise.resolve(result);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.RESEND_API_KEY = "resend-key";
  process.env.RESEND_FROM = "Pulse <notifications@example.com>";
  process.env.NEXT_PUBLIC_SITE_URL = "https://pulse.anacorp.com";
  process.env.NOTIFICATION_EMAIL_REDIRECT_TO = "";

  mocks.callerFrom.mockImplementation((table: string) => {
    if (table === "departments") return query({ data: { id: "dept-prd", name: "Production", workspace_id: "ws-1" }, error: null });
    if (table === "workspaces") return query({ data: { name: "ANA Corp" }, error: null });
    throw new Error(`unexpected caller table ${table}`);
  });
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table === "workspace_members") return query({ data: [{ user_id: "owner-1" }, { user_id: "author-1" }], error: null });
    if (table === "profiles") return query({ data: { full_name: "Ana Author" }, error: null });
    throw new Error(`unexpected admin table ${table}`);
  });
  mocks.rpc.mockImplementation((name: string) => {
    if (name === "nominate_department_reviewer") return Promise.resolve({ data: { mode: "invite", user_id: "u-6" }, error: null });
    if (name === "mint_pending_department_reviewer") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
  });
  mocks.generateSetupLink.mockResolvedValue({ kind: "link", tokenHash: "hash-1", type: "invite", userId: "u-6" });
  mocks.deliverInvitationEmail.mockResolvedValue(true);
  mocks.insertInboxRows.mockResolvedValue(true);
});

describe("POST /api/sops/reviewers/nominate", () => {
  it("rejects a malformed body", async () => {
    const response = await POST(nominateRequest({ email: "not-an-email" }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("surfaces the database's refusal verbatim", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "You can only invite reviewers into your own department." } });
    const response = await POST(nominateRequest());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "You can only invite reviewers into your own department." });
  });

  it("adds an existing member with no email and tells the other managers", async () => {
    mocks.rpc.mockImplementationOnce(() => Promise.resolve({ data: { mode: "added", user_id: "u-5" }, error: null }));
    const response = await POST(nominateRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ mode: "added", userId: "u-5", emailSent: false, seated: true });
    expect(mocks.generateSetupLink).not.toHaveBeenCalled();
    expect(mocks.insertInboxRows).toHaveBeenCalledTimes(1);
    const rows = mocks.insertInboxRows.mock.calls[0][1] as { recipientId: string; kind: string; link: string }[];
    expect(rows.map((row) => row.recipientId)).toEqual(["owner-1"]);
    expect(rows[0]).toMatchObject({ kind: "reviewer_nominated", link: "/sops/sop-1" });
  });

  it("invites a known auth user: sends the setup link, mints the provisional seat, normalizes the email", async () => {
    const response = await POST(nominateRequest());
    await expect(response.json()).resolves.toEqual({ mode: "invite", userId: "u-6", emailSent: true, seated: true });
    expect(mocks.rpc).toHaveBeenCalledWith("nominate_department_reviewer", {
      p_department_id: "dept-prd",
      p_email: "new.reviewer@anacorp.com",
      p_position_title: "Line Lead",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("mint_pending_department_reviewer", { p_department_id: "dept-prd", p_user_id: "u-6" });
    expect(mocks.deliverInvitationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.deliverInvitationEmail.mock.calls[0][3]).toMatchObject({ kind: "invite", workspaceId: "ws-1" });
  });

  it("invites a brand-new address: the user id comes from the setup link", async () => {
    mocks.rpc.mockImplementationOnce(() => Promise.resolve({ data: { mode: "invite", user_id: null }, error: null }));
    mocks.generateSetupLink.mockResolvedValueOnce({ kind: "link", tokenHash: "hash-2", type: "invite", userId: "new-1" });
    const response = await POST(nominateRequest());
    await expect(response.json()).resolves.toEqual({ mode: "invite", userId: "new-1", emailSent: true, seated: true });
    expect(mocks.rpc).toHaveBeenCalledWith("mint_pending_department_reviewer", { p_department_id: "dept-prd", p_user_id: "new-1" });
  });

  it("reports an unseated invite when the mint fails, without hiding that the email went out", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "nominate_department_reviewer") return Promise.resolve({ data: { mode: "invite", user_id: "u-6" }, error: null });
      return Promise.resolve({ data: null, error: { message: "No matching invitation from you for that person." } });
    });
    const response = await POST(nominateRequest());
    await expect(response.json()).resolves.toEqual({
      mode: "invite",
      userId: "u-6",
      emailSent: true,
      seated: false,
      error: "No matching invitation from you for that person.",
    });
  });

  it("falls back to Supabase mail when Resend is not configured", async () => {
    process.env.RESEND_API_KEY = "";
    mocks.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "u-6" } }, error: null });
    const response = await POST(nominateRequest());
    await expect(response.json()).resolves.toEqual({ mode: "invite", userId: "u-6", emailSent: true, seated: true });
    expect(mocks.generateSetupLink).not.toHaveBeenCalled();
  });
});
