import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { emptyPlannerState } from "@/domain/empty-planner-state";
import { PRODUCT_PFMEA_DOCUMENT_FIELD, createPfmeaDocumentFromProcedure, serializePfmeaDocument, type PfmeaDocument } from "@/domain/pfmea";
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
      onDocumentChange={onChange}
      onOpenTask={vi.fn()}
    />
  );
}

describe("PFMEA workspace", () => {
  it("expands the mounted grid without saving and restores it on exit", () => {
    const onChange = vi.fn(); render(<Harness onChange={onChange} />);
    const cell = screen.getByLabelText("Severity for Remove side panel");
    fireEvent.click(screen.getByRole("button", {name:"Full screen"}));
    expect(cell.closest(".ui-pfmea-page")).toHaveClass("ui-pfmea-fullscreen");
    expect(screen.getByLabelText("Severity for Remove side panel")).toBe(cell);
    fireEvent.click(screen.getByRole("button", {name:"Exit full screen"}));
    expect(cell.closest(".ui-pfmea-page")).not.toHaveClass("ui-pfmea-fullscreen");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name:"Full screen"}));
    fireEvent.keyDown(document, {key:"Escape"});
    expect(cell.closest(".ui-pfmea-page")).not.toHaveClass("ui-pfmea-fullscreen");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers score choices while retaining direct typing", () => {
    const onChange = vi.fn(); render(<Harness onChange={onChange} />);
    const score = screen.getByLabelText("Severity for Remove side panel");
    fireEvent.pointerDown(score.closest("td")!);
    expect(score).toHaveFocus();
    fireEvent.click(score.closest("td")!);
    fireEvent.click(screen.getByRole("option", {name:"7"}));
    expect(screen.getByLabelText("Severity for Remove side panel")).toHaveValue(7);
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Severity for Remove side panel"), {target:{value:"9"}});
    expect(screen.getByLabelText("Severity for Remove side panel")).toHaveValue(9);
  });

  it("pastes a block with one save and one undo step", () => {
    const task = fixtureTask();
    task.manufacturingSteps!.push({ ...task.manufacturingSteps![0], id: "paste-second", sequence: 2, name: "Second step" });
    const onChange = vi.fn(); render(<Harness tasks={[task]} onChange={onChange} />);
    const cell = screen.getByLabelText("Failure mode for Remove side panel");
    fireEvent.focus(cell);
    fireEvent.paste(cell, { clipboardData: { getData: () => "A\tB\nC\tD" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].rows.map((row: {failureMode:string;effect:string}) => [row.failureMode,row.effect])).toEqual([["A","B"],["C","D"]]);
    fireEvent.click(screen.getByRole("button", {name:"Undo PFMEA edit"}));
    expect(onChange.mock.calls.at(-1)![0].rows[0].failureMode).toBe("");
    fireEvent.click(screen.getByRole("button", {name:"Redo PFMEA edit"}));
    expect(onChange.mock.calls.at(-1)![0].rows[1].effect).toBe("D");
  });

  it("memoized rows keep earlier edits when another row changes", () => {
    const task = fixtureTask();
    task.manufacturingSteps!.push({ ...task.manufacturingSteps![0], id: "second", sequence: 2, name: "Second step" });
    const onChange = vi.fn(); render(<Harness tasks={[task]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Failure mode for Remove side panel"), { target: { value: "First edit" } });
    fireEvent.change(screen.getByLabelText("Failure mode for Second step"), { target: { value: "Second edit" } });
    expect(onChange.mock.calls.at(-1)![0].rows.map((row: {failureMode:string}) => row.failureMode)).toEqual(["First edit", "Second edit"]);
  });

  it("closes a complete action inline and reopens verification after an edit", () => {
    const task = fixtureTask();
    const product = { ...emptyPlannerState.product, id: "inline-test" };
    const document = createPfmeaDocumentFromProcedure(product, emptyPlannerState.scenario, [task], []);
    Object.assign(document.rows[0], { failureMode: "Loose panel", effect: "Injury", cause: "Missing bolt", currentControls: "Torque", detectionActivity: "Inspection", severity: 5, occurrence: 3, detection: 2, recommendedActions: "Check bolts", actionOwner: "Existing owner", targetDate: "2026-10-23", actionsTaken: "Check added", resultOccurrence: 2, resultDetection: 1, verificationNotes: "Trial passed" });
    const onChange = vi.fn();
    render(<PfmeaWorkspace product={{ ...product, customFields: { [PRODUCT_PFMEA_DOCUMENT_FIELD]: serializePfmeaDocument(document) } }} scenario={emptyPlannerState.scenario} tasks={[task]} zones={[]} onDocumentChange={onChange} />);
    fireEvent.change(screen.getByLabelText("PFMEA column view"), { target: { value: "actions" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirm effective & close for Remove side panel" }));
    expect(onChange.mock.calls.at(-1)![0].rows[0]).toMatchObject({ actionStatus: "closed", actionOwner: "Existing owner", verifiedAt: expect.any(String) });
    fireEvent.change(screen.getByLabelText("Effectiveness verification for Remove side panel"), { target: { value: "Recheck needed" } });
    expect(onChange.mock.calls.at(-1)![0].rows[0]).toMatchObject({ actionStatus: "awaiting_verification", verifiedAt: undefined });
  });

  it("edits and verifies actions in the table without a risk dialog", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.queryByRole("button", { name: /Edit risk/i })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("PFMEA column view"), { target: { value: "all" } });
    expect(screen.getByRole("checkbox", { name: "Confirm effective & close for Remove side panel" })).toBeDisabled();
    const fields = {
      "Failure mode": "Loose panel", "Failure effect": "Panel falls", "Failure cause": "Missing bolt",
      "Current controls": "Torque check", "Detection activity": "Inspection", "Severity": "5",
      "Occurrence": "3", "Detection": "2", "Recommended actions": "Add inspection",
      "Actions taken": "Inspection added", "Result occurrence": "2", "Result detection": "1",
      "Effectiveness verification": "Trial passed", "Target date": "2026-10-23",
    };
    for (const [label, value] of Object.entries(fields)) {
      fireEvent.change(screen.getByLabelText(`${label} for Remove side panel`), { target: { value } });
    }
    // Owner is required, so closing cannot bypass a missing assignment.
    expect(screen.getByRole("checkbox", { name: "Confirm effective & close for Remove side panel" })).toBeDisabled();
    expect(onChange.mock.calls.at(-1)![0].rows[0].verificationNotes).toBe("Trial passed");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps routine saves silent and shows failures for the latest edit", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const props = {
        product: { ...emptyPlannerState.product, id: "product-flexboost" },
        scenario: { ...emptyPlannerState.scenario, id: "scenario-current" },
        tasks: [fixtureTask()], zones: emptyPlannerState.zones,
        onDocumentChange: onChange, onOpenTask: vi.fn(),
      };
      const { rerender } = render(<PfmeaWorkspace {...props} saveResult={{ document: undefined, state: "saving" }} />);
      expect(screen.queryByRole("status", { name: "PFMEA save status" })).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Failure mode for Remove side panel"), { target: { value: "First edit" } });
      const first = serializePfmeaDocument(onChange.mock.calls.at(-1)![0]);
      expect(screen.queryByRole("status", { name: "PFMEA save status" })).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Failure mode for Remove side panel"), { target: { value: "Latest edit" } });
      const latest = serializePfmeaDocument(onChange.mock.calls.at(-1)![0]);
      rerender(<PfmeaWorkspace {...props} saveResult={{ document: first, state: "saved" }} />);
      expect(screen.queryByRole("status", { name: "PFMEA save status" })).not.toBeInTheDocument();
      rerender(<PfmeaWorkspace {...props} saveResult={{ document: latest, state: "error", error: "Offline" }} />);
      expect(screen.getByRole("alert")).toHaveTextContent("Offline");
      rerender(<PfmeaWorkspace {...props} saveResult={{ document: latest, state: "saved" }} />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(2500));
      expect(screen.queryByRole("status", { name: "PFMEA save status" })).not.toBeInTheDocument();
      rerender(<PfmeaWorkspace {...props} saveResult={{ document: latest, state: "saving" }} />);
      expect(screen.queryByRole("status", { name: "PFMEA save status" })).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it("renders an ANA-branded document generated from Procedure steps", () => {
    render(<Harness />);

    expect(screen.getByRole("heading", { name: "FlexBoost PFMEA" })).toHaveClass("ui-pfmea-document-title");
    expect(screen.getByRole("img", { name: "ANA" })).toBeInTheDocument();
    expect(screen.getByText("Process Failure Mode and Effects Analysis")).toBeInTheDocument();
    expect(screen.getByText("PNL-DIS-10")).toBeInTheDocument();
    expect(screen.getByText("Remove side panel")).toBeInTheDocument();
    expect(screen.getByText("FB-V2-PFMEA-001")).toBeInTheDocument();
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

  it("keeps control mapping disabled without changing the PFMEA or Procedure", () => {
    const onChange = vi.fn();
    const task = fixtureTask();
    const taskSnapshot = structuredClone(task);
    render(<Harness onChange={onChange} tasks={[task]} />);
    expect(screen.getByRole("button", { name: "Map control" })).toBeDisabled();
    expect(screen.queryByText("Control mapping proposals")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(task).toEqual(taskSnapshot);
  });

  it("provides focused column views and keeps import and export actions together", () => {
    render(<Harness />);

    const table = screen.getByRole("table");
    expect(table).toHaveAttribute("data-column-view", "all");
    fireEvent.change(screen.getByLabelText("PFMEA column view"), { target: { value: "actions" } });
    expect(table).toHaveAttribute("data-column-view", "actions");

    expect(screen.getByLabelText("PFMEA file options")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import PFMEA/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export Excel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print \/ Save PDF/ })).toBeInTheDocument();
  });
});

it("previews synchronization without writing and archives only after confirmation", () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  expect(screen.getByLabelText("Assessment progress")).toHaveTextContent("Not assessed 1");
  fireEvent.click(screen.getByRole("button", { name: "Sync Procedure" }));
  expect(screen.getByRole("heading", { name: "Review Procedure changes" })).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Archive" }).at(-1)!);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].rows[0].archivedAt).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Filter PFMEA rows"), { target: { value: "archived" } });
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(onChange.mock.calls.at(-1)![0].rows[0].archivedAt).toBeUndefined();
});

it("filters and collapses task groups without changing the PFMEA", () => {
  const onChange = vi.fn(); render(<Harness onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Collapse Panel Removal" }));
  expect(screen.queryByLabelText("Failure mode for Remove side panel")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Expand tasks" }));
  expect(screen.getByLabelText("Failure mode for Remove side panel")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Filter PFMEA rows"), { target: { value: "complete" } });
  expect(screen.getByText("No PFMEA rows match this filter.")).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it("relinks a missing source only after an explicit choice, preserving the analysis", () => {
  const onChange = vi.fn();
  const task = fixtureTask();
  const scenario = { ...emptyPlannerState.scenario, id: "scenario-current" };
  const product = { ...emptyPlannerState.product, id: "product-flexboost" };
  const document = createPfmeaDocumentFromProcedure(product, scenario, [task], []);
  document.rows[0].stepId = "removed"; document.rows[0].failureMode = "Keep this analysis";
  const before = structuredClone(document);
  render(<PfmeaWorkspace product={{ ...product, customFields: { [PRODUCT_PFMEA_DOCUMENT_FIELD]: document } }} scenario={scenario} tasks={[task]} zones={[]} onDocumentChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Source step missing · Review" }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Relink step"), { target: { value: "step-panel" } });
  fireEvent.click(screen.getByRole("button", { name: /^Relink$/ }));
  expect(onChange.mock.calls[0][0].rows[0]).toMatchObject({ stepId: "step-panel", failureMode: "Keep this analysis" });
  expect(document).toEqual(before);
});

describe('PFMEA keyboard grid', () => {
  function twoRows() {
    const task = fixtureTask();
    task.manufacturingSteps!.push({ ...task.manufacturingSteps![0], id:'step-second',sequence:2,name:'Second step' });
    render(<Harness tasks={[task]} />);
    return { first: screen.getByLabelText('Failure mode for Remove side panel'), second: screen.getByLabelText('Failure mode for Second step') };
  }
  it('moves horizontally with Tab, vertically with Enter, and skips row buttons', () => {
    const {first,second} = twoRows();
    act(()=>first.focus());
    fireEvent.keyDown(first,{key:'Tab'});
    expect(screen.getByLabelText('Failure effect for Remove side panel')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!,{key:'Tab',shiftKey:true});
    expect(first).toHaveFocus();
    fireEvent.keyDown(first,{key:'Enter'});
    expect(second).toHaveFocus();
    fireEvent.keyDown(second,{key:'Enter',shiftKey:true});
    expect(first).toHaveFocus();
  });
  it('preserves native arrow editing after F2 and restores a canceled edit', () => {
    const {first} = twoRows();
    act(()=>first.focus());
    fireEvent.keyDown(first,{key:'F2'});
    fireEvent.change(first,{target:{value:'Temporary'}});
    fireEvent.keyDown(first,{key:'ArrowRight'});
    expect(first).toHaveFocus();
    fireEvent.keyDown(first,{key:'Escape'});
    expect(first).toHaveValue('');
    fireEvent.keyDown(first,{key:'ArrowRight'});
    expect(screen.getByLabelText('Failure effect for Remove side panel')).toHaveFocus();
  });
  it('pins a row while it is edited under the not-assessed filter', () => {
    twoRows();
    fireEvent.change(screen.getByLabelText('Filter PFMEA rows'),{target:{value:'not_assessed'}});
    const first=screen.getByLabelText('Failure mode for Remove side panel');
    act(()=>first.focus());
    fireEvent.change(first,{target:{value:'Started risk'}});
    expect(first).toBeInTheDocument();
    act(()=>screen.getByLabelText('Search PFMEA').focus());
    expect(screen.queryByLabelText('Failure mode for Remove side panel')).not.toBeInTheDocument();
  });
});

describe('PFMEA undo and redo',()=>{
 it('undoes a whole typing session and redoes it with minimal toolbar controls',()=>{
  render(<Harness/>);
  const first=screen.getByLabelText('Failure mode for Remove side panel');
  act(()=>first.focus());
  fireEvent.change(first,{target:{value:'T'}});
  fireEvent.change(first,{target:{value:'Typed risk'}});
  fireEvent.keyDown(first,{key:'z',ctrlKey:true});
  expect(first).toHaveValue('');
  fireEvent.keyDown(first,{key:'z',metaKey:true,shiftKey:true});
  expect(first).toHaveValue('Typed risk');
  fireEvent.click(screen.getByRole('button',{name:'Undo PFMEA edit'}));
  expect(first).toHaveValue('');
  fireEvent.click(screen.getByRole('button',{name:'Redo PFMEA edit'}));
  expect(first).toHaveValue('Typed risk');
 });
 it('keeps separate cell edits separate and clears redo after new typing',()=>{
  render(<Harness/>);
  const first=screen.getByLabelText('Failure mode for Remove side panel');
  const effect=screen.getByLabelText('Failure effect for Remove side panel');
  act(()=>first.focus());fireEvent.change(first,{target:{value:'Risk'}});
  fireEvent.keyDown(first,{key:'Tab'});fireEvent.change(effect,{target:{value:'Effect'}});
  fireEvent.keyDown(effect,{key:'z',ctrlKey:true});
  expect(effect).toHaveValue('');expect(first).toHaveValue('Risk');
  fireEvent.change(effect,{target:{value:'Different effect'}});
  expect(screen.getByRole('button',{name:'Redo PFMEA edit'})).toBeDisabled();
 });
 it('does not undo an Escape cancellation as another edit',()=>{
  render(<Harness/>);
  const first=screen.getByLabelText('Failure mode for Remove side panel');
  act(()=>first.focus());fireEvent.change(first,{target:{value:'Canceled'}});
  fireEvent.keyDown(first,{key:'Escape'});
  expect(first).toHaveValue('');
  expect(screen.getByRole('button',{name:'Undo PFMEA edit'})).toBeDisabled();
 });
});
