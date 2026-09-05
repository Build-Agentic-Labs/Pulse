import { describe, it, expect } from "vitest";
import { STEP_PHOTO_ATTACHMENTS_FIELD } from "../step-photos";
import { STEP_PART_MENTIONS_FIELD } from "../step-part-mentions";
import { STEP_TOOL_LISTS_FIELD } from "../step-tools";
import type { Product, Task, Zone } from "../types";
import { buildWorkInstruction } from "./build";
import { INSTRUCTION_BUDGET, WORK_INSTRUCTION_LAYOUTS } from "./schema";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    scenarioId: "scenario-1",
    stationId: "station-1",
    rowType: "task",
    wbs: "1.1",
    name: "Mount inverter bracket",
    plannedStart: "2026-08-04T08:00:00.000Z",
    plannedFinish: "2026-08-04T09:00:00.000Z",
    plannedDurationMinutes: 60,
    plannedOperators: 2,
    plannedManHours: 2,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    customFields: {},
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    name: "EBOSS125-G3",
    revision: "B",
    ownerName: "R. Lopez",
    status: "released",
    targetManHours: 100,
    demandQuantity: 10,
    demandPeriod: "month",
    grossAvailableMinutes: 480,
    breakMinutes: 0,
    lunchMinutes: 0,
    meetingMinutes: 0,
    plannedDowntimeMinutes: 0,
    workDaysPerWeek: 5,
    workWeeksPerMonth: 4,
    availableWorkDaysPerMonth: 20,
    netAvailableMinutes: 480,
    weeklyAvailableMinutes: 2400,
    monthlyAvailableMinutes: 9600,
    calculatedTaktMinutes: 48,
    activeTaktMinutes: 48,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const zone: Zone = {
  id: "zone-1",
  scenarioId: "scenario-1",
  sequence: 1,
  name: "Final Assembly",
  code: "FA",
  color: "#888888",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("buildWorkInstruction", () => {
  it("mints the document number from the manufacturing code", () => {
    const task = makeTask({ manufacturingCode: "FA-INV-010" });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.meta.documentNumber).toBe("FA-INV-010-WI1");
    expect(wi.meta.title).toBe("Mount inverter bracket");
  });

  it("leaves the document number blank when the task is uncoded", () => {
    const wi = buildWorkInstruction({ task: makeTask(), product: makeProduct(), zone });

    expect(wi.meta.documentNumber).toBe("");
  });

  it("reads tools from the step-id-keyed customFields map, not the task", () => {
    const task = makeTask({
      manufacturingCode: "FA-INV-010",
      toolsRequired: ["task level tool"],
      manufacturingSteps: [
        { id: "step-a", sequence: 1, instruction: "Position the bracket" },
        { id: "step-b", sequence: 2, instruction: "Torque the fasteners" },
      ],
      customFields: {
        [STEP_TOOL_LISTS_FIELD]: {
          "step-a": ["Torque wrench", "10mm socket"],
          "step-b": ["Torque wrench"],
        },
      },
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.cards[0].tools).toEqual(["Torque wrench", "10mm socket"]);
    expect(wi.cards[1].tools).toEqual(["Torque wrench"]);
  });

  it("rolls the setup tool list up from every step plus the task-level lists", () => {
    const task = makeTask({
      toolsRequired: ["Lift table"],
      equipmentRequired: ["Overhead crane"],
      manufacturingSteps: [
        { id: "step-a", sequence: 1, instruction: "A" },
        { id: "step-b", sequence: 2, instruction: "B" },
      ],
      customFields: {
        [STEP_TOOL_LISTS_FIELD]: {
          "step-a": ["Torque wrench", "10mm socket"],
          "step-b": ["Torque wrench"],
        },
      },
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.setup.tools).toEqual(["Torque wrench", "10mm socket", "Lift table", "Overhead crane"]);
  });

  it("binds the first photo of each step by step id", () => {
    const task = makeTask({
      manufacturingSteps: [{ id: "step-a", sequence: 1, instruction: "Position the bracket" }],
      customFields: {
        [STEP_PHOTO_ATTACHMENTS_FIELD]: {
          "step-a": [
            { id: "photo-1", name: "Bracket", dataUrl: "https://example.test/a.jpg", capturedAt: "2026-08-01T00:00:00.000Z", caption: "Bracket seated" },
            { id: "photo-2", name: "Other", dataUrl: "https://example.test/b.jpg", capturedAt: "2026-08-01T00:00:00.000Z" },
          ],
        },
      },
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.cards[0].photo).toEqual({ id: "photo-1", url: "https://example.test/a.jpg", caption: "Bracket seated" });
  });

  it("carries photo annotations and intrinsic dimensions into the printable WI", () => {
    const task = makeTask({
      manufacturingSteps: [{ id: "step-a", sequence: 1, instruction: "Position the bracket" }],
      customFields: {
        [STEP_PHOTO_ATTACHMENTS_FIELD]: {
          "step-a": [
            {
              id: "photo-1",
              name: "Bracket",
              dataUrl: "https://example.test/a.jpg",
              capturedAt: "2026-08-01T00:00:00.000Z",
              width: 1600,
              height: 1200,
              annotations: {
                version: 2,
                items: [
                  {
                    id: "rectangle-1",
                    type: "rectangle",
                    color: "#d71921",
                    strokeWidth: 3,
                    x: 0.1,
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
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.cards[0].photo).toMatchObject({
      width: 1600,
      height: 1200,
      annotations: {
        version: 2,
        items: [expect.objectContaining({ id: "rectangle-1", type: "rectangle" })],
      },
    });
  });

  it("leaves the photo undefined when a step has none", () => {
    const task = makeTask({ manufacturingSteps: [{ id: "step-a", sequence: 1, instruction: "Position" }] });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.cards[0].photo).toBeUndefined();
  });

  it("flattens selected quality checks to labels, with the torque spec rendered", () => {
    const task = makeTask({
      manufacturingSteps: [
        {
          id: "step-a",
          sequence: 1,
          instruction: "Torque the fasteners",
          qualityCheck: JSON.stringify({ selected: ["qc", "torque_required"], values: { torque_required: { value: 45, unit: "Nm" } } }),
        },
      ],
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.cards[0].checks).toEqual([
      { key: "qc", label: "QC", spec: "" },
      { key: "torque_required", label: "Torque Spec", spec: "45 Nm" },
    ]);
  });

  it("keeps a step that fits on a single card", () => {
    const oneBox = "x".repeat(INSTRUCTION_BUDGET.charsPerLine * INSTRUCTION_BUDGET.lines);
    const task = makeTask({ manufacturingSteps: [{ id: "step-a", sequence: 1, instruction: oneBox }] });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.cards).toHaveLength(1);
    expect(wi.cards[0]).toMatchObject({ part: 1, partCount: 1, overflowing: false });
  });

  it("continues an over-long step onto further cards instead of clipping it", () => {
    const sentence = "Torque each nut to twelve newton metres and mark it. ";
    const instruction = sentence.repeat(20).trim();
    const task = makeTask({ manufacturingSteps: [{ id: "step-a", sequence: 1, instruction }] });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.cards.length).toBeGreaterThan(1);
    expect(wi.cards.every((card) => card.sequence === 1)).toBe(true);
    expect(wi.cards.map((card) => card.part)).toEqual([1, 2]);
    expect(wi.cards.every((card) => card.partCount === 2)).toBe(true);
  });

  it("loses no words when a step is continued", () => {
    const sentence = "Torque each nut to twelve newton metres and mark it. ";
    const instruction = sentence.repeat(20).trim();
    const task = makeTask({ manufacturingSteps: [{ id: "step-a", sequence: 1, instruction }] });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.cards.map((card) => card.instruction).join(" ").split(/\s+/)).toEqual(instruction.split(/\s+/));
  });

  it("puts photo, tools and duration on the first part and checks on the last", () => {
    const sentence = "Torque each nut to twelve newton metres and mark it. ";
    const task = makeTask({
      manufacturingSteps: [
        {
          id: "step-a",
          sequence: 1,
          instruction: sentence.repeat(20).trim(),
          durationMinutes: 12,
          qualityCheck: JSON.stringify({ selected: ["qc"], values: {} }),
        },
      ],
      customFields: {
        [STEP_TOOL_LISTS_FIELD]: { "step-a": ["Torque wrench"] },
        [STEP_PHOTO_ATTACHMENTS_FIELD]: {
          "step-a": [{ id: "p1", name: "P", dataUrl: "https://example.test/a.jpg", capturedAt: "2026-08-01T00:00:00.000Z" }],
        },
      },
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });
    const [first, last] = [wi.cards[0], wi.cards[wi.cards.length - 1]];

    expect(first.photo).toBeDefined();
    expect(first.tools).toEqual(["Torque wrench"]);
    expect(first.durationMinutes).toBe(12);
    expect(first.checks).toEqual([]);

    expect(last.photo).toBeUndefined();
    expect(last.tools).toEqual([]);
    expect(last.durationMinutes).toBeUndefined();
    expect(last.checks).toEqual([{ key: "qc", label: "QC", spec: "" }]);
  });

  it("flags a card only when a single token is too wide to break", () => {
    const task = makeTask({
      // One unbreakable token, wider and taller than any card can hold.
      manufacturingSteps: [
        { id: "step-a", sequence: 1, instruction: "x".repeat(INSTRUCTION_BUDGET.charsPerLine * INSTRUCTION_BUDGET.lines * 4) },
      ],
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.cards).toHaveLength(1);
    expect(wi.cards[0].overflowing).toBe(true);
  });

  it("orders cards by step sequence regardless of array order", () => {
    const task = makeTask({
      manufacturingSteps: [
        { id: "step-c", sequence: 3, instruction: "Third" },
        { id: "step-a", sequence: 1, instruction: "First" },
        { id: "step-b", sequence: 2, instruction: "Second" },
      ],
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.cards.map((card) => card.instruction)).toEqual(["First", "Second", "Third"]);
    expect(wi.cards.map((card) => card.sequence)).toEqual([1, 2, 3]);
  });

  it("carries the setup sheet content across from the task", () => {
    const task = makeTask({
      description: "Mount the inverter bracket to the frame rail.",
      safetyNotes: "Pinch hazard. Gloves and safety glasses required.",
      materialKit: "KIT-INV-01",
      drawingLink: "https://example.test/drawing.pdf",
      sopLink: "SOP-MFG-014",
      qualityGate: true,
      partReferences: [
        { id: "part-1", partNumber: "BRK-1001", description: "Inverter bracket", quantity: 1 },
        { id: "part-2", partNumber: "FAS-M8", description: "M8 flange bolt", quantity: 4 },
      ],
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.setup.purpose).toBe("Mount the inverter bracket to the frame rail.");
    expect(wi.setup.safetyNotes).toBe("Pinch hazard. Gloves and safety glasses required.");
    expect(wi.setup.drawingLink).toBe("https://example.test/drawing.pdf");
    expect(wi.setup.sopLink).toBe("SOP-MFG-014");
    expect(wi.setup.qualityGate).toBe(true);
    expect(wi.setup.plannedDurationMinutes).toBe(60);
    expect(wi.setup.plannedOperators).toBe(2);
  });

  it("adds numbered part markers and full step allocation details without changing the authored instruction", () => {
    const task = makeTask({
      manufacturingSteps: [
        {
          id: "step-a",
          sequence: 1,
          instruction: "Mount M8 bolts",
          partReferenceIds: ["part-1"],
          partReferenceQuantities: { "part-1": 4 },
        },
      ],
      partReferences: [
        {
          id: "part-1",
          partNumber: "1000000373",
          description: "BOLT SEMS M8-1.25 X 25MM LONG HHCS W/SPRING&FLAT WASHER STAINLESS STEEL",
          quantity: 99,
        },
      ],
      customFields: {
        [STEP_PART_MENTIONS_FIELD]: {
          "step-a": [
            { id: "mention-1", partReferenceId: "part-1", text: "M8 bolts", start: 6, end: 14 },
          ],
        },
      },
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(task.manufacturingSteps?.[0].instruction).toBe("Mount M8 bolts");
    expect(wi.cards[0].instruction).toBe("Mount M8 bolts[1]");
    expect(wi.cards[0].partReferences).toEqual([
      {
        marker: 1,
        text: "M8 bolts",
        partNumber: "1000000373",
        description: "BOLT SEMS M8-1.25 X 25MM LONG HHCS W/SPRING&FLAT WASHER STAINLESS STEEL",
        quantity: 4,
      },
    ]);
    expect(wi.setup.parts[0].quantity).toBe(4);
  });

  it.each(Object.values(WORK_INSTRUCTION_LAYOUTS))("keeps a part key with a citation that moves to a continuation in $label", (layout) => {
    const instruction = `${"Prepare the next connection.\n".repeat(20)}Install M8 bolts`;
    const start = instruction.indexOf("M8 bolts");
    const task = makeTask({
      manufacturingSteps: [{
        id: "step-a", sequence: 1, instruction,
        partReferenceIds: ["part-1"], partReferenceQuantities: { "part-1": 4 },
      }],
      partReferences: [{ id: "part-1", partNumber: "BOLT-M8", description: "M8 flange bolt", quantity: 4 }],
      customFields: {
        [STEP_PART_MENTIONS_FIELD]: {
          "step-a": [{ id: "mention-1", partReferenceId: "part-1", text: "M8 bolts", start, end: start + 8 }],
        },
      },
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone, layout });
    const citedCard = wi.cards.find((card) => card.instruction.includes("[1]"));
    expect(citedCard?.part).toBeGreaterThan(1);
    expect(citedCard?.partReferences).toEqual([{
      marker: 1, text: "M8 bolts", partNumber: "BOLT-M8", description: "M8 flange bolt", quantity: 4,
    }]);
    expect(wi.cards.filter((card) => card.part > 1 && !card.instruction.includes("[1]"))
      .every((card) => card.partReferences?.length === 0)).toBe(true);
    expect(wi.cards.map((card) => card.instruction).join(" ").replace("[1]", "").split(/\s+/))
      .toEqual(instruction.split(/\s+/));
    expect(wi.cards.every((card) => !card.overflowing)).toBe(true);
    expect(task.manufacturingSteps?.[0].instruction).toBe(instruction);
  });

  it("folds the material kit into the parts list as its first row", () => {
    const task = makeTask({
      materialKit: "KIT-INV-01",
      partReferences: [
        { id: "part-1", partNumber: "BRK-1001", description: "Inverter bracket", quantity: 1 },
        { id: "part-2", partNumber: "FAS-M8", description: "M8 flange bolt", quantity: 4 },
      ],
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.setup.parts).toEqual([
      { partNumber: "KIT-INV-01", description: "Material kit", quantity: 1 },
      { partNumber: "BRK-1001", description: "Inverter bracket", quantity: 1 },
      { partNumber: "FAS-M8", description: "M8 flange bolt", quantity: 4 },
    ]);
  });

  it("omits the kit row when the task has no material kit", () => {
    const task = makeTask({
      partReferences: [{ id: "part-1", partNumber: "BRK-1001", description: "Inverter bracket", quantity: 1 }],
    });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.setup.parts).toEqual([{ partNumber: "BRK-1001", description: "Inverter bracket", quantity: 1 }]);
  });

  it("carries product and zone context for the header band", () => {
    const task = makeTask({ manufacturingCode: "FA-INV-010" });
    const product = makeProduct({ productCode: "EB125", revision: "C" });

    const wi = buildWorkInstruction({ task, product, zone });

    expect(wi.context).toEqual({
      productName: "EBOSS125-G3",
      productCode: "EB125",
      productRevision: "C",
      zoneName: "Final Assembly",
      manufacturingCode: "FA-INV-010",
    });
  });

  it("falls back to Unzoned when the task has no zone", () => {
    const wi = buildWorkInstruction({ task: makeTask(), product: makeProduct(), zone: undefined });

    expect(wi.context.zoneName).toBe("Unzoned");
  });

  it("marks an instruction blank when the task has no steps", () => {
    const wi = buildWorkInstruction({ task: makeTask(), product: makeProduct(), zone });

    expect(wi.blank).toBe(true);
    expect(wi.cards).toEqual([]);
  });

  it("is not blank once the task has a step", () => {
    const task = makeTask({ manufacturingSteps: [{ id: "step-a", sequence: 1, instruction: "Position" }] });

    const wi = buildWorkInstruction({ task, product: makeProduct(), zone });

    expect(wi.blank).toBe(false);
  });

  it("leaves the approval fields blank for the future control layer", () => {
    const wi = buildWorkInstruction({ task: makeTask(), product: makeProduct(), zone });

    expect(wi.meta.preparedBy).toBe("");
    expect(wi.meta.reviewedBy).toBe("");
    expect(wi.meta.approvedBy).toBe("");
    expect(wi.meta.revisionHistory).toEqual([]);
  });
});
