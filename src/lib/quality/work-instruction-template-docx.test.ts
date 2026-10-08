import { expect, it } from "vitest";
import { Packer } from "docx";
import PizZip from "pizzip";
import { buildWorkInstructionTemplate } from "./work-instruction-template-docx";
import { blankGeneralWorkInstruction } from "@/domain/quality/work-instruction-template";

it("exports document owner and page fields without repeating revision in the Word footer", async () => {
 const buffer = await Packer.toBuffer(buildWorkInstructionTemplate(null, {
   ...blankGeneralWorkInstruction(), authorName: "Renée Smith & Lee", revision: "B",
 }));
 const zip = new PizZip(buffer);
 const footer = zip.file(/word\/footer\d+\.xml$/)[0].asText();
 expect(footer).toContain("Document Owner: Renée Smith &amp; Lee");
 expect(footer).not.toContain("Rev.");
 expect(footer).not.toContain("Author:");
 const header = zip.file(/word\/header\d+\.xml$/)[0].asText();
 expect(header).toContain("Release date");
 expect(header).not.toContain("Description");
 expect(footer).toContain("NUMPAGES");
 expect(footer).toContain("ANA INC. CONFIDENTIAL");
 expect(footer).not.toContain("Document no.");
 expect(footer).not.toContain("WI-DEPT-###");
 const body = zip.file("word/document.xml")!.asText();
 expect(body).toContain("Revision history");
 expect(body).toContain("Document Owner");
 expect(body).not.toContain(">Author<");
});

it("exports text-only steps across both columns without the photo prompt", async () => {
 const model = { ...blankGeneralWorkInstruction(), steps: [{ title: "Complete final inspection", instruction: "Complete the inspection before photographing.", showPhoto: false }] };
 const zip = new PizZip(await Packer.toBuffer(buildWorkInstructionTemplate(null, model, {}, { filledDocument: true })));
 const body = zip.file("word/document.xml")!.asText();
 expect(body).toContain('w:gridSpan w:val="2"');
 expect(body).toContain("Complete final inspection");
 expect(body).not.toContain("Image / reference view");
});
