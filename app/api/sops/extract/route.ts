import Anthropic from "@anthropic-ai/sdk";
import {
  DEFAULT_EXTRACTION_MODEL,
  SOP_EXTRACTION_TOOL,
  SOP_SYSTEM_PROMPT,
  type ExtractedSop,
} from "@/domain/sop/extraction";
import { extractUploadText } from "@/lib/sop/parse-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Document parsing + an LLM round-trip can exceed the default serverless window.
export const maxDuration = 60;

// Cap upload size so a huge file can't OOM the function or blow the time budget
// during pdf.js / mammoth parsing.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local to enable conversion." },
      { status: 500 },
    );
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return Response.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  if (!file) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: `File is too large. The maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` },
      { status: 413 },
    );
  }

  let text: string;
  try {
    ({ text } = await extractUploadText(file));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to read the uploaded file." },
      { status: 422 },
    );
  }

  try {
    const client = new Anthropic({ apiKey });
    const model = process.env.SOP_EXTRACTION_MODEL || DEFAULT_EXTRACTION_MODEL;

    const message = await client.messages.create({
      model,
      max_tokens: 8192,
      // Cache the (large, stable) instructions + tool schema across uploads.
      system: [{ type: "text", text: SOP_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [SOP_EXTRACTION_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: SOP_EXTRACTION_TOOL.name },
      messages: [
        {
          role: "user",
          content: `Convert this legacy SOP into the standardized schema:\n\n<sop_document>\n${text}\n</sop_document>`,
        },
      ],
    });

    // A truncated response yields partial tool input (invalid JSON / missing
    // fields), which would crash the client downstream — surface it instead.
    if (message.stop_reason === "max_tokens") {
      return Response.json(
        { error: "This SOP is too long to convert in one pass. Split it into smaller documents and try again." },
        { status: 502 },
      );
    }

    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return Response.json({ error: "The model did not return structured SOP data." }, { status: 502 });
    }

    return Response.json({ sop: toolUse.input as ExtractedSop });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error during extraction.";
    return Response.json({ error: `Conversion failed: ${detail}` }, { status: 502 });
  }
}
