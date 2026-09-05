import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS, kindLabel, resolveEmailEnabled, type PreferenceRow } from "./channels";

describe("NOTIFICATION_KINDS", () => {
  it("catalogs every SOP, workspace, and digest kind with a human label", () => {
    expect(Object.keys(NOTIFICATION_KINDS).sort()).toEqual(
      [
        "review_requested",
        "final_approval_requested",
        "quality_release_requested",
        "sent_back",
        "review_complete",
        "released",
        "seat_assigned",
        "objection_raised",
        "objection_resolved",
        "remark_added",
        "stall_escalated",
        "workspace_welcome",
        "invite_accepted",
        "role_changed",
        "member_removed",
        "stalled_weekly",
      ].sort(),
    );
    for (const entry of Object.values(NOTIFICATION_KINDS)) expect(entry.label.length).toBeGreaterThan(0);
  });

  it("defaults remarks to inbox-only and every workflow kind to email", () => {
    expect(NOTIFICATION_KINDS.remark_added.defaultEmail).toBe(false);
    expect(NOTIFICATION_KINDS.review_requested.defaultEmail).toBe(true);
    expect(NOTIFICATION_KINDS.stalled_weekly.defaultEmail).toBe(true);
  });

  it("labels an unknown kind by its name rather than crashing", () => {
    expect(kindLabel("review_requested")).toBe("Review requested");
    expect(kindLabel("something_new")).toBe("something new");
  });
});

describe("resolveEmailEnabled", () => {
  const off = (kind: string, workspaceId = ""): PreferenceRow => ({ workspaceId, kind, channel: "email", mode: "off" });
  const on = (kind: string, workspaceId = ""): PreferenceRow => ({ workspaceId, kind, channel: "email", mode: "immediate" });

  it("uses the catalog default when the user has said nothing", () => {
    expect(resolveEmailEnabled("review_requested", "ws-1", [])).toBe(true);
    expect(resolveEmailEnabled("remark_added", "ws-1", [])).toBe(false);
  });

  it("honours a global switch", () => {
    expect(resolveEmailEnabled("review_requested", "ws-1", [off("review_requested")])).toBe(false);
    expect(resolveEmailEnabled("remark_added", "ws-1", [on("remark_added")])).toBe(true);
  });

  it("lets a workspace-specific preference override the global one", () => {
    const prefs = [off("review_requested"), on("review_requested", "ws-1")];
    expect(resolveEmailEnabled("review_requested", "ws-1", prefs)).toBe(true);
    expect(resolveEmailEnabled("review_requested", "ws-2", prefs)).toBe(false);
  });

  it("ignores preferences for other channels and other kinds", () => {
    const prefs: PreferenceRow[] = [
      { workspaceId: "", kind: "review_requested", channel: "teams", mode: "off" },
      { workspaceId: "", kind: "sent_back", channel: "email", mode: "off" },
    ];
    expect(resolveEmailEnabled("review_requested", "ws-1", prefs)).toBe(true);
  });

  it("treats an unknown kind as email-on so a new kind is never silently muted", () => {
    expect(resolveEmailEnabled("brand_new_kind", "ws-1", [])).toBe(true);
  });
});
