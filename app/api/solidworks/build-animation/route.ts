import { callerScopedSupabase, createApiRateLimiter, getBearerToken, requireApiUser } from "@/lib/api-auth";
import { saveTaskVideoToSupabase } from "@/domain/supabase-planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A video upload + Storage write + DB insert can exceed the default serverless window, and build
// animations are far larger than exploded-view renders.
export const maxDuration = 300;

// Build animations are capped at 200 MB; reject larger uploads here with a clear message rather
// than letting Storage 413 with a vague error.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set(["video/mp4", "video/webm"]);

// The plugin sends one animation per request; cap per-account throughput so a misbehaving client
// can't hammer Storage. Videos are orders of magnitude heavier than exploded-view frames, so this
// is much tighter than the exploded-view limit.
const checkIngestRateLimit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 12 });

// Free-text metadata is stored verbatim, so cap it at the ingest boundary rather than letting a
// misbehaving client write unbounded strings into the row (truncate, matching the route's
// coerce-don't-reject handling of optional metadata).
const MAX_META_TEXT_CHARS = 500;
// A build animation runs minutes at most; anything beyond a day is bogus.
const MAX_DURATION_SECONDS = 86_400;

type BuildAnimationMeta = {
  projectId?: string;
  taskId?: string;
  caption?: string;
  solidworksFilePath?: string;
  durationSeconds?: number;
  fileName?: string;
};

function parseMeta(raw: unknown): BuildAnimationMeta | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as BuildAnimationMeta) : null;
  } catch {
    return null;
  }
}

function boundedMetaText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.slice(0, MAX_META_TEXT_CHARS) : undefined;
}

function boundedDurationSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, MAX_DURATION_SECONDS)
    : undefined;
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) {
    return auth.failure;
  }

  if (!checkIngestRateLimit(auth.userId)) {
    return Response.json(
      { error: "Too many uploads at once. Wait a minute and try again." },
      { status: 429 },
    );
  }

  let file: File | null = null;
  let meta: BuildAnimationMeta | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
    meta = parseMeta(form.get("meta"));
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data with 'file' and 'meta' fields." },
      { status: 400 },
    );
  }

  if (!file) {
    return Response.json({ error: "No video uploaded." }, { status: 400 });
  }

  if (!meta?.taskId || !meta.projectId) {
    return Response.json({ error: "meta.taskId and meta.projectId are required." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: `Video is too large. The maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` },
      { status: 413 },
    );
  }

  const contentType = file.type || "video/mp4";
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    return Response.json(
      { error: `Unsupported video type '${contentType}'. Use MP4 or WebM.` },
      { status: 415 },
    );
  }

  // Act as the caller so the authenticated, project-scoped Storage + table RLS is satisfied (the anon
  // server client is denied). Resolve the project's workspace via an RLS-gated read — a null result
  // means the caller can't access the project, so reject before touching Storage.
  const supabase = callerScopedSupabase(getBearerToken(request));
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, workspace_id")
    .eq("id", meta.projectId)
    .maybeSingle();
  if (projectError) {
    return Response.json({ error: projectError.message }, { status: 502 });
  }
  if (!project) {
    return Response.json({ error: "No access to this project." }, { status: 403 });
  }

  try {
    const video = await saveTaskVideoToSupabase(
      {
        taskId: meta.taskId,
        projectId: meta.projectId,
        project: {
          projectId: String(project.id),
          projectName: String(project.name ?? ""),
          workspaceId: String(project.workspace_id),
          // Only projectId + workspaceId are used (to build the workspace-scoped storage path); the
          // name fields aren't needed on the ingest path.
          workspaceName: "",
        },
        bytes: await file.arrayBuffer(),
        contentType,
        fileName: boundedMetaText(meta.fileName) ?? boundedMetaText(file.name),
        caption: boundedMetaText(meta.caption),
        solidworksFilePath: boundedMetaText(meta.solidworksFilePath),
        durationSeconds: boundedDurationSeconds(meta.durationSeconds),
        uploadedBy: auth.userId,
      },
      supabase,
    );

    return Response.json({ video });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error during upload.";
    // A project-membership mismatch is a client problem (wrong task/project); surface as 403.
    const status = /does not belong to/i.test(detail) ? 403 : 502;
    return Response.json({ error: `Build-animation upload failed: ${detail}` }, { status });
  }
}
