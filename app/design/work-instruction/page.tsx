import { WorkInstructionLetterTemplate } from "@/components/work-instruction/work-instruction-letter-template";
import type { Metadata } from "next";
import { WorkInstructionDocument } from "@/components/work-instruction/work-instruction-document";
import { sampleWorkInstruction } from "@/domain/work-instruction/sample";
import {
  DEFAULT_WORK_INSTRUCTION_PRINT_LAYOUT,
  WORK_INSTRUCTION_LAYOUTS,
} from "@/domain/work-instruction/schema";

export const metadata: Metadata = {
  title: "Work Instruction Template · Pulse",
  description: "Assembly work instruction on portrait Letter paper",
};

/**
 * Ungated visual reference for the printed work instruction, same idea as
 * `design/nothing`: it renders the real document component against a fixture so
 * the ledger geometry can be eyeballed (and printed) without a project behind
 * it.
 *
 * `?v=2` switches to the 4-per-sheet card grid, `?blank=1` shows the fill-in
 * template.
 */
export default async function WorkInstructionDesignPage({
  searchParams,
}: {
  searchParams: Promise<{ blank?: string; v?: string; format?: string }>;
}) {
  const { blank, v, format } = await searchParams;
  const layout = (v && WORK_INSTRUCTION_LAYOUTS[`v${v}`]) || DEFAULT_WORK_INSTRUCTION_PRINT_LAYOUT;

  if (format === "letter") {
    return <WorkInstructionLetterTemplate example={sampleWorkInstruction()} blankOnly={blank === "1"} />;
  }

  return (
    <div className="wi-print-body h-full overflow-auto bg-canvas p-8">
      <WorkInstructionDocument instruction={sampleWorkInstruction({ blank: blank === "1", layout })} layout={layout} />
    </div>
  );
}
