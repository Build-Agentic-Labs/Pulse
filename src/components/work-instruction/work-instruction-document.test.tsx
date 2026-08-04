import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CARDS_ON_FIRST_SHEET,
  CARDS_PER_SHEET,
  type WorkInstruction,
  type WorkInstructionCard,
} from "@/domain/work-instruction/schema";
import { WorkInstructionDocument } from "./work-instruction-document";

function makeCard(sequence: number, overrides: Partial<WorkInstructionCard> = {}): WorkInstructionCard {
  return {
    stepId: `step-${sequence}`,
    sequence,
    part: 1,
    partCount: 1,
    code: `FA-INV-010-WI1-${String(sequence).padStart(3, "0")}`,
    name: `Step ${sequence}`,
    instruction: `Do thing ${sequence}`,
    overflowing: false,
    tools: [],
    checks: [],
    ...overrides,
  };
}

function makeInstruction(cards: WorkInstructionCard[], overrides: Partial<WorkInstruction> = {}): WorkInstruction {
  return {
    taskId: "task-1",
    meta: {
      documentNumber: "FA-INV-010-WI1",
      title: "Mount inverter bracket",
      revision: "B",
      effectiveDate: "",
      preparedBy: "",
      reviewedBy: "",
      approvedBy: "",
      revisionHistory: [],
    },
    context: {
      productName: "EBOSS125-G3",
      productCode: "EB125",
      productRevision: "B",
      zoneName: "Final Assembly",
      manufacturingCode: "FA-INV-010",
    },
    setup: {
      purpose: "Mount the inverter bracket to the frame rail.",
      safetyNotes: "Pinch hazard.",
      tools: ["Torque wrench"],
      parts: [{ partNumber: "BRK-1001", description: "Inverter bracket", quantity: 1 }],
      materialKit: "KIT-INV-01",
      drawingLink: "https://example.test/drawing.pdf",
      sopLink: "SOP-MFG-014",
      plannedDurationMinutes: 60,
      plannedOperators: 2,
      qualityGate: true,
    },
    cards,
    blank: cards.length === 0,
    ...overrides,
  };
}

function sheets(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".wi-sheet"));
}

describe("WorkInstructionDocument", () => {
  it("fits a three-step instruction on one sheet", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1), makeCard(2), makeCard(3)])} />);

    expect(sheets()).toHaveLength(1);
  });

  it("starts the procedure on the setup sheet to save a page", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1), makeCard(2), makeCard(3), makeCard(4)])} />);

    const first = sheets()[0];
    expect(first.querySelector(".wi-setup-band")).not.toBeNull();
    expect(first.querySelectorAll(".wi-card")).toHaveLength(CARDS_ON_FIRST_SHEET);
    expect(sheets()[1].querySelectorAll(".wi-card")).toHaveLength(CARDS_PER_SHEET);
  });

  it("puts the ANA logo and document number in the header of every sheet", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1), makeCard(2), makeCard(3), makeCard(4)])} />);

    expect(screen.getAllByAltText("ANA Inc.")).toHaveLength(2);
    expect(screen.getAllByText("FA-INV-010-WI1")).toHaveLength(2);
  });

  it("numbers each sheet page N of M", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1), makeCard(2), makeCard(3), makeCard(4)])} />);

    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("carries the ANA confidentiality line on every sheet", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1)])} />);

    const lines = document.querySelectorAll(".wi-ftr-confidential");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent(
      "ANA INC. CONFIDENTIAL: This copyrighted work and all information is the property of ANA INC. All rights reserved",
    );
  });

  it("repeats the safety notes in every sheet header, not only on the setup sheet", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1), makeCard(2), makeCard(3), makeCard(4)])} />);

    // The whole point of the header strip: an operator working from sheet 2
    // must not have to flip back to sheet 1 to see the hazard.
    expect(document.querySelectorAll(".wi-hdr-safety")).toHaveLength(2);
    expect(screen.getAllByText("Pinch hazard.")).toHaveLength(3);
  });

  it("lists setup tools, parts and references", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1)])} />);

    expect(screen.getByText("Torque wrench")).toBeInTheDocument();
    expect(screen.getByText("BRK-1001")).toBeInTheDocument();
    expect(screen.getByText("Inverter bracket")).toBeInTheDocument();
    expect(screen.getByText("KIT-INV-01")).toBeInTheDocument();
    expect(screen.getByText("SOP-MFG-014")).toBeInTheDocument();
  });

  it("pads the setup sheet's card row with ruled blanks", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1)])} />);

    expect(document.querySelectorAll(".wi-card")).toHaveLength(CARDS_ON_FIRST_SHEET);
    expect(document.querySelectorAll(".wi-card-blank")).toHaveLength(CARDS_ON_FIRST_SHEET - 1);
  });

  it("renders the step photo when present and a ruled placeholder when not", () => {
    const withPhoto = makeCard(1, { photo: { id: "p1", url: "https://example.test/a.jpg", caption: "Bracket seated" } });
    render(<WorkInstructionDocument instruction={makeInstruction([withPhoto, makeCard(2)])} />);

    expect(screen.getByAltText("Bracket seated")).toBeInTheDocument();
    // One empty slot for the photo-less real card; blank padding cards also draw one.
    expect(document.querySelectorAll(".wi-card-photo-empty").length).toBeGreaterThanOrEqual(1);
  });

  it("shows per-step tools and checks on the card", () => {
    const card = makeCard(1, {
      tools: ["Torque wrench", "10mm socket"],
      checks: [{ key: "torque_required", label: "Torque Spec", spec: "45 Nm" }],
    });
    render(<WorkInstructionDocument instruction={makeInstruction([card])} />);

    expect(screen.getByText("Torque wrench, 10mm socket")).toBeInTheDocument();
    expect(screen.getByText("Torque Spec")).toBeInTheDocument();
    expect(screen.getByText("45 Nm")).toBeInTheDocument();
  });

  it("marks an unbreakable card loudly instead of clipping its text", () => {
    const long = "x".repeat(2000);
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1, { overflowing: true, instruction: long })])} />);

    expect(document.querySelectorAll(".wi-card-overflowing")).toHaveLength(1);
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  it("labels a continued step and drops its photo column", () => {
    const cards = [
      makeCard(1, { part: 1, partCount: 2, instruction: "First half." }),
      makeCard(1, { part: 2, partCount: 2, instruction: "Second half." }),
    ];
    render(<WorkInstructionDocument instruction={makeInstruction(cards)} />);

    expect(screen.getByText("(1 of 2)")).toBeInTheDocument();
    expect(screen.getByText("(2 of 2)")).toBeInTheDocument();
    expect(document.querySelectorAll(".wi-card-continued")).toHaveLength(1);
    // The continuation drops the photo slot entirely so text runs full width.
    expect(document.querySelectorAll(".wi-card-continued .wi-card-photo")).toHaveLength(0);
  });

  it("prints no signature or approval surface anywhere", () => {
    // A repeated master carries no sign-off; signatures live on the referenced
    // checklist action.
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1)])} />);

    expect(document.querySelectorAll(".wi-card-signoff")).toHaveLength(0);
    expect(screen.queryByText("Prepared by")).not.toBeInTheDocument();
    expect(screen.queryByText("Reviewed by")).not.toBeInTheDocument();
    expect(screen.queryByText("Approved by")).not.toBeInTheDocument();
    expect(screen.queryByText("Op")).not.toBeInTheDocument();
    expect(screen.queryByText("QA")).not.toBeInTheDocument();
  });

  it("still draws the ruled revision history, which is not a signature", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1)])} />);

    expect(screen.getByText("Revision history")).toBeInTheDocument();
  });

  it("renders ruled blank slots across both sheets for an empty instruction", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([])} />);

    expect(sheets()).toHaveLength(2);
    expect(document.querySelectorAll(".wi-card-blank")).toHaveLength(CARDS_ON_FIRST_SHEET + CARDS_PER_SHEET);
  });

  it("renders several instructions back to back for batch printing", () => {
    const first = makeInstruction([makeCard(1)]);
    const second = { ...makeInstruction([makeCard(1)]), taskId: "task-2" };
    render(<WorkInstructionDocument instruction={first} />);
    render(<WorkInstructionDocument instruction={second} />);

    expect(sheets()).toHaveLength(2);
  });
});
