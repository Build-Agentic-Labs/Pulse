import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchInitialWorkspaceGroups: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/server-data", () => ({
  fetchInitialWorkspaceGroups: mocks.fetchInitialWorkspaceGroups,
}));
vi.mock("@/components/project-route-shells", () => ({
  SettingsRouteShell: () => null,
}));

import SettingsPage from "./page";

describe("SettingsPage", () => {
  it("seeds the settings shell from the product directory", async () => {
    await SettingsPage();

    expect(mocks.fetchInitialWorkspaceGroups).toHaveBeenCalledWith("product");
  });
});
