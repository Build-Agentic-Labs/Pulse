import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_NOTIFIABLE_ACTIONS,
  parseMembershipEvent,
  renderMembershipEmail,
  resolveMembershipNotification,
} from "./membership-notifications";

const INVITER = "3a000000-0000-0000-0000-000000000001";
const MEMBER = "3a000000-0000-0000-0000-000000000002";

const row = (over: Partial<Parameters<typeof parseMembershipEvent>[0]> = {}) => ({
  id: 120,
  action: "workspace_members.update",
  workspace_id: "ws-1",
  target_id: MEMBER,
  actor_id: INVITER,
  details: { old: { role: "viewer" }, new: { role: "admin" } },
  created_at: "2026-09-04T12:00:00Z",
  ...over,
});

describe("parseMembershipEvent", () => {
  it("lists the audit actions the store must scan", () => {
    expect([...MEMBERSHIP_NOTIFIABLE_ACTIONS].sort()).toEqual(
      ["workspace_access_grants.update", "workspace_members.delete", "workspace_members.insert", "workspace_members.update"].sort(),
    );
  });

  it("a role change names the member, both roles, and the actor", () => {
    expect(parseMembershipEvent(row())).toEqual({
      id: 120,
      kind: "role_changed",
      workspaceId: "ws-1",
      recipientId: MEMBER,
      actorId: INVITER,
      createdAt: "2026-09-04T12:00:00Z",
      role: "admin",
      previousRole: "viewer",
    });
  });

  it("a member update that did not change the role is not a notification", () => {
    expect(parseMembershipEvent(row({ details: { old: { role: "admin" }, new: { role: "admin" } } }))).toBeNull();
  });

  it("a removal names the removed member", () => {
    expect(parseMembershipEvent(row({ action: "workspace_members.delete", details: { old: { role: "editor" } } }))).toMatchObject({
      kind: "member_removed",
      recipientId: MEMBER,
      actorId: INVITER,
    });
  });

  it("an invite redemption notifies the inviter, never a self-redeemer", () => {
    const redeemed = row({
      action: "workspace_access_grants.update",
      target_id: "invitee@anacorp.com",
      actor_id: MEMBER,
      details: {
        old: { redeemed_at: null, granted_by: INVITER, email: "invitee@anacorp.com" },
        new: { redeemed_at: "2026-09-04T12:00:00Z", redeemed_by: MEMBER, granted_by: INVITER, email: "invitee@anacorp.com" },
      },
    });
    expect(parseMembershipEvent(redeemed)).toEqual({
      id: 120,
      kind: "invite_accepted",
      workspaceId: "ws-1",
      recipientId: INVITER,
      actorId: MEMBER,
      createdAt: "2026-09-04T12:00:00Z",
      inviteeEmail: "invitee@anacorp.com",
    });
    const details = redeemed.details as { old: Record<string, unknown>; new: Record<string, unknown> };
    const selfRedeemed = { ...redeemed, details: { ...details, new: { ...details.new, granted_by: MEMBER } } };
    expect(parseMembershipEvent(selfRedeemed)).toBeNull();
    const alreadyRedeemed = { ...redeemed, details: { ...details, old: { redeemed_at: "2026-09-01T00:00:00Z" } } };
    expect(parseMembershipEvent(alreadyRedeemed)).toBeNull();
    const notRedeemed = { ...redeemed, details: { old: { redeemed_at: null }, new: { redeemed_at: null, granted_by: INVITER } } };
    expect(parseMembershipEvent(notRedeemed)).toBeNull();
  });

  it("leaves inserts to the welcome path and ignores other tables", () => {
    expect(parseMembershipEvent(row({ action: "workspace_members.insert" }))).toBeNull();
    expect(parseMembershipEvent(row({ action: "project_access.update" }))).toBeNull();
    expect(parseMembershipEvent(row({ workspace_id: null }))).toBeNull();
  });
});

describe("resolveMembershipNotification", () => {
  const roleChanged = parseMembershipEvent(row())!;

  it("a role change or an accepted invite needs the recipient to still be a member", () => {
    expect(resolveMembershipNotification(roleChanged, { recipientIsMember: true, workspaceName: "Anacorp" })).toEqual({
      recipientId: MEMBER,
      kind: "role_changed",
      workspaceId: "ws-1",
      eventId: 120,
    });
    expect(resolveMembershipNotification(roleChanged, { recipientIsMember: false, workspaceName: "Anacorp" })).toBeNull();
  });

  it("a removal needs the recipient to still be gone", () => {
    const removed = parseMembershipEvent(row({ action: "workspace_members.delete", details: { old: { role: "editor" } } }))!;
    expect(resolveMembershipNotification(removed, { recipientIsMember: false, workspaceName: "Anacorp" })).toMatchObject({ kind: "member_removed" });
    expect(resolveMembershipNotification(removed, { recipientIsMember: true, workspaceName: "Anacorp" })).toBeNull();
  });

  it("a vanished workspace cancels everything", () => {
    expect(resolveMembershipNotification(roleChanged, { recipientIsMember: true, workspaceName: null })).toBeNull();
  });
});

describe("renderMembershipEmail", () => {
  const base = { workspaceName: "Anacorp", actorName: "Ada Admin", origin: "https://pulse.example.com" };

  it("subjects say what happened", () => {
    expect(renderMembershipEmail({ ...base, kind: "role_changed", role: "admin" }).subject).toBe("Your role in Anacorp changed to Admin");
    expect(renderMembershipEmail({ ...base, kind: "member_removed" }).subject).toBe("You were removed from Anacorp");
    expect(renderMembershipEmail({ ...base, kind: "invite_accepted", inviteeEmail: "x@anacorp.com" }).subject).toBe(
      "x@anacorp.com accepted your invitation to Anacorp",
    );
  });

  it("names the actor when known and degrades when not", () => {
    expect(renderMembershipEmail({ ...base, kind: "role_changed", role: "editor" }).text).toContain("Ada Admin changed your role");
    expect(renderMembershipEmail({ ...base, actorName: null, kind: "member_removed" }).text).toContain("An administrator removed you");
  });

  it("escapes user-controlled text in html", () => {
    const out = renderMembershipEmail({ ...base, kind: "invite_accepted", inviteeEmail: "<b>x</b>@anacorp.com" });
    expect(out.html).not.toContain("<b>x");
    expect(out.html).toContain("&lt;b&gt;");
  });
});
