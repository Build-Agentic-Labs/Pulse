/**
 * A representative work instruction for the design preview at
 * `/design/work-instruction`. Same role as `src/domain/sop/sample.ts`.
 *
 * Builds a real `Task` and runs it through `buildWorkInstruction`, rather than
 * hand-assembling cards: the preview is the thing we eyeball print changes on,
 * so it must exercise the production path — splitting, tool/photo lookup,
 * check flattening — not a parallel imitation of it.
 *
 * Every step is ONE SENTENCE. That is the authoring style this template is
 * built around: a card is a glanceable unit of work, and an operator reading it
 * at arm's length on a shop floor should not have to parse a paragraph. The
 * continuation machinery still exists for real data that runs longer — see
 * `split-instruction.ts` and its tests — it is just not what the example models.
 *
 * Deliberately exercises the awkward cases: ten steps (so the document spans
 * the setup sheet plus two step sheets and ends part-filled) and a step with no
 * photo.
 */

import { STEP_PHOTO_ATTACHMENTS_FIELD, type StepPhotoAttachment } from "../step-photos";
import { STEP_TOOL_LISTS_FIELD } from "../step-tools";
import type { ManufacturingStep, Product, Task, Zone } from "../types";
import { buildWorkInstruction } from "./build";
import { DEFAULT_WORK_INSTRUCTION_LAYOUT, type WorkInstruction, type WorkInstructionLayout } from "./schema";

/**
 * A flat panel standing in for a step photo, so the preview shows real photo
 * geometry without shipping a bitmap.
 *
 * Draws no frame, and its fill matches `.wi-card-photo`'s background exactly.
 * Both matter for the same reason: anything the placeholder draws that the slot
 * already provides reads as a box inside a box. A contrasting fill looks fine
 * until the slot's aspect ratio stops matching the viewBox — as it does in v2,
 * where the slot is landscape — and `object-fit: contain` pillarboxes the panel
 * into a visible inner rectangle. Matching the fill makes that invisible at any
 * aspect ratio, and real photos still letterbox against the same neutral, which
 * is what you want behind a photograph.
 */
function placeholderPhoto(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 576"><rect width="400" height="576" fill="#f7f7f7"/><text x="200" y="298" font-family="sans-serif" font-size="28" fill="#b4b4b4" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function check(selected: string[], torque?: number): string {
  return JSON.stringify({
    selected,
    values: torque === undefined ? {} : { torque_required: { value: torque, unit: "Nm" } },
  });
}

interface SampleStep {
  name: string;
  instruction: string;
  minutes: number;
  tools: string[];
  qualityCheck: string;
  /** Exercises the ruled empty photo slot. */
  noPhoto?: boolean;
}

const STEPS: SampleStep[] = [
  {
    name: "Stage the bracket",
    instruction: "Retrieve bracket BRK-1001 from kit KIT-INV-01 and stage it on the fixture.",
    minutes: 4,
    tools: ["Kit cart"],
    qualityCheck: check(["self_qc"]),
  },
  {
    name: "Seat the bracket",
    instruction: "Lower the bracket onto the frame rail so the locating pin passes through the forward hole.",
    minutes: 6,
    tools: ["Lift table"],
    qualityCheck: check(["self_qc"]),
  },
  {
    name: "Start the fasteners",
    instruction: "Hand-start all four M8 flange bolts before running any of them down.",
    minutes: 5,
    tools: ["10mm socket"],
    qualityCheck: check(["critical"]),
  },
  {
    name: "Torque the fasteners",
    instruction: "Torque the four M8 bolts to 45 Nm in a diagonal cross pattern, twice.",
    minutes: 8,
    tools: ["Torque wrench", "10mm socket"],
    qualityCheck: check(["qc", "torque_required"], 45),
  },
  {
    name: "Route the DC harness",
    instruction: "Route the DC harness through the bracket saddle and secure it with two P-clips.",
    minutes: 7,
    tools: ["Nut driver"],
    qualityCheck: check(["self_qc"]),
    noPhoto: true,
  },
  {
    name: "Land the DC leads",
    instruction: "Land the DC leads on the inverter studs, red to plus, and torque each nut to 12 Nm.",
    minutes: 12,
    tools: ["Torque wrench", "13mm socket", "Paint pen"],
    qualityCheck: check(["qc", "critical", "torque_required"], 12),
  },
  {
    name: "Fit the terminal cover",
    instruction: "Fit the clear terminal cover and secure its two captive screws.",
    minutes: 4,
    tools: ["Nut driver"],
    qualityCheck: check(["self_qc"]),
  },
  {
    name: "Fit the shield",
    instruction: "Fit the exhaust shield and secure the three M6 bolts to 9 Nm.",
    minutes: 6,
    tools: ["Torque wrench", "10mm socket"],
    qualityCheck: check(["torque_required"], 9),
  },
  {
    name: "Label the assembly",
    instruction: "Apply the assembly label to the bracket face, reading left to right.",
    minutes: 3,
    tools: [],
    qualityCheck: check(["self_qc"]),
  },
  {
    name: "Final inspection",
    instruction: "Verify every witness mark is intact and the bracket shows no deformation.",
    minutes: 5,
    tools: [],
    qualityCheck: check(["qc"]),
  },
];

const PRODUCT: Product = {
  id: "sample-product",
  name: "EBOSS125-G3",
  productCode: "EB125",
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
};

const ZONE: Zone = {
  id: "sample-zone",
  scenarioId: "sample-scenario",
  sequence: 1,
  name: "Final Assembly",
  code: "FA",
  color: "#888888",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function sampleTask(blank: boolean): Task {
  const steps: ManufacturingStep[] = blank
    ? []
    : STEPS.map((step, index) => ({
        id: `sample-step-${index + 1}`,
        sequence: index + 1,
        name: step.name,
        instruction: step.instruction,
        durationMinutes: step.minutes,
        qualityCheck: step.qualityCheck,
      }));

  const stepToolLists = Object.fromEntries(
    STEPS.map((step, index) => [`sample-step-${index + 1}`, step.tools]).filter(([, tools]) => (tools as string[]).length > 0),
  );

  const stepPhotoAttachments = Object.fromEntries(
    STEPS.flatMap((step, index): Array<[string, StepPhotoAttachment[]]> => {
      if (step.noPhoto) return [];
      const id = `sample-step-${index + 1}`;
      return [
        [
          id,
          [
            {
              id: `sample-photo-${index + 1}`,
              name: step.name,
              dataUrl: placeholderPhoto(`Step ${index + 1}`),
              capturedAt: "2026-08-01T00:00:00.000Z",
              caption: `${step.name} — reference view`,
            },
          ],
        ],
      ];
    }),
  );

  return {
    id: "sample-task",
    scenarioId: "sample-scenario",
    stationId: "sample-station",
    zoneId: ZONE.id,
    manufacturingCode: blank ? undefined : "FA-INV-010",
    rowType: "task",
    wbs: "1.1",
    name: blank ? "" : "Mount and land the inverter bracket",
    description: blank
      ? undefined
      : "Mount the inverter bracket to the frame rail and land the DC leads, ready for the enclosure fit-up in FA-INV-020.",
    plannedStart: "2026-08-04T08:00:00.000Z",
    plannedFinish: "2026-08-04T09:00:00.000Z",
    plannedDurationMinutes: blank ? 0 : 60,
    plannedOperators: blank ? 0 : 2,
    plannedManHours: 2,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: !blank,
    travelerSignoffRequired: false,
    safetyNotes: blank
      ? undefined
      : "Pinch hazard at the fixture. Cut-resistant gloves and safety glasses required. DC bus must be confirmed de-energised and locked out before the leads are landed.",
    materialKit: blank ? undefined : "KIT-INV-01",
    drawingLink: blank ? undefined : "DWG-EB125-1140 rev C",
    sopLink: blank ? undefined : "SOP-MFG-014",
    partReferences: blank
      ? []
      : [
          { id: "p1", partNumber: "BRK-1001", description: "Inverter mounting bracket", quantity: 1 },
          { id: "p2", partNumber: "FAS-M8-45", description: "M8 x 45 flange bolt", quantity: 4 },
          { id: "p3", partNumber: "CLP-P25", description: "P-clip, 25 mm", quantity: 2 },
          { id: "p4", partNumber: "COV-TRM-01", description: "Terminal cover, clear", quantity: 1 },
        ],
    manufacturingSteps: steps,
    customFields: blank
      ? {}
      : { [STEP_TOOL_LISTS_FIELD]: stepToolLists, [STEP_PHOTO_ATTACHMENTS_FIELD]: stepPhotoAttachments },
  };
}

export function sampleWorkInstruction({
  blank = false,
  layout = DEFAULT_WORK_INSTRUCTION_LAYOUT,
}: { blank?: boolean; layout?: WorkInstructionLayout } = {}): WorkInstruction {
  const built = buildWorkInstruction({
    task: sampleTask(blank),
    product: blank ? { ...PRODUCT, name: "", productCode: "", revision: "" } : PRODUCT,
    zone: blank ? undefined : ZONE,
    layout,
  });

  return blank ? { ...built, context: { ...built.context, zoneName: "" } } : built;
}
