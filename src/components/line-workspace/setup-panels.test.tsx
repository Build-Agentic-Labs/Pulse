// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Product, Task, Zone } from "@/domain/types";
import { WorkInstructionsPanel } from "./setup-panels";

vi.mock("@/domain/supabase-planner", () => ({
  loadPlannerStateFromSupabase: vi.fn(() => new Promise(() => undefined)),
}));

const task = {
  id: "task-1",
  name: "Fluid Drain and Labeling",
  manufacturingCode: "FLD-DIS-10",
  rowType: "task",
  scenarioId: "scenario-current-state",
  zoneId: "zone-disassembly",
  manufacturingSteps: [],
} as unknown as Task;

const zone = {
  id: "zone-disassembly",
  name: "Disassembly",
} as Zone;

const product = {
  projectId: "project-flexboost",
  customFields: {},
} as unknown as Product;

describe("WorkInstructionsPanel", () => {
  it("opens a row preview in a closable dialog without navigating away", () => {
    render(
      <WorkInstructionsPanel
        tasks={[task]}
        zones={[zone]}
        product={product}
        onOpenTask={vi.fn()}
      />,
    );

    const previewButton = screen.getByRole("button", { name: "Preview" });
    expect(previewButton.closest("a")).toBeNull();

    fireEvent.click(previewButton);

    const previewDialog = screen.getByRole("dialog", { name: "Work instruction document preview" });
    expect(previewDialog.parentElement).toBe(document.body);
    expect(previewDialog.classList.contains("wi-print-modal")).toBe(true);
    expect(screen.getByRole("status", { name: "Loading work instruction preview" })).toBeTruthy();
    expect(previewDialog.querySelectorAll(".ui-skeleton-line").length).toBeGreaterThan(10);
    expect(screen.getByRole("button", { name: "Print / Save PDF" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByRole("dialog", { name: "Work instruction document preview" })).toBeNull();
  });

  it("closes the in-place preview with Escape", () => {
    render(
      <WorkInstructionsPanel
        tasks={[task]}
        zones={[zone]}
        product={product}
        onOpenTask={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Work instruction document preview" })).toBeNull();
  });
});
