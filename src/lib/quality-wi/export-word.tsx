import { wiPrintPlan } from "@/domain/quality-wi/print-plan";
import { wiHeaderHeightTwips } from "./export-layout";
import { wiImageToPng, fetchWiImageBlob } from "./render-image";
import { Packer } from "docx";
import {
  buildWorkInstructionTemplate,
  type WorkInstructionImages,
} from "@/lib/quality/work-instruction-template-docx";
import type { GeneralWorkInstruction } from "@/domain/quality/work-instruction-template";
import type { WiStep } from "@/domain/quality-wi/schema";
export async function exportQualityWiWord(
  model: GeneralWorkInstruction,
  steps: WiStep[],
) {
  const images: WorkInstructionImages = {};
  for (const step of steps)
    if (step.showPhoto !== false && step.image) images[step.image.id] = await wiImageToPng(step.image);
  const logo = await fetchWiImageBlob("/sop/ana-logo.png");
  const headerHeightTwips = wiHeaderHeightTwips(model);
  const plan = wiPrintPlan(model, headerHeightTwips);
  const document = buildWorkInstructionTemplate(
    new Uint8Array(await logo.arrayBuffer()),
    plan.document,
    images,
    {
      filledDocument: true,
      headerHeightTwips,
      singleStepPages: plan.singleStepPages,
    },
  );
  const blob = await Packer.toBlob(document);
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${model.documentNumber.replace(/[^a-zA-Z0-9-]/g, "-")}${model.isDraft ? "-DRAFT" : ""}.docx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
