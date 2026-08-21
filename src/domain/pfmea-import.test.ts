import { describe, expect, it } from "vitest";

import { emptyPlannerState } from "./empty-planner-state";
import { buildPfmeaImportPreview, mergePfmeaImport, parsePfmeaDelimitedText, type PfmeaTabularValue } from "./pfmea-import";
import { createPfmeaDocumentFromProcedure } from "./pfmea";
import type { Task } from "./types";

const NOW = new Date("2026-08-21T08:00:00.000Z");

function procedureTask(): Task {
  return {
    id: "task-fluid",
    scenarioId: "scenario-a",
    stationId: "station-a",
    rowType: "task",
    wbs: "1.1",
    name: "Fluid Drain and Labeling",
    manufacturingCode: "FLD-DIS-10",
    plannedStart: "2026-08-21T08:00:00.000Z",
    plannedFinish: "2026-08-21T09:00:00.000Z",
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
    manufacturingSteps: [{ id: "step-drain", sequence: 1, name: "Prepare for drain", instruction: "Prepare the drain" }],
    customFields: {},
  };
}

function importTable(): PfmeaTabularValue[][] {
  return [
    ["PFMEA"],
    ["Interaction", "Process step", "Potential Failure Mode", "Potential Effect(s) of Failure", "Severity", "Potential Cause", "Occurrence", "Current Process Controls", "Detection", "Detection Activity", "RPN", "Recommended Actions", "Responsibility and Target Completion Date", "Action Results", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "Actions Taken", "Sev", "Occ", "Det"],
    ["Disassembly"],
    ["Fluid Drain and Labeling"],
    ["", "Prepare for drain", "Drain cap omitted", "Fluid spill", 8, "Cap not installed", 3, "Visual work instruction", 5, "Final inspection", "", "Add checklist confirmation", "Manufacturing / 9/15/2026", "Checklist added", "", 2, 2],
    ["", "", "Drain valve left open", "Fluid leak", 7, "Valve not closed", 2, "Operator check", 4, "Leak test", "", "Add signoff", "Quality", "", "", "", ""],
  ];
}

describe("PFMEA import", () => {
  it("parses quoted CSV fields containing commas and line breaks", () => {
    expect(parsePfmeaDelimitedText('A,B\r\n"one, two","line 1\nline 2"')).toEqual([
      ["A", "B"],
      ["one, two", "line 1\nline 2"],
    ]);
  });

  it("parses hierarchical PFMEA rows and maps them to read-only Procedure references", () => {
    const task = procedureTask();
    const taskSnapshot = structuredClone(task);
    const preview = buildPfmeaImportPreview(importTable(), {
      fileName: "current-pfmea.csv",
      fileType: "csv",
      sourceKey: "current-pfmea.csv:100:1",
      tasks: [task],
      zones: [],
      now: NOW,
    });

    expect(preview.record).toMatchObject({ rowCount: 2, matchedTaskCount: 2, matchedStepCount: 2, unmappedCount: 0 });
    expect(preview.rows[0]).toMatchObject({
      taskId: "task-fluid",
      stepId: "step-drain",
      failureMode: "Drain cap omitted",
      severity: 8,
      occurrence: 3,
      detection: 5,
      resultOccurrence: 2,
      resultDetection: 2,
      targetDate: "2026-09-15",
      sourceRow: 6,
    });
    expect(task).toEqual(taskSnapshot);
  });

  it("fills the generated blank row, inserts additional risks, and ignores a duplicate source", () => {
    const task = procedureTask();
    const document = createPfmeaDocumentFromProcedure(
      { ...emptyPlannerState.product, id: "product-a" },
      { ...emptyPlannerState.scenario, id: "scenario-a" },
      [task],
      [],
      NOW,
    );
    const preview = buildPfmeaImportPreview(importTable(), {
      fileName: "current-pfmea.csv",
      fileType: "csv",
      sourceKey: "current-pfmea.csv:100:1",
      tasks: [task],
      zones: [],
      now: NOW,
    });

    const merged = mergePfmeaImport(document, preview);

    expect(merged.rows).toHaveLength(2);
    expect(merged.rows.map((row) => row.failureMode)).toEqual(["Drain cap omitted", "Drain valve left open"]);
    expect(merged.imports).toHaveLength(1);
    expect(mergePfmeaImport(merged, preview)).toBe(merged);
  });
});
