import { expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { analyzeWiDocx } from "./analyze";
import { result, evidence } from "@/domain/quality-wi/conversion-fixture";
const emptyCorrection = {
  stepEdits: [],
  imageEdits: [],
  replacementSteps: null,
  details: null,
  metadata: null,
  excludedBlocks: null,
  warnings: [],
};
function client(
  audit: { blocking: string[]; warnings: string[] },
  stop = "tool_use",
  afterAudit = audit,
) {
  let audits = 0;
  const stream = vi
    .fn()
    .mockImplementation((body: { tools: { name: string }[] }) => ({
      finalMessage: async () => ({
        stop_reason: stop,
        content: [
          {
            type: "tool_use",
            name: body.tools[0].name,
            input:
              body.tools[0].name === "convert_work_instruction"
                ? { ...result, excludedBlocks: [], detailSourceIds: [] }
                : body.tools[0].name === "correct_work_instruction"
                  ? emptyCorrection
                  : audits++ === 0
                    ? audit
                    : afterAudit,
          },
        ],
      }),
    }));
  return { api: { messages: { stream } } as unknown as Anthropic, stream };
}
it("requires a separate visual audit and retains its warnings", async () => {
  const c = client({
    blocking: [],
    warnings: ["Confirm the destination folder"],
  });
  const out = await analyzeWiDocx(
    { evidence, images: new Map([["img1", Buffer.from("image")]]) },
    new AbortController().signal,
    c.api,
  );
  expect(c.stream).toHaveBeenCalledTimes(2);
  expect(c.stream.mock.calls[0][0].model).toBe("claude-sonnet-5-5");
  expect(c.stream.mock.calls[1][0].model).toBe("claude-opus-5-5");
  for (const [body] of c.stream.mock.calls) {
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.tools[0].strict).toBe(true);
  }
  expect(out.draft.warnings).toContain("Confirm the destination folder");
  expect(
    c.stream.mock.calls[1][0].messages[0].content.filter(
      (x: { type: string }) => x.type === "image",
    ),
  ).toHaveLength(1);
});
it("blocks an incorrect image assignment found by the audit", async () => {
  const c = client({ blocking: ["Wrong equipment image"], warnings: [] });
  await expect(
    analyzeWiDocx(
      { evidence, images: new Map() },
      new AbortController().signal,
      c.api,
    ),
  ).rejects.toThrow("Wrong equipment image");
  expect(c.stream).toHaveBeenCalledTimes(4);
});
it("never accepts a truncated model response", async () => {
  const c = client({ blocking: [], warnings: [] }, "max_tokens");
  await expect(
    analyzeWiDocx(
      { evidence, images: new Map() },
      new AbortController().signal,
      c.api,
    ),
  ).rejects.toThrow("too long");
  expect(c.stream).toHaveBeenCalledTimes(1);
});

it("re-audits after a bounded correction instead of trusting the repair", async () => {
  const c = client(
    { blocking: ["Clarify the image"], warnings: [] },
    "tool_use",
    { blocking: [], warnings: ["Review the source caption"] },
  );
  const out = await analyzeWiDocx(
    { evidence, images: new Map() },
    new AbortController().signal,
    c.api,
  );
  expect(c.stream.mock.calls.map((call) => call[0].tools[0].name)).toEqual([
    "convert_work_instruction",
    "audit_work_instruction",
    "correct_work_instruction",
    "audit_work_instruction",
  ]);
  expect(out.draft.warnings).toContain("Review the source caption");
});
