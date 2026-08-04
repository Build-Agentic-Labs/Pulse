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

describe("exportSopToDocx — References", () => {
  it("renders linked SOPs, then uploaded documents, then free-text references", async () => {
    const sop = applySampleData(createEmptySop("verify", "2026-01-01T00:00:00.000Z"));
    sop.linkedSops = [{ sopId: "other", sopNumber: "SOP-QA-002", title: "Document Control" }];
    sop.referenceDocs = [{ id: "refdoc-1", name: "Supplier Quality Agreement.pdf" }];
    const blob = await exportSopToDocx(sop);
    const xml = new PizZip(Buffer.from(await blob.arrayBuffer())).file("word/document.xml")!.asText();

    const linked = xml.indexOf("SOP-QA-002 — Document Control");
    const uploaded = xml.indexOf("Supplier Quality Agreement.pdf");
    const freeText = xml.indexOf("Quality Manual QM-01");
    expect(linked).toBeGreaterThan(-1);
    expect(uploaded).toBeGreaterThan(linked);
    expect(freeText).toBeGreaterThan(uploaded);
  });
});

describe("exportSopToDocx — Procedure narrative structure", () => {
  it("renders detected headings as bold body-size paragraphs (not Word Heading style)", async () => {
    const sop = createEmptySop("verify", "2026-01-01T00:00:00.000Z");
    sop.procedure.processFlowDescription = "4.4 Document Creation\nBody line.";
    const blob = await exportSopToDocx(sop);
    const xml = new PizZip(Buffer.from(await blob.arrayBuffer())).file("word/document.xml")!.asText();

    // Heading should appear as text with bold (<w:b/>) and body size (w:sz="20").
    const headingIdx = xml.indexOf("4.4 Document Creation");
    expect(headingIdx).toBeGreaterThan(-1);

    // Look backward from the heading text to find its run properties.
    const contextBefore = xml.substring(Math.max(0, headingIdx - 300), headingIdx);
    expect(contextBefore).toContain("<w:b/>");
    expect(contextBefore).toContain('<w:sz w:val="20"/>');

    // Verify body line appears after the heading.
    const afterHeading = xml.substring(headingIdx);
    expect(afterHeading).toContain("Body line.");
  });

  it("collapses consecutive bullet lines into a single Word bullet list (no prefix in text)", async () => {
    const sop = createEmptySop("verify", "2026-01-01T00:00:00.000Z");
    sop.procedure.processFlowDescription = "• First item\n• Second item";
    const blob = await exportSopToDocx(sop);
    const xml = new PizZip(Buffer.from(await blob.arrayBuffer())).file("word/document.xml")!.asText();

    // Both items should appear in the text (without the bullet prefix).
    expect(xml).toContain("First item");
    expect(xml).toContain("Second item");

    // Bullet prefix should NOT appear in the text runs (Word renders the bullet itself).
    // The classifyProcedureLine strips the "• " prefix before passing to bulletList.
    expect(xml).not.toContain("• First item");
    expect(xml).not.toContain("• Second item");

    // Both items should be part of bullet lists (contain <w:numPr> in their paragraphs).
    // Find the first item and check it's in a bullet list paragraph.
    const firstIdx = xml.indexOf("First item");
    expect(firstIdx).toBeGreaterThan(-1);
    const firstContext = xml.substring(Math.max(0, firstIdx - 500), firstIdx + 100);
    expect(firstContext).toContain("<w:numPr>");

    // Same for second item.
    const secondIdx = xml.indexOf("Second item");
    expect(secondIdx).toBeGreaterThan(-1);
    const secondContext = xml.substring(Math.max(0, secondIdx - 500), secondIdx + 100);
    expect(secondContext).toContain("<w:numPr>");
  });

  it("renders blank lines as empty paragraphs (no em-dash leak from bodyText)", async () => {
    const sop = createEmptySop("verify", "2026-01-01T00:00:00.000Z");
    sop.procedure.processFlowDescription = "First.\n\nSecond.";
    const blob = await exportSopToDocx(sop);
    const xml = new PizZip(Buffer.from(await blob.arrayBuffer())).file("word/document.xml")!.asText();

    // Both text lines should appear.
    expect(xml).toContain("First.");
    expect(xml).toContain("Second.");

    // Extract just the Procedure section to avoid em-dashes from other empty fields.
    const procStart = xml.indexOf("<w:t xml:space=\"preserve\">Procedure</w:t>");
    const annexStart = xml.indexOf("<w:t xml:space=\"preserve\">Annexes");
    const procSection = xml.substring(procStart, annexStart);

    // The blank line must NOT produce an em-dash ("—") in the procedure region.
    // bodyText("") generates "—", so procedureNarrativeBlocks must NOT call bodyText("")
    // for blank lines — it creates an empty paragraph instead.
    expect(procSection).not.toContain("—");
    expect(procSection).not.toContain("&#8212;");
    expect(procSection).not.toContain("&#x2014;");
  });
});
