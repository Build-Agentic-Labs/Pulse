import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { plannerModules, quickSwitchModules } from "./nav";
import { ChecklistWorkspace } from "./planner-foundation-pages";

describe("planner foundation pages", () => {
  it("mounts PFMEA and Checklist in the Planner navigation order", () => {
    expect(plannerModules.map((module) => module.id)).toEqual([
      "dashboard",
      "gantt",
      "procedure",
      "pfmea",
      "checklist",
      "work-instructions",
      "setup",
    ]);
    expect(quickSwitchModules.map((module) => module.id)).toContain("pfmea");
    expect(quickSwitchModules.map((module) => module.id)).toContain("checklist");
  });

  it("switches between real traveler and PDI PDF documents", () => {
    render(<ChecklistWorkspace />);
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/templates/build-checklist.pdf");
    fireEvent.click(screen.getByRole("button", { name: "PDI" }));
    expect(screen.getByRole("button", { name: "View template" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/templates/pdi-checklist.pdf");
  });
});
