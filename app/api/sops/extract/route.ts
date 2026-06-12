import Anthropic from "@anthropic-ai/sdk";
import {
  DEFAULT_EXTRACTION_MODEL,
  SOP_EXTRACTION_TOOL,
  SOP_SYSTEM_PROMPT,
  type ExtractedSop,
} from "@/domain/sop/extraction";
import { prepareSopUpload, type PreparedSopUpload } from "@/lib/sop/parse-document";
import { createApiRateLimiter, requireApiUser } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Document reading + an LLM round-trip can exceed the default serverless window.
export const maxDuration = 60;

// Cap upload size so a huge file can't OOM the function or blow the time budget.
// docx is parsed in-process by mammoth; a PDF is base64-encoded and sent to Claude,
// so this also keeps the request body well under the API's document limit.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const SOP_INSTRUCTION = "Convert this legacy SOP into the standardized schema.";

// Each conversion is a full LLM round-trip (up to 20 MB of PDF); cap per-user throughput.
const checkExtractionRateLimit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 5 });

// Build the Claude user-turn content for the upload. The PDF rides as a document block
// (Claude reads/OCRs it); docx text is sent inline. Either way this sits AFTER the cached
// system + tool prefix, so it doesn't invalidate the prompt cache.
function buildUserContent(upload: PreparedSopUpload): Anthropic.ContentBlockParam[] {
  if (upload.kind === "pdf") {
    return [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: upload.base64 },
      },
      { type: "text", text: SOP_INSTRUCTION },
    ];
  }

  return [
    {
      type: "text",
      text: `${SOP_INSTRUCTION}\n\n<sop_document>\n${upload.text}\n</sop_document>`,
    },
  ];
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) {
    return auth.failure;
  }

  if (!checkExtractionRateLimit(auth.userId)) {
    return Response.json(
      { error: "Too many conversions at once. Wait a minute and try again." },
      { status: 429 },
    );
  }

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

  let upload: PreparedSopUpload;
  try {
    upload = await prepareSopUpload(file);
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
      messages: [{ role: "user", content: buildUserContent(upload) }],
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
