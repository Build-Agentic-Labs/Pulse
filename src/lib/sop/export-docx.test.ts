import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { createEmptySop } from "@/domain/sop/schema";
import { applySampleData } from "@/domain/sop/sample";
import { exportSopToDocx } from "./export-docx";

describe("exportSopToDocx — Procedure flowchart", () => {
  it("renders the Procedure as a borderless flowchart (boxed steps + arrows), not a grid table", async () => {
    const sop = applySampleData(createEmptySop("verify", "2026-01-01T00:00:00.000Z"));
    const blob = await exportSopToDocx(sop);
    const xml = new PizZip(Buffer.from(await blob.arrayBuffer())).file("word/document.xml")!.asText();

    // Each step is a box drawn with a paragraph border (pBdr) -> at least one per activity.
    const stepBoxes = (xml.match(/<w:pBdr>/g) || []).length;
    expect(stepBoxes).toBeGreaterThanOrEqual(sop.procedure.activities.length);

    // Steps are joined by down-arrows: one fewer than the number of steps.
    expect((xml.match(/↓/g) || []).length).toBe(sop.procedure.activities.length - 1);

    // The new Input/Output columns round-trip into the document.
    expect(xml).toContain("ISO 9001 requirements");
    expect(xml).toContain("Officially released SOP");

    // The written "Procedure steps" list was intentionally dropped — the flowchart is the procedure.
    expect(xml).not.toContain("Procedure steps");

    // Back matter still begins on a fresh page (no crowding / orphaning).
    const paraBefore = (marker: string) => {
      const head = xml.slice(0, xml.indexOf(marker));
      return head.slice(head.lastIndexOf("<w:p>"));
    };
    expect(paraBefore("Annexes")).toContain("pageBreakBefore");
  });
});
