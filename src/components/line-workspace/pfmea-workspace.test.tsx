import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { emptyPlannerState } from "@/domain/empty-planner-state";
import { PRODUCT_PFMEA_DOCUMENT_FIELD, type PfmeaDocument } from "@/domain/pfmea";
import type { Product, Task } from "@/domain/types";
import { PfmeaWorkspace } from "./pfmea-workspace";

function fixtureTask(): Task {
  return {
    id: "task-panel",
    scenarioId: "scenario-current",
    stationId: "station-disassembly",
    rowType: "task",
    wbs: "1.1",
    name: "Panel Removal",
    manufacturingCode: "PNL-DIS-10",
    plannedStart: "2026-08-20T08:00:00.000Z",
    plannedFinish: "2026-08-20T09:00:00.000Z",
    plannedDurationMinutes: 60,
    plannedOperators: 1,
    plannedManHours: 1,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    manufacturingSteps: [{
      id: "step-panel",
      sequence: 1,
      name: "Remove side panel",
      instruction: "Remove side panel hardware",
    }],
    customFields: {},
  };
}

function Harness({
  onChange = vi.fn(),
  tasks = [fixtureTask()],
}: {
  onChange?: (document: PfmeaDocument) => void;
  tasks?: Task[];
}) {
  return (
    <PfmeaWorkspace
      product={{ ...emptyPlannerState.product, id: "product-flexboost", name: "FlexBoost", productCode: "FB-V2" }}
      scenario={{ ...emptyPlannerState.scenario, id: "scenario-current", name: "Current production" }}
      tasks={tasks}
      zones={emptyPlannerState.zones}
      saveState="saved"
      onDocumentChange={onChange}
      onOpenTask={vi.fn()}
    />
  );
}

describe("PFMEA workspace", () => {
  it("renders an ANA-branded document generated from Procedure steps", () => {
    render(<Harness />);

    expect(screen.getByRole("heading", { name: "FlexBoost PFMEA" })).toHaveClass("ui-pfmea-document-title");
    expect(screen.getByRole("img", { name: "ANA" })).toBeInTheDocument();
    expect(screen.getByText("Process Failure Mode and Effects Analysis")).toBeInTheDocument();
    expect(screen.getByText("PNL-DIS-10")).toBeInTheDocument();
    expect(screen.getByText("Remove side panel")).toBeInTheDocument();
    expect(screen.getByLabelText("PFMEA document number")).toHaveValue("FB-V2-PFMEA-001");
  });

  it("calculates RPN automatically from validated S, O, and D fields", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("Severity for Remove side panel"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Occurrence for Remove side panel"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Detection for Remove side panel"), { target: { value: "8" } });

    expect(screen.getByLabelText("Current RPN for Remove side panel")).toHaveTextContent("360");
  });

  it("writes the complete document to the product-owned custom-field contract", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Failure mode for Remove side panel"), { target: { value: "Dropped panel" } });

    const document = onChange.mock.calls.at(-1)?.[0] as PfmeaDocument;
    const product: Product = {
      ...emptyPlannerState.product,
      customFields: { [PRODUCT_PFMEA_DOCUMENT_FIELD]: document },
    };
    expect(product.customFields?.[PRODUCT_PFMEA_DOCUMENT_FIELD]).toMatchObject({
      productId: "product-flexboost",
      sourceScenarioId: "scenario-current",
      rows: [{ taskId: "task-panel", stepId: "step-panel", failureMode: "Dropped panel" }],
    });
  });

  it("groups repeated procedure task details across its process rows", () => {
    const task = fixtureTask();
    task.manufacturingSteps = [
      ...(task.manufacturingSteps ?? []),
      {
        id: "step-panel-two",
        sequence: 2,
        name: "Remove rear panel",
        instruction: "Remove rear panel hardware",
      },
    ];

    render(<Harness tasks={[task]} />);

    expect(screen.getAllByText("PNL-DIS-10")).toHaveLength(1);
    expect(screen.getByText("PNL-DIS-10").closest("td")).toHaveAttribute("rowspan", "2");
  });

  it("adds a second blank failure mode to the selected process step", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /^Failure mode$/ }));

    const document = onChange.mock.calls.at(-1)?.[0] as PfmeaDocument;
    expect(document.rows).toHaveLength(2);
    expect(document.rows.map((row) => row.stepId)).toEqual(["step-panel", "step-panel"]);
    expect(document.rows[1]).toMatchObject({ failureMode: "", sourceKind: "manual" });
    expect(screen.getAllByLabelText("Failure mode for Remove side panel")).toHaveLength(2);
    expect(screen.getAllByText("Remove side panel")).toHaveLength(1);
  });

  it("shows row-level validation after a risk is started", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("Failure mode for Remove side panel"), { target: { value: "Panel drops" } });

    expect(screen.getByLabelText("6 validation issue(s)")).toBeInTheDocument();
    expect(screen.getByLabelText("Severity for Remove side panel")).toHaveAttribute("aria-invalid", "true");
  });

  it("stores downstream control ideas as PFMEA-owned proposals", () => {
    const onChange = vi.fn();
    const task = fixtureTask();
    const taskSnapshot = structuredClone(task);
    render(<Harness onChange={onChange} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: "Map control" }));
    fireEvent.change(screen.getByLabelText("Proposed control title"), { target: { value: "Verify panel fasteners" } });
    fireEvent.click(screen.getByRole("button", { name: "Add proposal" }));

    const document = onChange.mock.calls.at(-1)?.[0] as PfmeaDocument;
    expect(document.rows[0].controlProposals).toMatchObject([{
      target: "checklist",
      status: "draft",
      title: "Verify panel fasteners",
      taskId: "task-panel",
      stepId: "step-panel",
    }]);
    expect(task).toEqual(taskSnapshot);
  });

  it("provides focused column views and keeps import and export actions together", () => {
    render(<Harness />);

    const table = screen.getByRole("table");
    expect(table).toHaveAttribute("data-column-view", "risk");
    fireEvent.change(screen.getByLabelText("PFMEA column view"), { target: { value: "actions" } });
    expect(table).toHaveAttribute("data-column-view", "actions");

    expect(screen.getByLabelText("PFMEA file options")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import PFMEA/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export Excel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print \/ Save PDF/ })).toBeInTheDocument();
  });
});
