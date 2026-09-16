import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildConversionUploadPath,
  conversionContentType,
  SOP_CONVERSION_MAX_BYTES,
  SOP_CONVERSION_UPLOAD_BUCKET,
} from "@/domain/sop/conversion-upload";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";
import { throwIfError } from "@/lib/supabase-errors";

function newUploadId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `upload-${Date.now().toString(36)}`;
}

/**
 * Park a legacy document in the private conversion bucket and return its object name for the
 * extraction route. Storage RLS refuses paths outside the caller's own uid prefix and
 * workspaces where they lack org-tool edit access.
 */
export async function uploadConversionSource(
  input: { userId: string; workspaceId: string; file: File },
  client?: SupabaseClient<Database>,
): Promise<string> {
  const supabase = client ?? createPlannerSupabaseClient();
  if (input.file.size <= 0) throw new Error("The selected document is empty.");
  if (input.file.size > SOP_CONVERSION_MAX_BYTES) {
    throw new Error(
      `File is too large. The maximum size is ${SOP_CONVERSION_MAX_BYTES / (1024 * 1024)} MB.`,
    );
  }
  const contentType = conversionContentType(input.file.name);
  if (!contentType) throw new Error("Unsupported file type. Upload a .docx or .pdf SOP.");

  const storagePath = buildConversionUploadPath({
    userId: input.userId,
    workspaceId: input.workspaceId,
    uploadId: newUploadId(),
    fileName: input.file.name,
  });
  await throwIfError(
    supabase.storage.from(SOP_CONVERSION_UPLOAD_BUCKET).upload(storagePath, input.file, {
      upsert: false,
      contentType,
      cacheControl: "0",
    }),
  );
  return storagePath;
}

/**
 * Best-effort cleanup of a conversion source. The route deletes the object as soon as it has
 * the bytes; the browser calls this only when the request never reached the route.
 */
export async function removeConversionSource(
  storagePath: string,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const supabase = client ?? createPlannerSupabaseClient();
  try {
    await supabase.storage.from(SOP_CONVERSION_UPLOAD_BUCKET).remove([storagePath]);
  } catch {
    // Leftovers are harmless: the bucket is private and per-user.
  }
}
