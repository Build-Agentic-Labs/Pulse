import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type {
  ConversionReview,
  ConversionJob,
  PreparedWiConversion,
} from "@/domain/quality-wi/conversion";
import { qualityWiClient } from "../client";
export async function readWiConversion(
  id: string,
  client: SupabaseClient<Database>,
): Promise<ConversionReview> {
  const db = qualityWiClient(client);
  const { data, error } = await db
    .from("quality_wi_conversions")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data)
    throw new Error("This conversion is unavailable in your current account.");
  const status = data.status as ConversionReview["status"];
  const review: ConversionReview = {
    id: data.id,
    status,
    departmentId: data.department_id,
    fileName: data.file_name,
    error: data.error ?? undefined,
  };
  if (
    new Date(data.expires_at).getTime() <= Date.now() &&
    status !== "imported"
  )
    return {
      ...review,
      status: "failed",
      error: "This conversion expired. Upload the source again.",
    };
  if (
    status === "processing" &&
    Date.now() - new Date(data.created_at).getTime() > 300_000
  )
    return {
      ...review,
      status: "failed",
      error: "The conversion timed out. Upload the source again.",
    };
  if ((status === "ready" || status === "imported") && data.payload) {
    const payload = data.payload as unknown as PreparedWiConversion;
    if (status === "ready" && payload.uploads.length) {
      const signed = await db.storage
        .from("quality-wi-images")
        .createSignedUrls(
          payload.uploads.map((u) => u.storagePath),
          900,
        );
      if (signed.error)
        throw new Error(
          "Could not load the conversion images. Try reopening the review.",
        );
      if (signed.data.some((item) => !item.signedUrl))
        throw new Error(
          "A conversion image is unavailable. Try reopening the review.",
        );
      const urls = new Map(signed.data.map((x) => [x.path, x.signedUrl]));
      for (const upload of payload.uploads)
        upload.url = urls.get(upload.storagePath) ?? undefined;
      for (const step of payload.steps)
        if (step.image)
          step.image.url = urls.get(step.image.storagePath) ?? undefined;
    }
    review.payload = payload;
  }
  return review;
}

/** Only summary fields; never download analysis payloads or sign images while polling. */
export async function listWiConversions(workspaceId: string, client: SupabaseClient<Database>): Promise<ConversionJob[]> {
  const { data, error } = await qualityWiClient(client)
    .from("quality_wi_conversions")
    .select("id,department_id,file_name,status,error,created_at")
    .eq("workspace_id", workspaceId)
    .neq("status", "imported")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Could not load your conversions. Please retry.");
  return (data ?? []).map(row => {
    const timedOut = row.status === "processing" && Date.now() - Date.parse(row.created_at) > 300000;
    return { id: row.id, departmentId: row.department_id, fileName: row.file_name,
      status: timedOut ? "failed" : row.status as ConversionJob["status"],
      error: timedOut ? "The conversion timed out. Upload the source again." : row.error ?? undefined,
      createdAt: row.created_at };
  });
}
