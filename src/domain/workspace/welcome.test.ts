import { describe, expect, it } from "vitest";
import {
  parseMemberAddedEvent,
  renderWorkspaceWelcomeEmail,
  resolveWorkspaceWelcome,
  type MemberAddedEvent,
} from "./welcome";

const row = (over: Partial<Parameters<typeof parseMemberAddedEvent>[0]> = {}) => ({
  id: 7,
  action: "workspace_members.insert",
  workspace_id: "ws-1",
  target_id: "5f9d2f6e-1c1a-4b7e-9d3e-2a6b8c0d4e1f",
  actor_id: "admin-uuid",
  created_at: "2026-07-22T12:00:00Z",
  ...over,
});

describe("parseMemberAddedEvent", () => {
  it("parses a member insert row", () => {
    expect(parseMemberAddedEvent(row())).toEqual({
      id: 7,
      workspaceId: "ws-1",
      recipientId: "5f9d2f6e-1c1a-4b7e-9d3e-2a6b8c0d4e1f",
      actorId: "admin-uuid",
      createdAt: "2026-07-22T12:00:00Z",
    });
  });

  it("rejects other actions, missing workspace, and non-uuid targets", () => {
    expect(parseMemberAddedEvent(row({ action: "workspace_members.delete" }))).toBeNull();
    expect(parseMemberAddedEvent(row({ action: "org_tool_access.insert" }))).toBeNull();
    expect(parseMemberAddedEvent(row({ workspace_id: null }))).toBeNull();
    expect(parseMemberAddedEvent(row({ target_id: "someone@anacorp.com" }))).toBeNull();
    expect(parseMemberAddedEvent(row({ target_id: null }))).toBeNull();
  });
});

describe("resolveWorkspaceWelcome", () => {
  const event: MemberAddedEvent = {
    id: 7,
    workspaceId: "ws-1",
    recipientId: "user-1",
    actorId: "admin-1",
    createdAt: "2026-07-22T12:00:00Z",
  };

  it("resolves to a pending welcome for a current member", () => {
    const pending = resolveWorkspaceWelcome(event, {
      isStillMember: true,
      workspaceName: "Anacorp",
      actorName: "Rosendo Lopez",
    });
    expect(pending).toEqual({
      recipientId: "user-1",
      kind: "workspace_welcome",
      workspaceId: "ws-1",
      eventId: 7,
    });
  });

  it("self-cancels when the member was removed or the workspace is gone", () => {
    expect(
      resolveWorkspaceWelcome(event, { isStillMember: false, workspaceName: "Anacorp", actorName: null }),
    ).toBeNull();
    expect(
      resolveWorkspaceWelcome(event, { isStillMember: true, workspaceName: null, actorName: null }),
    ).toBeNull();
  });
});

describe("renderWorkspaceWelcomeEmail", () => {
  const base = { workspaceName: "Anacorp", actorName: "Rosendo Lopez", selfCaused: false, origin: "https://pulse.example.com" };

  it("subject is exact", () => {
    expect(renderWorkspaceWelcomeEmail(base).subject).toBe("Welcome to Anacorp on Pulse");
  });

  it("actor add names the actor; self-caused uses the domain wording", () => {
    expect(renderWorkspaceWelcomeEmail(base).text).toContain("Rosendo Lopez added you to Anacorp.");
    const self = renderWorkspaceWelcomeEmail({ ...base, actorName: null, selfCaused: true });
    expect(self.text).toContain("You joined Anacorp via your company email domain.");
  });

  it("links to the app root in text and html, with the branded shell", () => {
    const out = renderWorkspaceWelcomeEmail(base);
    expect(out.text).toContain("https://pulse.example.com/");
    expect(out.html).toContain('href="https://pulse.example.com/"');
    expect(out.html).toContain(">Pulse</span>");
    expect(out.html).toContain("you were added to this workspace");
  });

  it("escapes user-controlled names", () => {
    const out = renderWorkspaceWelcomeEmail({ ...base, workspaceName: '<b>"Ana"</b>' });
    expect(out.html).not.toContain("<b>");
    expect(out.html).toContain("&lt;b&gt;");
    expect(out.subject).toBe('Welcome to <b>"Ana"</b> on Pulse'); // subjects are plain text, never html-escaped
  });
});
