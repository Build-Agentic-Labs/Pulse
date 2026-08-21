import PizZip from "pizzip";
import { describe, expect, it } from "vitest";

import { emptyPlannerState } from "./empty-planner-state";
import { buildPfmeaPrintHtml, buildPfmeaXlsx } from "./pfmea-export";
import { createPfmeaControlProposal, createPfmeaDocumentFromProcedure } from "./pfmea";
import type { Task } from "./types";

function testDocument() {
  const task: Task = {
    id: "task-pfmea-export",
    scenarioId: emptyPlannerState.scenario.id,
    stationId: "station-pfmea-export",
    rowType: "task",
    wbs: "ASM-10",
    manufacturingCode: "ASM-10",
    name: "Install <panel>",
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
    manufacturingSteps: [{ id: "step-pfmea-export", sequence: 1, name: "Fasten panel", instruction: "Fasten panel" }],
    customFields: {},
  };
  const document = createPfmeaDocumentFromProcedure(
    { ...emptyPlannerState.product, id: "product-pfmea-export", name: "FlexBoost & Co" },
    emptyPlannerState.scenario,
    [task],
    emptyPlannerState.zones,
    new Date("2026-08-21T12:00:00.000Z"),
  );
  const row = document.rows[0];
  Object.assign(row, {
    failureMode: "Panel loosens",
    effect: "Loss of function",
    severity: 8,
    cause: "Insufficient torque",
    occurrence: 4,
    currentControls: "Torque specification",
    detection: 5,
    detectionActivity: "Audit torque",
    recommendedActions: "Add witness mark",
    actionOwner: "Quality",
    targetDate: "2026-09-01",
    actionsTaken: "Pilot completed",
    resultOccurrence: 2,
    resultDetection: 2,
  });
  row.controlProposals = [createPfmeaControlProposal(row, {
    target: "checklist",
    title: "Verify witness mark",
    notes: "Operator signoff",
    status: "ready",
  }, new Date("2026-08-21T13:00:00.000Z"))];
  return document;
}

describe("PFMEA exports", () => {
  it("builds an ANA-branded workbook with formulas, controls, and high-RPN formatting", async () => {
    const logo = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const logoBuffer = new ArrayBuffer(logo.byteLength);
    new Uint8Array(logoBuffer).set(logo);
    const blob = await buildPfmeaXlsx(testDocument(), "FlexBoost & Co", logoBuffer);
    const zip = new PizZip(await blob.arrayBuffer());
    const sheet = zip.file("xl/worksheets/sheet1.xml")?.asText() ?? "";

    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(zip.file("xl/media/ana-logo.png")).toBeTruthy();
    expect(zip.file("xl/drawings/drawing1.xml")).toBeTruthy();
    expect(sheet).toContain("E6*G6*I6");
    expect(sheet).toContain("E6*P6*Q6");
    expect(sheet).toContain("[checklist · ready] Verify witness mark");
    expect(sheet).toContain("conditionalFormatting");
    expect(sheet).toContain('state="frozen"');
  });

  it("builds escaped, ANA-branded print HTML with calculated RPN values", () => {
    const html = buildPfmeaPrintHtml(testDocument(), "FlexBoost & Co", "/sop/ana-logo.png");

    expect(html).toContain("FlexBoost &amp; Co PFMEA");
    expect(html).toContain('src="/sop/ana-logo.png"');
    expect(html).toContain("Install &lt;panel&gt;");
    expect(html).toContain("Verify witness mark");
    expect(html).toContain(">160<");
    expect(html).toContain(">32<");
  });
});
