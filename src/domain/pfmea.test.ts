import { describe, expect, it } from "vitest";

import { emptyPlannerState } from "./empty-planner-state";
import {
  calculatePfmeaRpn,
  calculateResidualRpn,
  createPfmeaControlProposal,
  createPfmeaDocumentFromProcedure,
  duplicatePfmeaRow,
  getPfmeaRowIssues,
  getProductPfmeaDocument,
  isHighPriorityPfmeaRow,
  isPfmeaRowComplete,
  normalizePfmeaScore,
  PRODUCT_PFMEA_DOCUMENT_FIELD,
  syncPfmeaDocumentWithProcedure,
} from "./pfmea";
import type { ManufacturingStep, Task } from "./types";

const NOW = new Date("2026-08-20T12:00:00.000Z");

function step(id: string, sequence: number, name: string): ManufacturingStep {
  return { id, sequence, name, instruction: `Install ${name}` };
}

function task(id: string, name: string, steps: ManufacturingStep[]): Task {
  return {
    id,
    scenarioId: "scenario-a",
    stationId: "station-a",
    rowType: "task",
    wbs: id,
    name,
    manufacturingCode: `${id.toUpperCase()}-10`,
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
    manufacturingSteps: steps,
    customFields: {},
  };
}

describe("PFMEA domain", () => {
  it("calculates current and residual RPN only when every required score exists", () => {
    expect(calculatePfmeaRpn(9, 5, 8)).toBe(360);
    expect(calculatePfmeaRpn(9, undefined, 8)).toBeUndefined();
    expect(calculateResidualRpn({ severity: 9, resultOccurrence: 2, resultDetection: 4 })).toBe(72);
  });

  it("normalizes scores to whole numbers between one and ten", () => {
    expect(normalizePfmeaScore(0)).toBe(1);
    expect(normalizePfmeaScore("7.6")).toBe(8);
    expect(normalizePfmeaScore(14)).toBe(10);
    expect(normalizePfmeaScore("")).toBeUndefined();
  });

  it("creates one procedure-linked PFMEA row per manufacturing step", () => {
    const tasks = [task("task-a", "Panel Removal", [step("step-a", 1, "Remove panel"), step("step-b", 2, "Store panel")])];
    const document = createPfmeaDocumentFromProcedure(
      { ...emptyPlannerState.product, id: "product-a", productCode: "FB-V2", name: "FlexBoost" },
      { ...emptyPlannerState.scenario, id: "scenario-a", name: "Current production" },
      tasks,
      emptyPlannerState.zones,
      NOW,
    );

    expect(document.documentNumber).toBe("FB-V2-PFMEA-001");
    expect(document.rows).toHaveLength(2);
    expect(document.rows.map((row) => [row.taskId, row.stepId, row.processStepSnapshot])).toEqual([
      ["task-a", "step-a", "Remove panel"],
      ["task-a", "step-b", "Store panel"],
    ]);
  });

  it("duplicates failure modes without copying risk content", () => {
    const source = createPfmeaDocumentFromProcedure(
      { ...emptyPlannerState.product, id: "product-a" },
      emptyPlannerState.scenario,
      [task("task-a", "Panel Removal", [step("step-a", 1, "Remove panel")])],
      emptyPlannerState.zones,
      NOW,
    ).rows[0];
    const duplicate = duplicatePfmeaRow({ ...source, failureMode: "Dropped panel", severity: 7 });

    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.taskId).toBe(source.taskId);
    expect(duplicate.stepId).toBe(source.stepId);
    expect(duplicate.failureMode).toBe("");
    expect(duplicate.severity).toBeUndefined();
  });

  it("syncs renamed procedure links, preserves risk content, and adds new steps", () => {
    const originalTask = task("task-a", "Panel Removal", [step("step-a", 1, "Remove panel")]);
    const document = createPfmeaDocumentFromProcedure(
      { ...emptyPlannerState.product, id: "product-a" },
      emptyPlannerState.scenario,
      [originalTask],
      emptyPlannerState.zones,
      NOW,
    );
    document.rows[0].failureMode = "Dropped panel";
    const updatedTask = task("task-a", "Panel System Removal", [
      step("step-a", 1, "Lift panel"),
      step("step-b", 2, "Store panel"),
    ]);

    const procedureSnapshot = structuredClone(updatedTask);
    const zoneSnapshot = structuredClone(emptyPlannerState.zones);
    const synced = syncPfmeaDocumentWithProcedure(document, emptyPlannerState.scenario, [updatedTask], emptyPlannerState.zones, NOW);

    expect(synced.rows).toHaveLength(2);
    expect(synced.rows[0]).toMatchObject({
      failureMode: "Dropped panel",
      taskNameSnapshot: "Panel System Removal",
      processStepSnapshot: "Lift panel",
      linkStatus: "linked",
    });
    expect(synced.rows[1].stepId).toBe("step-b");
    expect(updatedTask).toEqual(procedureSnapshot);
    expect(emptyPlannerState.zones).toEqual(zoneSnapshot);
  });

  it("validates product custom-field documents and flags severity nine as high priority", () => {
    const document = createPfmeaDocumentFromProcedure(
      { ...emptyPlannerState.product, id: "product-a" },
      emptyPlannerState.scenario,
      [task("task-a", "Panel Removal", [step("step-a", 1, "Remove panel")])],
      emptyPlannerState.zones,
      NOW,
    );
    document.rows[0].severity = 9;
    const parsed = getProductPfmeaDocument({ [PRODUCT_PFMEA_DOCUMENT_FIELD]: document });

    expect(parsed?.rows).toHaveLength(1);
    expect(isHighPriorityPfmeaRow(parsed!.rows[0])).toBe(true);
    expect(getProductPfmeaDocument({ [PRODUCT_PFMEA_DOCUMENT_FIELD]: { version: 99 } })).toBeUndefined();
  });

  it("migrates version one documents into the version two PFMEA contract", () => {
    const document = createPfmeaDocumentFromProcedure(
      { ...emptyPlannerState.product, id: "product-a" },
      emptyPlannerState.scenario,
      [task("task-a", "Panel Removal", [step("step-a", 1, "Remove panel")])],
      emptyPlannerState.zones,
      NOW,
    );
    const legacy = {
      ...document,
      version: 1,
      settings: undefined,
      imports: undefined,
      rows: document.rows.map(({ createdAt: _createdAt, updatedAt: _updatedAt, sourceKind: _sourceKind, controlProposals: _controlProposals, ...row }) => row),
    };

    const migrated = getProductPfmeaDocument({ [PRODUCT_PFMEA_DOCUMENT_FIELD]: legacy });

    expect(migrated).toMatchObject({
      version: 2,
      settings: { highRpnThreshold: 100, highSeverityThreshold: 9 },
      imports: [],
    });
    expect(migrated?.rows[0]).toMatchObject({ sourceKind: "procedure", controlProposals: [] });
  });

  it("reports incomplete started risks without flagging untouched procedure rows", () => {
    const row = createPfmeaDocumentFromProcedure(
      { ...emptyPlannerState.product, id: "product-a" },
      emptyPlannerState.scenario,
      [task("task-a", "Panel Removal", [step("step-a", 1, "Remove panel")])],
      emptyPlannerState.zones,
      NOW,
    ).rows[0];

    expect(getPfmeaRowIssues(row)).toEqual([]);
    row.failureMode = "Panel drops";
    expect(getPfmeaRowIssues(row).map((issue) => issue.field)).toEqual([
      "effect",
      "severity",
      "cause",
      "occurrence",
      "currentControls",
      "detection",
    ]);
    expect(isPfmeaRowComplete(row)).toBe(false);
  });

  it("creates PFMEA-owned control proposals without changing the linked Procedure row", () => {
    const row = createPfmeaDocumentFromProcedure(
      { ...emptyPlannerState.product, id: "product-a" },
      emptyPlannerState.scenario,
      [task("task-a", "Panel Removal", [step("step-a", 1, "Remove panel")])],
      emptyPlannerState.zones,
      NOW,
    ).rows[0];
    const snapshot = structuredClone(row);

    const proposal = createPfmeaControlProposal(row, {
      target: "checklist",
      title: "Confirm panel fasteners",
      notes: "Operator signoff before moving forward",
      status: "ready",
    }, NOW);

    expect(proposal).toMatchObject({
      target: "checklist",
      status: "ready",
      taskId: "task-a",
      stepId: "step-a",
      title: "Confirm panel fasteners",
    });
    expect(row).toEqual(snapshot);
  });
});
