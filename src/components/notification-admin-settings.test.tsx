// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationAdminSettings } from "./notification-admin-settings";

vi.mock("@/domain/supabase-planner", () => ({
  createPlannerSupabaseClient: () => ({}),
  loadWorkspaceProjectGroups: vi.fn(async () => [{ workspace: { id: "ws-1", name: "Anacorp" }, role: "owner", projects: [] }]),
}));

vi.mock("@/lib/supabase-auth", () => ({
  resolveSupabaseSession: vi.fn(async () => ({ session: { user: { id: "u1" }, access_token: "tok" } })),
}));

vi.mock("@/lib/notifications/integrations-store", () => ({
  saveTeamsIntegration: vi.fn(async () => undefined),
}));

const overview = {
  health: { healthy: false, problems: ["cron has not run for 30h (threshold 26h)"], lastCronAt: "2026-09-03T09:00:00Z" },
  runs: [{ id: 1, caller: "kick", startedAt: "2026-09-04T14:00:00Z", finishedAt: "2026-09-04T14:00:01Z", healthy: true, problems: [], report: {} }],
  ledger: [
    { id: 8, ledger: "sop_notifications", kind: "review_complete", state: "dead", recipientName: "Tomas Bach", recipientEmail: "tomas@anacorp.com", subject: "Ready for final approval · SOP-0042", createdAt: "2026-09-03T12:00:00Z", sentAt: null, attempts: 3, lastError: "422: Invalid `to` field", skippedReason: null, deliveryStatus: null },
  ],
  transactional: [],
  suppressions: [],
  integration: null,
};

describe("NotificationAdminSettings", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ ok: true, revived: true }), { status: 200 });
      return new Response(JSON.stringify(overview), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the health verdict and a dead ledger row with a Resend action", async () => {
    render(<NotificationAdminSettings />);
    expect(await screen.findByText(/cron has not run for 30h/)).toBeTruthy();
    expect(screen.getByText("Tomas Bach")).toBeTruthy();
    expect(screen.getByText("dead")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    await screen.findByText(/Queued for the next drain/);
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(post).toBeTruthy();
    expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({
      workspaceId: "ws-1",
      action: "resend",
      ledger: "sop_notifications",
      id: 8,
    });
  });
});
