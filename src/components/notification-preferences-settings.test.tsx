// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotificationPreferencesSettings } from "./notification-preferences-settings";

const savePreference = vi.fn(async () => undefined);
const loadPreferences = vi.fn(async () => [
  { workspaceId: "", kind: "remark_added", channel: "email", mode: "immediate" },
  { workspaceId: "", kind: "sent_back", channel: "email", mode: "off" },
]);

vi.mock("@/lib/notifications/preferences-store", () => ({
  loadPreferences: (...args: unknown[]) => loadPreferences(...(args as [])),
  savePreference: (...args: unknown[]) => savePreference(...(args as [])),
}));

vi.mock("@/domain/supabase-planner", () => ({
  createPlannerSupabaseClient: () => ({}),
}));

vi.mock("@/lib/supabase-auth", () => ({
  resolveSupabaseSession: vi.fn(async () => ({ session: { user: { id: "u1" } } })),
}));

describe("NotificationPreferencesSettings", () => {
  it("renders one email switch per kind, reflecting catalog defaults and saved overrides", async () => {
    render(<NotificationPreferencesSettings />);
    const review = await screen.findByRole("switch", { name: "Review requested" });
    expect(review.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Remark added" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Sent back with remarks" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Weekly stalled-work digest" }).getAttribute("aria-checked")).toBe("true");
  });

  it("saves a toggle immediately as a global preference", async () => {
    render(<NotificationPreferencesSettings />);
    const review = await screen.findByRole("switch", { name: "Review requested" });
    fireEvent.click(review);
    expect(savePreference).toHaveBeenCalledWith(
      "u1",
      { workspaceId: "", kind: "review_requested", channel: "email", mode: "off" },
      expect.anything(),
    );
    expect(review.getAttribute("aria-checked")).toBe("false");
  });
});
