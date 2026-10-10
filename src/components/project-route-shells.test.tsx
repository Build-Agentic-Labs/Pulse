import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authProjectGate: vi.fn() }));

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("./auth-project-gate", () => ({
  AuthProjectGate: (props: Record<string, unknown>) => {
    mocks.authProjectGate(props);
    return null;
  },
}));
vi.mock("./app-flow-panels", () => ({ AppLoadingShell: () => null }));
vi.mock("./space-loading-states", () => ({
  DashboardLoadingState: () => null,
  PlanningLoadingState: () => null,
  ProductLoadingState: () => null,
  ProductionLoadingState: () => null,
  SettingsLoadingState: () => null,
}));

import { SettingsRouteShell } from "./project-route-shells";

describe("SettingsRouteShell", () => {
  it("loads the product directory through the auth gate", () => {
    render(<SettingsRouteShell />);

    expect(mocks.authProjectGate).toHaveBeenCalledWith(
      expect.objectContaining({ directoryScope: "product" }),
    );
  });
});
