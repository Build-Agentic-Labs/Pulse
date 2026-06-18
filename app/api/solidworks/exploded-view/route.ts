import { callerScopedSupabase, createApiRateLimiter, getBearerToken, requireApiUser } from "@/lib/api-auth";
import { saveExplodedViewToSupabase } from "@/domain/supabase-planner";
import { normalizeComponents } from "@/domain/step-exploded-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// An image upload + Storage write + DB insert can exceed the default serverless window.
export const maxDuration = 60;

// Exploded-view renders reuse the step-photos bucket, which caps objects at 10 MB; reject larger
// uploads here with a clear message rather than letting Storage 413 with a vague error.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// The plugin sends one render per request; cap per-account throughput so a misbehaving client
// can't hammer Storage. A step-by-step explode is a handful of frames, so this is generous.
const checkIngestRateLimit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 60 });

type ExplodedViewMeta = {
  projectId?: string;
  taskId?: string;
  caption?: string;
  solidworksFilePath?: string;
  explodeConfigName?: string;
  frameNumber?: number;
  components?: string[];
  fileName?: string;
};

function parseMeta(raw: unknown): ExplodedViewMeta | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as ExplodedViewMeta) : null;
  } catch {
    return null;
  }
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
  let meta: ExplodedViewMeta | null = null;
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
    return Response.json({ error: "No image uploaded." }, { status: 400 });
  }

  if (!meta?.taskId || !meta.projectId) {
    return Response.json({ error: "meta.taskId and meta.projectId are required." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: `Image is too large. The maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` },
      { status: 413 },
    );
  }

  const contentType = file.type || "image/png";
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    return Response.json(
      { error: `Unsupported image type '${contentType}'. Use PNG, JPEG, or WebP.` },
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
    const explodedView = await saveExplodedViewToSupabase(
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
        fileName: meta.fileName ?? file.name,
        caption: meta.caption,
        solidworksFilePath: meta.solidworksFilePath,
        explodeConfigName: meta.explodeConfigName,
        frameNumber: typeof meta.frameNumber === "number" ? meta.frameNumber : undefined,
        components: normalizeComponents(meta.components),
      },
      supabase,
    );

    return Response.json({ explodedView });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error during upload.";
    // A project-membership mismatch is a client problem (wrong task/project); surface as 403.
    const status = /does not belong to/i.test(detail) ? 403 : 502;
    return Response.json({ error: `Exploded-view upload failed: ${detail}` }, { status });
  }
}
