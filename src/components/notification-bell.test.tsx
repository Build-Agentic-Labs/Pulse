// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_QUEUE } from "@/lib/sop/review-queue-data";
import { NotificationBell } from "./notification-bell";

const push = vi.fn();
const markInboxRead = vi.fn(async () => 1);
const markAllInboxRead = vi.fn(async () => 2);
const listInbox = vi.fn(async () => [
  { id: 2, kind: "review_complete", title: "Ready for final approval: SOP-0042", body: "Every reviewer responded.", link: "/sops/s1", createdAt: "2026-09-04T10:00:00Z", readAt: null, workspaceId: "ws-1" },
  { id: 1, kind: "review_requested", title: "Review requested: SOP-0041", body: "", link: "/sops/s0", createdAt: "2026-09-03T10:00:00Z", readAt: "2026-09-03T11:00:00Z", workspaceId: "ws-1" },
]);
const resolveSupabaseSession = vi.fn(() => new Promise<unknown>(() => undefined));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/domain/supabase-planner", () => ({
  createPlannerSupabaseClient: () => ({}),
  loadWorkspaceProjectGroups: vi.fn(async () => [{ workspace: { id: "ws-1" } }]),
}));

vi.mock("@/lib/sop/review-queue-data", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sop/review-queue-data")>();
  return { ...original, fetchReviewQueueData: vi.fn(async () => original.EMPTY_QUEUE) };
});

vi.mock("@/lib/notifications/inbox-store", () => ({
  listInbox: (...args: unknown[]) => listInbox(...(args as [])),
  markInboxRead: (...args: unknown[]) => markInboxRead(...(args as [])),
  markAllInboxRead: (...args: unknown[]) => markAllInboxRead(...(args as [])),
}));

vi.mock("@/lib/supabase-auth", () => ({
  resolveSupabaseSession: (...args: unknown[]) => resolveSupabaseSession(...(args as [])),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    push.mockClear();
    markInboxRead.mockClear();
    markAllInboxRead.mockClear();
    window.localStorage.clear();
  });

  it("renders its persistent chrome before notification data resolves", () => {
    resolveSupabaseSession.mockImplementationOnce(() => new Promise(() => undefined));
    render(<NotificationBell />);

    const button = screen.getByRole("button", { name: "Notifications" });
    expect(button).toBeTruthy();
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("lists recent inbox items with their read state, and marks one read when opened", async () => {
    resolveSupabaseSession.mockImplementation(async () => ({ session: { user: { id: "u1" } } }));
    render(<NotificationBell />);
    const button = await screen.findByRole("button", { name: "Notifications" });
    fireEvent.click(button);

    expect(screen.queryByRole("menuitem", { name: "Open review queue" })).toBeNull();
    const unread = await screen.findByRole("menuitem", { name: /Ready for final approval: SOP-0042/ });
    expect(unread.getAttribute("data-unread")).toBe("true");
    expect(button.querySelector(".bell-badge")?.textContent).toBe("1");
    expect(button.querySelector(".bell-dot")).toBeNull();
    const read = screen.getByRole("menuitem", { name: /Review requested: SOP-0041/ });
    expect(read.getAttribute("data-unread")).toBe("false");

    fireEvent.click(unread);
    expect(markInboxRead).toHaveBeenCalledWith([2], expect.anything());
    expect(push).toHaveBeenCalledWith("/sops/s1");
  });

  it("animates clearing read items while keeping unread notifications", async () => {
    resolveSupabaseSession.mockImplementation(async () => ({ session: { user: { id: "u1" } } }));
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    const read = await screen.findByRole("menuitem", { name: /Review requested: SOP-0041/ });
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear read" }));
    expect(read.closest(".bell-dismiss-row")?.getAttribute("data-leaving")).toBe("true");
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: /Review requested: SOP-0041/ })).toBeNull());
    expect(screen.getByRole("menuitem", { name: /Ready for final approval: SOP-0042/ })).toBeTruthy();
    await waitFor(() => expect(window.localStorage.getItem("pulse:notification-dismissed:v1:u1")).toContain("1"));
  });

  it("marks everything read from the panel header", async () => {
    resolveSupabaseSession.mockImplementation(async () => ({ session: { user: { id: "u1" } } }));
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mark all read" }));
    expect(markAllInboxRead).toHaveBeenCalledTimes(1);
  });
});

// EMPTY_QUEUE is imported so a changed QueueData shape breaks this test at compile time.
void EMPTY_QUEUE;
