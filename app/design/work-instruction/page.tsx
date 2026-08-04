import type { Metadata } from "next";
import { WorkInstructionDocument } from "@/components/work-instruction/work-instruction-document";
import { sampleWorkInstruction } from "@/domain/work-instruction/sample";

export const metadata: Metadata = {
  title: "Work Instruction Template · Pulse",
  description: "ISO-conformant assembly work instruction on 11x17 landscape ledger",
};

/**
 * Ungated visual reference for the printed work instruction, same idea as
 * `design/nothing`: it renders the real document component against a fixture so
 * the ledger geometry can be eyeballed (and printed) without a project behind
 * it. Add `?blank=1` to see the fill-in template.
 */
export default async function WorkInstructionDesignPage({
  searchParams,
}: {
  searchParams: Promise<{ blank?: string }>;
}) {
  const { blank } = await searchParams;

  return (
    <div className="h-full overflow-auto bg-canvas p-8">
      <WorkInstructionDocument instruction={sampleWorkInstruction({ blank: blank === "1" })} />
    </div>
  );
}
