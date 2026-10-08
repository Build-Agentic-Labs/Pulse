import { requireApiUser, createApiRateLimiter } from "@/lib/api-auth";
import { qualityWiClient } from "@/lib/quality-wi/client";
import {
  parseConversionUploadPath,
  SOP_CONVERSION_UPLOAD_BUCKET,
} from "@/domain/sop/conversion-upload";
import { parseWiDocx } from "@/lib/quality-wi/conversion/parse-docx";
import { analyzeWiDocx } from "@/lib/quality-wi/conversion/analyze";
import { buildWiConversion } from "@/domain/quality-wi/conversion";
import { readWiConversion, listWiConversions } from "@/lib/quality-wi/conversion/store";
import type { Json } from "@/lib/database.types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 5 });
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) return auth.failure;
  const params = new URL(request.url).searchParams;
  const workspace = params.get("workspaceId");
  if (workspace && !params.has("id")) {
    if (workspace.length > 200) return json({ error: "Choose an organization." }, 400);
    try { return json(await listWiConversions(workspace, auth.supabase)); }
    catch { return json({ error: "Could not load your conversions. Please retry." }, 503); }
  }
  const id = params.get("id") ?? "";
  if (!uuid.test(id)) return json({ error: "Choose a conversion." }, 400);
  try {
    return json(await readWiConversion(id, auth.supabase));
  } catch {
    return json(
      { error: "This conversion is unavailable in your current account." },
      404,
    );
  }
}
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) return auth.failure;
  if (!limit(auth.userId))
    return json(
      { error: "Too many conversions. Wait a minute and retry." },
      429,
    );
  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || Array.isArray(body) || typeof body !== "object") throw Error();
  } catch {
    return json({ error: "Invalid conversion request." }, 400);
  }
  const { id, workspaceId, departmentId, storagePath, fileName } = body;
  if (
    typeof id !== "string" ||
    !uuid.test(id) ||
    typeof workspaceId !== "string" ||
    typeof departmentId !== "string" ||
    typeof storagePath !== "string" ||
    typeof fileName !== "string" ||
    fileName.length > 255 ||
    !fileName.toLowerCase().endsWith(".docx")
  )
    return json({ error: "Choose a DOCX and a department." }, 400);
  const path = parseConversionUploadPath(storagePath);
  if (
    !path ||
    path.userId !== auth.userId ||
    path.workspaceId !== workspaceId ||
    !path.fileName.toLowerCase().endsWith(".docx")
  )
    return json(
      { error: "This uploaded file does not belong to your conversion." },
      400,
    );
  if (!process.env.ANTHROPIC_API_KEY)
    return json(
      { error: "Document conversion is not configured on this server." },
      503,
    );
  const db = qualityWiClient(auth.supabase);
  const claim = await db.rpc("begin_quality_wi_conversion", {
    p_id: id,
    p_workspace: workspaceId,
    p_department: departmentId,
    p_path: storagePath,
    p_name: fileName,
  });
  if (claim.error)
    return json(
      { error: claim.error.message },
      claim.error.code === "42501"
        ? 403
        : claim.error.code === "P0001"
          ? 429
          : 400,
    );
  if (!claim.data) {
    try {
      return json(await readWiConversion(id, auth.supabase));
    } catch {
      return json(
        { error: "Could not reload the conversion. Try again." },
        503,
      );
    }
  }
  const bucket = db.storage.from(SOP_CONVERSION_UPLOAD_BUCKET);
  // Keep this bounded below the function's 300-second ceiling; terminal state is persisted.
  const signal = AbortSignal.timeout(270_000);
  try {
    const download = await bucket.download(storagePath);
    if (download.error || !download.data)
      throw new Error("The source could not be read. Upload the DOCX again.");
    if (download.data.size > 20 * 1024 * 1024)
      throw new Error("Choose a DOCX no larger than 20 MB.");
    const parsed = await parseWiDocx(
      Buffer.from(await download.data.arrayBuffer()),
    );
    const { draft, model } = await analyzeWiDocx(parsed, signal);
    const payload = buildWiConversion(
      draft,
      parsed.evidence,
      { id, workspaceId, fileName, model, now: new Date().toISOString() },
      () => crypto.randomUUID(),
    );
    const prepare = await db.rpc("prepare_quality_wi_conversion", {
      p_id: id,
      p_payload: payload as unknown as Json,
    });
    if (prepare.error)
      throw new Error("Could not reserve the converted draft. Please retry.");
    // Small bounded batches avoid saturating Storage when a source has many pictures.
    for (let i = 0; i < payload.uploads.length; i += 4) {
      signal.throwIfAborted();
      await Promise.all(
        payload.uploads.slice(i, i + 4).map(async (image) => {
          const bytes = parsed.images.get(image.sourceImageId);
          if (!bytes) throw new Error("A converted image is unavailable.");
          const saved = await db.storage
            .from("quality-wi-images")
            .upload(image.storagePath, bytes, {
              contentType: "image/jpeg",
              upsert: false,
            });
          if (saved.error)
            throw new Error(
              "A source image could not be saved. No work instruction was created; please retry.",
            );
        }),
      );
    }
    const finish = await db.rpc("finish_quality_wi_conversion", { p_id: id });
    if (finish.error)
      throw new Error("Could not confirm the converted images. Please retry.");
    return json(await readWiConversion(id, auth.supabase));
  } catch (error) {
    const message = signal.aborted
      ? "The conversion timed out. Try a smaller document."
      : error instanceof Error && !("status" in error)
        ? error.message
        : "The document analysis service could not finish. Please retry.";
    await db
      .rpc("finish_quality_wi_conversion", { p_id: id, p_error: message })
      .then(
        () => undefined,
        () => undefined,
      );
    return json({ id, status: "failed", error: message }, 422);
  } finally {
    await bucket.remove([storagePath]).catch(() => undefined);
  }
}
