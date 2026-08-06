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
  it("lets modal previews expand across every printed sheet", () => {
    const { container } = render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1)])} />);
    const printStyles = container.querySelector("style")?.textContent ?? "";

    expect(printStyles).toContain("html, body");
    expect(printStyles).toContain("height: auto !important");
    expect(printStyles).toContain(".wi-print-root.wi-print-modal");
    expect(printStyles).toContain("position: static !important");
    expect(printStyles).toContain(".wi-print-root.wi-print-modal .wi-print-body");
    expect(printStyles).toContain("overflow: visible !important");
  });

  it("fits a first-row-sized instruction on one sheet", () => {
    const cards = Array.from({ length: CARDS_ON_FIRST_SHEET }, (_, index) => makeCard(index + 1));
    render(<WorkInstructionDocument instruction={makeInstruction(cards)} />);

    expect(sheets()).toHaveLength(1);
  });

  it("starts the procedure on the setup sheet to save a page", () => {
    const cards = Array.from({ length: CARDS_ON_FIRST_SHEET + 1 }, (_, index) => makeCard(index + 1));
    render(<WorkInstructionDocument instruction={makeInstruction(cards)} />);

    const first = sheets()[0];
    expect(first.querySelector(".wi-setup-band")).not.toBeNull();
    expect(first.querySelectorAll(".wi-card")).toHaveLength(CARDS_ON_FIRST_SHEET);
    expect(sheets()[1].querySelectorAll(".wi-card")).toHaveLength(CARDS_PER_SHEET);
  });

  it("puts the ANA logo and document number in the header of every sheet", () => {
    render(
      <WorkInstructionDocument
        instruction={makeInstruction(Array.from({ length: CARDS_ON_FIRST_SHEET + 1 }, (_, i) => makeCard(i + 1)))}
      />,
    );

    expect(screen.getAllByAltText("ANA Inc.")).toHaveLength(2);
    expect(screen.getAllByText("FA-INV-010-WI1")).toHaveLength(2);
  });

  it("numbers each sheet page N of M", () => {
    render(
      <WorkInstructionDocument
        instruction={makeInstruction(Array.from({ length: CARDS_ON_FIRST_SHEET + 1 }, (_, i) => makeCard(i + 1)))}
      />,
    );

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

  it("keeps safety on the sheet canvas, not in the header", () => {
    render(
      <WorkInstructionDocument
        instruction={makeInstruction(Array.from({ length: CARDS_ON_FIRST_SHEET + 1 }, (_, i) => makeCard(i + 1)))}
      />,
    );

    // The header carries document control only; safety is a canvas block, so it
    // appears once on the setup sheet rather than on every sheet.
    expect(screen.getByText("Pinch hazard.")).toBeInTheDocument();
    expect(document.querySelectorAll(".wi-hdr-safety")).toHaveLength(0);
  });

  it("puts revision history and production data in every sheet header", () => {
    render(
      <WorkInstructionDocument
        instruction={makeInstruction(Array.from({ length: CARDS_ON_FIRST_SHEET + 1 }, (_, i) => makeCard(i + 1)))}
      />,
    );

    expect(screen.getAllByText("Revision history")).toHaveLength(2);
    expect(screen.getAllByText("Production data")).toHaveLength(2);
    expect(document.querySelectorAll(".wi-hdr-rev")).toHaveLength(2);
    // and nowhere on the canvas
    expect(document.querySelectorAll(".wi-setup .wi-hdr-rev")).toHaveLength(0);
  });

  it("lists setup tools, parts and references", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1)])} />);

    expect(screen.getByText("Torque wrench")).toBeInTheDocument();
    expect(screen.getByText("BRK-1001")).toBeInTheDocument();
    expect(screen.getByText("Inverter bracket")).toBeInTheDocument();
    expect(screen.getByText("SOP-MFG-014")).toBeInTheDocument();
  });

  it("renders one equal-height container per setup block, with no material-kit block", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1)])} />);

    // Purpose, Safety, Tools, Parts, References — the kit is a parts row now.
    expect(document.querySelectorAll(".wi-setup > .wi-block")).toHaveLength(5);
    expect(screen.queryByText("Material kit")).not.toBeInTheDocument();
  });

  it("pads the setup sheet's card row with ruled blanks", () => {
    render(<WorkInstructionDocument instruction={makeInstruction([makeCard(1)])} />);

    expect(document.querySelectorAll(".wi-card")).toHaveLength(CARDS_ON_FIRST_SHEET);
    expect(document.querySelectorAll(".wi-card-blank")).toHaveLength(CARDS_ON_FIRST_SHEET - 1);
  });

  it("reserves the caption row on every card so photo slots match in height", () => {
    // jsdom has no layout, so this asserts the structural cause rather than the
    // rendered height: a card that omitted the caption row let its photo slot
    // absorb that height and print visibly taller than its neighbours.
    const withPhoto = makeCard(1, { photo: { id: "p1", url: "https://example.test/a.jpg", caption: "Bracket seated" } });
    const withoutPhoto = makeCard(2);
    const continued = makeCard(3, { part: 2, partCount: 2 });
    render(<WorkInstructionDocument instruction={makeInstruction([withPhoto, withoutPhoto, continued])} />);

    const cards = document.querySelectorAll(".wi-card");
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.querySelectorAll(".wi-card-caption")).toHaveLength(1);
    }
  });

  it("distinguishes a real step with no photo from an empty fill-in slot", () => {
    const withPhoto = makeCard(1, { photo: { id: "p1", url: "https://example.test/a.jpg", caption: "Bracket seated" } });
    render(<WorkInstructionDocument instruction={makeInstruction([withPhoto, makeCard(2)])} />);

    expect(screen.getByAltText("Bracket seated")).toBeInTheDocument();
    expect(screen.getByAltText("Bracket seated").parentElement?.classList.contains("wi-card-photo-populated")).toBe(true);

    // The photo-less REAL card reads as absence, not as somewhere to write.
    const missing = document.querySelectorAll(".wi-card-photo-missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toHaveTextContent("No photo");
    expect(missing[0].classList.contains("wi-rule-lines")).toBe(false);

    // Ruled writing lines belong only to the blank padding slot.
    for (const ruled of document.querySelectorAll(".wi-rule-lines")) {
      expect(ruled.closest(".wi-card-blank")).not.toBeNull();
    }
  });

  it("renders saved photo annotations into WI preview and print markup", () => {
    const annotated = makeCard(1, {
      photo: {
        id: "p1",
        url: "https://example.test/a.jpg",
        caption: "Annotated bracket",
        width: 800,
        height: 600,
        annotations: {
          version: 2,
          items: [
            {
              id: "arrow-1",
              type: "arrow",
              color: "#d71921",
              strokeWidth: 3,
              x1: 0.1,
              y1: 0.1,
              x2: 0.3,
              y2: 0.3,
            },
            {
              id: "rectangle-1",
              type: "rectangle",
              color: "#007aff",
              strokeWidth: 2.5,
              x: 0.2,
              y: 0.2,
              width: 0.3,
              height: 0.25,
            },
            {
              id: "ellipse-1",
              type: "ellipse",
              color: "#4a9e5c",
              strokeWidth: 2.5,
              x: 0.45,
              y: 0.15,
              width: 0.25,
              height: 0.3,
            },
            {
              id: "highlight-1",
              type: "highlight",
              color: "#ffcc00",
              strokeWidth: 2,
              x: 0.1,
              y: 0.55,
              width: 0.4,
              height: 0.15,
              opacity: 0.26,
            },
            {
              id: "freehand-1",
              type: "freehand",
              color: "#d71921",
              strokeWidth: 3,
              points: [
                { x: 0.6, y: 0.6 },
                { x: 0.7, y: 0.7 },
              ],
            },
            {
              id: "text-1",
              type: "text",
              color: "#d71921",
              fontSize: 14,
              anchorX: 0.72,
              anchorY: 0.45,
              x: 0.5,
              y: 0.75,
              width: 0.3,
              height: 0.12,
              text: "Inspect here",
            },
          ],
        },
      },
    });

    render(<WorkInstructionDocument instruction={makeInstruction([annotated])} />);

    expect(screen.getByRole("img", { name: "Annotated bracket" })).toHaveClass("wi-card-photo-svg");
    for (const type of ["arrow", "rectangle", "ellipse", "highlight", "freehand", "text"]) {
      expect(document.querySelector(`[data-annotation-type="${type}"]`)).not.toBeNull();
    }
    expect(screen.getByText("Inspect here")).toBeInTheDocument();
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
