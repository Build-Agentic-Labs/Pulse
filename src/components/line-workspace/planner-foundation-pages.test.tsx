import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { plannerModules, quickSwitchModules } from "./nav";
import { ChecklistWorkspace } from "./planner-foundation-pages";

describe("planner foundation pages", () => {
  it("mounts PFMEA and Checklist in the Planner navigation order", () => {
    expect(plannerModules.map((module) => module.id)).toEqual([
      "dashboard",
      "setup",
      "gantt",
      "procedure",
      "pfmea",
      "checklist",
      "work-instructions",
      "balance",
      "reports",
    ]);
    expect(quickSwitchModules.map((module) => module.id)).toContain("pfmea");
    expect(quickSwitchModules.map((module) => module.id)).toContain("checklist");
  });

  it("renders the Checklist builder scaffold with the same page hierarchy", () => {
    render(<ChecklistWorkspace />);

    expect(screen.getByRole("heading", { name: "Checklist" })).toHaveClass("ui-section-title");
    expect(screen.getByRole("region", { name: "Checklist builder" })).toBeInTheDocument();
    expect(screen.getByText("No checklist content yet")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
