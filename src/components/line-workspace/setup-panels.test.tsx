// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlannerState, Product, Task, Zone } from "@/domain/types";
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
  name: "FlexBoost",
  customFields: {},
} as unknown as Product;

const annotatedTask = {
  ...task,
  manufacturingSteps: [
    {
      id: "step-1",
      sequence: 1,
      name: "Install bracket",
      instruction: "Align and fasten the bracket.",
      durationMinutes: 10,
    },
  ],
  customFields: {
    stepPhotoAttachments: {
      "step-1": [
        {
          id: "photo-1",
          name: "Bracket",
          dataUrl: "https://example.test/bracket.jpg",
          capturedAt: "2026-08-06T12:00:00.000Z",
          width: 800,
          height: 600,
          annotations: {
            version: 2,
            items: [
              {
                id: "rectangle-1",
                type: "rectangle",
                color: "#d71921",
                strokeWidth: 3,
                x: 0.2,
                y: 0.2,
                width: 0.4,
                height: 0.3,
              },
            ],
          },
        },
      ],
    },
  },
} as unknown as Task;

const annotatedPlannerState = {
  product,
  scenario: { id: "scenario-current-state" },
  tasks: [annotatedTask],
  zones: [zone],
} as PlannerState;

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

  it("uses the current planner annotations and switches layouts inside the modal", () => {
    render(
      <WorkInstructionsPanel
        tasks={[annotatedTask]}
        zones={[zone]}
        product={product}
        initialPlannerState={annotatedPlannerState}
        hydratedTaskIds={new Set([annotatedTask.id])}
        onOpenTask={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(document.querySelector('[data-annotation-type="rectangle"]')).not.toBeNull();
    expect(document.querySelector('[data-wi-layout="v2"]')).not.toBeNull();
    expect(screen.getByRole("group", { name: "Steps per sheet" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "6 per sheet" }));
    expect(document.querySelector('[data-wi-layout="v1"]')).not.toBeNull();
  });
});
