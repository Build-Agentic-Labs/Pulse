// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotificationBell } from "./notification-bell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/domain/supabase-planner", () => ({
  createPlannerSupabaseClient: () => ({}),
  loadWorkspaceProjectGroups: vi.fn(),
}));

vi.mock("@/lib/sop/review-queue-data", () => ({
  fetchReviewQueueData: vi.fn(),
}));

vi.mock("@/lib/supabase-auth", () => ({
  resolveSupabaseSession: vi.fn(() => new Promise(() => undefined)),
}));

describe("NotificationBell", () => {
  it("renders its persistent chrome before notification data resolves", () => {
    render(<NotificationBell />);

    const button = screen.getByRole("button", { name: "SOP notifications" });
    expect(button).toBeTruthy();
    expect(button.getAttribute("aria-busy")).toBe("true");
  });
});
