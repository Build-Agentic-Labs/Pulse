import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_EXTRACTION_MODEL,
  SOP_EXTRACTION_TOOL,
  SOP_SYSTEM_PROMPT,
} from "@/domain/sop/extraction";
import { validateExtractedSop } from "@/domain/sop/extraction-validate";
import { prepareSopUpload, type PreparedSopUpload } from "@/lib/sop/parse-document";
import { callerScopedSupabase, createApiRateLimiter, getBearerToken, requireApiUser } from "@/lib/api-auth";
import type { Database } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reading a long document + a long structured generation can take minutes; use the
// full window Vercel functions allow rather than cutting real conversions off at 60s.
export const maxDuration = 300;

// Cap upload size so a huge file can't OOM the function or blow the time budget.
// docx is parsed in-process by mammoth; a PDF is base64-encoded and sent to Claude,
// so this also keeps the request body well under the API's document limit.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const SOP_INSTRUCTION = "Convert this legacy SOP into the standardized schema.";

// claude-sonnet-4-6 supports up to 64K output tokens; 32K comfortably fits very long
// SOPs while leaving headroom. Override with SOP_EXTRACTION_MAX_TOKENS if needed.
const DEFAULT_MAX_OUTPUT_TOKENS = 32_768;

function resolveMaxOutputTokens(): number {
  const parsed = Number.parseInt(process.env.SOP_EXTRACTION_MAX_TOKENS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_OUTPUT_TOKENS;
}

// The Claude API rejects PDFs beyond its ~100-page limit and oversized requests as 4xx
// invalid-request errors. Those are the user's document's fault, not a conversion
// failure — detect them so the route can answer 422 with an actionable message.
function isDocumentTooLargeError(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError)) return false;
  const status = error.status ?? 0;
  if (status < 400 || status >= 500) return false;
  if (status === 413) return true;
  const message = error.message.toLowerCase();
  return (
    (message.includes("page") && /limit|maximum|exceed|too many/.test(message)) ||
    message.includes("too large") ||
    message.includes("request_too_large")
  );
}

// Each conversion is a full LLM round-trip (up to 20 MB of PDF); cap per-user throughput.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 5;

// Cheap per-instance first gate — stops a single instance being hammered without a
// DB round-trip. Not authoritative: it can't see attempts on sibling serverless
// instances, so it's backed by the cross-instance gate below.
const checkExtractionRateLimit = createApiRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  maxRequests: RATE_LIMIT_MAX_REQUESTS,
});

// Cross-instance spend gate: record the attempt and count the caller's attempts in
// the trailing window across ALL instances. This is the only cap on Anthropic spend,
// so the in-memory bucket alone (per-instance) is not enough. Returns true when the
// caller is over the limit, false when allowed, null when the service-role client is
// unavailable (dev/local without SUPABASE_SERVICE_ROLE_KEY) — the caller then falls
// back to the in-memory gate rather than blocking the feature outright.
async function isOverExtractionRateLimit(userId: string): Promise<boolean | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) return null;

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

  const insert = await admin.from("sop_extraction_requests").insert({ user_id: userId });
  if (insert.error) return null;

  // Prune rows older than the window on every insert so the table stays tiny.
  await admin.from("sop_extraction_requests").delete().lt("created_at", windowStart);

  const { count, error } = await admin
    .from("sop_extraction_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", windowStart);
  if (error || count === null) return null;

  return count > RATE_LIMIT_MAX_REQUESTS;
}

const RATE_LIMITED_RESPONSE = () =>
  Response.json(
    { error: "Too many conversions at once. Wait a minute and try again." },
    { status: 429 },
  );

// Build the Claude user-turn content for the upload. The PDF rides as a document block
// (Claude reads/OCRs it); docx HTML is sent inline, preceded by any embedded images
// (usually the process flowchart) as image blocks. Either way this sits AFTER the cached
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
    ...upload.images.map<Anthropic.ContentBlockParam>((image) => ({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.base64 },
    })),
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
    return RATE_LIMITED_RESPONSE();
  }

  if ((await isOverExtractionRateLimit(auth.userId)) === true) {
    return RATE_LIMITED_RESPONSE();
  }

  // Converting a SOP only makes sense for users who can save one. sops writes are gated
  // on org-tools 'edit' at the database (has_org_tool_access, 20260701121000); mirror
  // that gate here so users without it can't spend LLM tokens. All three lookups run as
  // the caller (RLS-scoped) and a failed lookup denies — this fails closed.
  const callerSupabase = callerScopedSupabase(getBearerToken(request));
  const [orgAccess, managerMembership, superAdmin] = await Promise.all([
    callerSupabase.from("org_tool_access").select("level").eq("user_id", auth.userId).maybeSingle(),
    callerSupabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", auth.userId)
      .in("role", ["owner", "admin"])
      .limit(1),
    callerSupabase.rpc("is_super_admin"),
  ]);
  const isManager = (managerMembership.data?.length ?? 0) > 0 || superAdmin.data === true;
  if (!isManager && orgAccess.data?.level !== "edit") {
    return Response.json(
      { error: "You need Org tools edit access to convert SOPs." },
      { status: 403 },
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

    const maxTokens = resolveMaxOutputTokens();

    // Stream purely to sidestep the SDK's non-streaming timeout on long generations —
    // the response is still consumed whole via finalMessage(), same shape as before.
    const message = await client.messages
      .stream({
        model,
        max_tokens: maxTokens,
        // Cache the (large, stable) instructions + tool schema across uploads.
        system: [{ type: "text", text: SOP_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [SOP_EXTRACTION_TOOL as unknown as Anthropic.Tool],
        tool_choice: { type: "tool", name: SOP_EXTRACTION_TOOL.name },
        messages: [{ role: "user", content: buildUserContent(upload) }],
      })
      .finalMessage();

    // Last resort: a truncated response yields partial tool input (invalid JSON /
    // missing fields), which would crash the client downstream — surface it instead.
    if (message.stop_reason === "max_tokens") {
      return Response.json(
        {
          error: `The converted SOP exceeded the ${maxTokens.toLocaleString()}-token output limit. Split the document into smaller SOPs and convert them separately.`,
        },
        { status: 502 },
      );
    }

    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return Response.json({ error: "The model did not return structured SOP data." }, { status: 502 });
    }

    // Never trust the model's tool input shape — coerce/validate at the boundary.
    const sop = validateExtractedSop(toolUse.input);
    if (!sop) {
      return Response.json(
        { error: "The model returned malformed SOP data with no usable content. Try converting again." },
        { status: 502 },
      );
    }

    return Response.json(
      upload.kind === "docx" ? { sop, docxImages: upload.imageMeta } : { sop },
    );
  } catch (error) {
    if (isDocumentTooLargeError(error)) {
      return Response.json(
        { error: "This PDF exceeds the ~100-page limit for conversion. Split it into smaller PDFs and try again." },
        { status: 422 },
      );
    }
    const detail = error instanceof Error ? error.message : "Unknown error during extraction.";
    return Response.json({ error: `Conversion failed: ${detail}` }, { status: 502 });
  }
}
