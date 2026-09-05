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

const pushClient = {
  isPushSupported: vi.fn(() => true),
  currentPushEndpoint: vi.fn(async () => null as string | null),
  subscribeToPush: vi.fn(async () => ({ endpoint: "https://p/1", p256dh: "a", auth: "b" })),
  unsubscribeFromPush: vi.fn(async () => "https://p/1"),
};
vi.mock("@/lib/notifications/push-client", () => ({
  isPushSupported: () => pushClient.isPushSupported(),
  currentPushEndpoint: () => pushClient.currentPushEndpoint(),
  subscribeToPush: () => pushClient.subscribeToPush(),
  unsubscribeFromPush: () => pushClient.unsubscribeFromPush(),
}));

const pushStore = { savePushSubscription: vi.fn(async () => undefined), deletePushSubscription: vi.fn(async () => undefined) };
vi.mock("@/lib/notifications/push-store", () => ({
  savePushSubscription: (...args: unknown[]) => pushStore.savePushSubscription(...(args as [])),
  deletePushSubscription: (...args: unknown[]) => pushStore.deletePushSubscription(...(args as [])),
}));

describe("NotificationPreferencesSettings — browser push", () => {
  it("offers a device push switch when the browser supports it, and subscribes on toggle", async () => {
    render(<NotificationPreferencesSettings />);
    const push = await screen.findByRole("switch", { name: "Browser push on this device" });
    expect(push.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(push);
    await screen.findByRole("switch", { name: "Browser push on this device", checked: true });
    expect(pushClient.subscribeToPush).toHaveBeenCalledTimes(1);
    expect(pushStore.savePushSubscription).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      { endpoint: "https://p/1", p256dh: "a", auth: "b" },
      expect.any(String),
    );
  });
});

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
