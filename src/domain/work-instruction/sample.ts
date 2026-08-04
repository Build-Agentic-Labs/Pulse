/**
 * A representative work instruction for the design preview at
 * `/design/work-instruction`. Same role as `src/domain/sop/sample.ts`.
 *
 * Deliberately exercises the awkward cases: eight steps (so the document spans
 * two step sheets and the last one pads with blanks), a step with no photo, and
 * a step whose text overflows the card budget.
 */

import { INSTRUCTION_BUDGET_CHARS, type WorkInstruction, type WorkInstructionCard } from "./schema";

/** A flat grey frame with a caption, so the preview shows real photo geometry without shipping a bitmap. */
function placeholderPhoto(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 520"><rect width="400" height="520" fill="#dcdcdc"/><rect x="14" y="14" width="372" height="492" fill="none" stroke="#9a9a9a" stroke-width="3"/><text x="200" y="270" font-family="sans-serif" font-size="30" fill="#6a6a6a" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface SampleStep {
  name: string;
  instruction: string;
  tools?: string[];
  checks?: WorkInstructionCard["checks"];
  durationMinutes?: number;
  /** Exercises the ruled empty photo slot. */
  noPhoto?: boolean;
}

const STEPS: SampleStep[] = [
  {
    name: "Stage the bracket",
    instruction: "Retrieve the inverter bracket from kit KIT-INV-01. Confirm the part number stamped on the web reads BRK-1001 before staging it on the fixture.",
    tools: ["Kit cart"],
    checks: [{ key: "self_qc", label: "Self QC", spec: "" }],
    durationMinutes: 4,
  },
  {
    name: "Seat the bracket",
    instruction: "Lower the bracket onto the frame rail so the locating pin passes through the forward hole. The bracket must sit flat with no visible gap at the rail face.",
    tools: ["Lift table"],
    checks: [{ key: "self_qc", label: "Self QC", spec: "" }],
    durationMinutes: 6,
  },
  {
    name: "Start the fasteners",
    instruction: "Hand-start all four M8 flange bolts. Do not run any bolt down until all four are started, or the bracket will pull out of square.",
    tools: ["10mm socket"],
    checks: [{ key: "critical", label: "Critical", spec: "" }],
    durationMinutes: 5,
  },
  {
    name: "Torque the fasteners",
    instruction: "Torque the four M8 bolts to 45 Nm in a diagonal cross pattern, then repeat the sequence a second time to confirm.",
    tools: ["Torque wrench", "10mm socket"],
    checks: [
      { key: "torque_required", label: "Torque Spec", spec: "45 Nm" },
      { key: "qc", label: "QC", spec: "" },
    ],
    durationMinutes: 8,
  },
  {
    name: "Route the DC harness",
    instruction: "Route the DC harness through the bracket saddle and secure with two P-clips. Keep at least 25 mm of clearance from the exhaust shield.",
    tools: ["Nut driver"],
    checks: [{ key: "self_qc", label: "Self QC", spec: "" }],
    durationMinutes: 7,
    noPhoto: true,
  },
  {
    name: "Land the DC leads",
    // Deliberately past INSTRUCTION_BUDGET_CHARS so the preview demonstrates the
    // loud overflow state rather than silently clipping.
    instruction:
      "Land the positive and negative leads on the inverter studs. Observe polarity: the red lead lands on the stud marked +, the black on the stud marked -. Torque each nut to 12 Nm, then apply a witness mark across the nut and stud with a paint pen. Confirm the witness mark is unbroken before proceeding, and photograph both terminals for the build record. Any lead showing strand damage must be replaced, not repaired. Do not reuse a nut that has been torqued and backed off; draw a replacement from KIT-INV-01 and record the swap on the traveler. If either stud shows thread damage, stop and raise a nonconformance before continuing — do not chase the thread in place.",
    tools: ["Torque wrench", "13mm socket", "Paint pen"],
    checks: [
      { key: "torque_required", label: "Torque Spec", spec: "12 Nm" },
      { key: "critical", label: "Critical", spec: "" },
      { key: "qc", label: "QC", spec: "" },
    ],
    durationMinutes: 12,
  },
  {
    name: "Fit the terminal cover",
    instruction: "Fit the clear terminal cover and secure the two captive screws. The cover must fully seat with no harness pinched under the lip.",
    tools: ["Nut driver"],
    checks: [{ key: "self_qc", label: "Self QC", spec: "" }],
    durationMinutes: 4,
  },
  {
    name: "Final inspection",
    instruction: "Verify all witness marks are intact, the harness is clear of the exhaust shield, and the bracket shows no deformation.",
    tools: [],
    checks: [{ key: "qc", label: "QC", spec: "" }],
    durationMinutes: 5,
  },
];

export function sampleWorkInstruction({ blank = false }: { blank?: boolean } = {}): WorkInstruction {
  const cards: WorkInstructionCard[] = blank
    ? []
    : STEPS.map((step, index) => {
        const sequence = index + 1;
        return {
          stepId: `step-${sequence}`,
          sequence,
          code: `FA-INV-010-WI1-${String(sequence * 10).padStart(3, "0")}`,
          name: step.name,
          instruction: step.instruction,
          overflowing: step.instruction.length > INSTRUCTION_BUDGET_CHARS,
          durationMinutes: step.durationMinutes,
          tools: step.tools ?? [],
          checks: step.checks ?? [],
          photo: step.noPhoto
            ? undefined
            : { id: `photo-${sequence}`, url: placeholderPhoto(`Step ${sequence}`), caption: `${step.name} — reference view` },
        };
      });

  return {
    taskId: "sample",
    meta: {
      documentNumber: blank ? "" : "FA-INV-010-WI1",
      title: blank ? "" : "Mount and land the inverter bracket",
      revision: blank ? "" : "B",
      effectiveDate: blank ? "" : "2026-08-04",
      preparedBy: "",
      reviewedBy: "",
      approvedBy: "",
      revisionHistory: [],
    },
    context: {
      productName: blank ? "" : "EBOSS125-G3",
      productCode: blank ? "" : "EB125",
      productRevision: blank ? "" : "B",
      zoneName: blank ? "" : "Final Assembly",
      manufacturingCode: blank ? "" : "FA-INV-010",
    },
    setup: {
      purpose: blank ? "" : "Mount the inverter bracket to the frame rail and land the DC leads, ready for the enclosure fit-up in FA-INV-020.",
      safetyNotes: blank ? "" : "Pinch hazard at the fixture. Cut-resistant gloves and safety glasses required. DC bus must be confirmed de-energised and locked out before the leads are landed.",
      tools: blank ? [] : ["Torque wrench", "10mm socket", "13mm socket", "Nut driver", "Paint pen", "Lift table", "Kit cart"],
      parts: blank
        ? []
        : [
            { partNumber: "BRK-1001", description: "Inverter mounting bracket", quantity: 1 },
            { partNumber: "FAS-M8-45", description: "M8 x 45 flange bolt", quantity: 4 },
            { partNumber: "CLP-P25", description: "P-clip, 25 mm", quantity: 2 },
            { partNumber: "COV-TRM-01", description: "Terminal cover, clear", quantity: 1 },
          ],
      materialKit: blank ? "" : "KIT-INV-01",
      drawingLink: blank ? "" : "DWG-EB125-1140 rev C",
      sopLink: blank ? "" : "SOP-MFG-014",
      plannedDurationMinutes: blank ? 0 : 51,
      plannedOperators: blank ? 0 : 2,
      qualityGate: !blank,
    },
    cards,
    blank,
  };
}
