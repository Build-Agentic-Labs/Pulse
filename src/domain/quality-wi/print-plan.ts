import type { GeneralWorkInstruction } from "@/domain/quality/work-instruction-template";
import { splitInstruction } from "@/domain/work-instruction/split-instruction";
import { estimateLines } from "@/domain/work-instruction/estimate-lines";
/** Use the product text splitter only for oversized print content; preserve authored steps. */
export function wiPrintPlan(
  document: GeneralWorkInstruction,
  headerTwips: number,
) {
  const singleStepPages =
    headerTwips > 1500 ||
    document.steps.some(
      (step) =>
        estimateLines(step.instruction, 27) > 7 || step.title.length > 70,
    );
  if (!singleStepPages) return { document, singleStepPages: false };
  const bodyPixels = (11 - 0.4 - 0.85) * 96 - headerTwips / 15 - 4;
  const summaryLines =
    estimateLines(document.purpose, 100) +
    estimateLines(document.responsibilities, 100);
  const summaryPixels = Math.max(1.2 * 96, summaryLines * 16 + 36);
  if (summaryPixels > bodyPixels - 120)
    throw new Error(
      "The purpose or responsibilities are too long for this layout. Keep the summary brief and put detailed actions in the steps.",
    );
  const steps = document.steps.flatMap((step, index) => {
    const titlePixels = Math.max(
      30,
      Math.ceil((step.title.length + 12) / 30) * 18,
    );
    const firstLines = Math.floor(
      (bodyPixels - (index === 0 ? summaryPixels : 0) - titlePixels - 96) / 22,
    );
    const restLines = Math.floor((bodyPixels - titlePixels - 96) / 22);
    if (firstLines < 1 || restLines < 1)
      throw new Error("Shorten the step title before exporting this layout.");
    const chunks = splitInstruction(
      step.instruction,
      { lines: firstLines, charsPerLine: 27 },
      { lines: restLines, charsPerLine: 27 },
    );
    return chunks.map((instruction, part) => ({
      ...step,
      instruction,
      sequence: index + 1,
      continued: part > 0,
    }));
  });
  return { document: { ...document, steps }, singleStepPages: true };
}
