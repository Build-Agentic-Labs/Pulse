import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import { throwIfError } from "@/lib/supabase-errors";

export const SOP_ANNEX_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const SOP_ANNEX_FILE_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png";

const BUCKET = "sop-annexes";
const COLUMNS =
  "id, workspace_id, sop_id, annex_id, storage_path, original_name, content_type, size_bytes, uploaded_by, created_at, updated_at";

export interface SopAnnexFile {
  id: string;
  workspaceId: string;
  sopId: string;
  annexId: string;
  storagePath: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}


function mapFile(row: Record<string, unknown>): SopAnnexFile {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sopId: String(row.sop_id),
    annexId: String(row.annex_id),
    storagePath: String(row.storage_path),
    originalName: String(row.original_name),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    uploadedBy: String(row.uploaded_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `annex-file-${Date.now().toString(36)}`;
}

function safeSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "form";
}

function fileContentType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csv: "text/csv",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
    }[extension ?? ""] ?? ""
  );
}

export async function listSopAnnexFiles(sopId: string): Promise<SopAnnexFile[]> {
  const supabase = createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase.from("sop_annex_files").select(COLUMNS).eq("sop_id", sopId).order("created_at"),
  );
  return (rows ?? []).map((row: Record<string, unknown>) => mapFile(row));
}

export async function uploadSopAnnexFile(input: {
  workspaceId: string;
  sopId: string;
  annexId: string;
  file: File;
}): Promise<SopAnnexFile> {
  if (input.file.size <= 0) throw new Error("The selected form is empty.");
  if (input.file.size > SOP_ANNEX_FILE_MAX_BYTES) throw new Error("Forms must be 20 MB or smaller.");
  const contentType = fileContentType(input.file);
  if (!contentType) throw new Error("Choose a PDF, Word, Excel, CSV, JPG, or PNG file.");

  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await getUserFromSession(supabase);
  const userId = userData.user?.id;
  if (!userId) throw new Error("Sign in before uploading a form.");

  const existing = await throwIfError(
    supabase
      .from("sop_annex_files")
      .select(COLUMNS)
      .eq("sop_id", input.sopId)
      .eq("annex_id", input.annexId)
      .maybeSingle(),
  );
  const existingFile = existing ? mapFile(existing as Record<string, unknown>) : null;
  const id = existingFile?.id ?? newId();
  const storagePath = [
    "workspaces",
    input.workspaceId,
    "sops",
    input.sopId,
    "annexes",
    input.annexId,
    `${newId()}-${safeSegment(input.file.name)}`,
  ].map(safeSegment).join("/");

  await throwIfError(
    supabase.storage.from(BUCKET).upload(storagePath, input.file, {
      upsert: false,
      contentType,
      cacheControl: "3600",
    }),
  );

  try {
    const saved = await throwIfError(
      supabase
        .from("sop_annex_files")
        .upsert(
          {
            id,
            workspace_id: input.workspaceId,
            sop_id: input.sopId,
            annex_id: input.annexId,
            storage_path: storagePath,
            original_name: input.file.name.slice(0, 260),
            content_type: contentType,
            size_bytes: input.file.size,
            uploaded_by: userId,
          },
          { onConflict: "sop_id,annex_id" },
        )
        .select(COLUMNS)
        .single(),
    );
    if (existingFile && existingFile.storagePath !== storagePath) {
      await supabase.storage.from(BUCKET).remove([existingFile.storagePath]);
    }
    return mapFile(saved as Record<string, unknown>);
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw error;
  }
}

export async function removeSopAnnexFile(file: SopAnnexFile): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { error } = await supabase.storage.from(BUCKET).remove([file.storagePath]);
  if (error) throw new Error(error.message);
  await throwIfError(supabase.from("sop_annex_files").delete().eq("id", file.id));
}

/**
 * Attachment file name for types the browser cannot render inline. PDFs and
 * images stay inline (undefined) so they open as a tab preview; everything
 * else (Office docs, CSV) downloads under its original name instead of the
 * UUID-prefixed storage object key.
 */
export function annexDownloadName(contentType: string, originalName: string): string | undefined {
  if (contentType === "application/pdf" || contentType.startsWith("image/")) return undefined;
  return originalName.trim() || "download";
}

export async function createSopAnnexFileUrl(
  file: SopAnnexFile,
  expiresInSeconds = 600,
  options: { downloadName?: string } = {},
): Promise<string> {
  const supabase = createPlannerSupabaseClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(
      file.storagePath,
      expiresInSeconds,
      options.downloadName ? { download: options.downloadName } : undefined,
    );
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function openSopAnnexFile(file: SopAnnexFile): Promise<void> {
  const preview = window.open("about:blank", "_blank");
  if (preview) preview.opener = null;
  try {
    const signedUrl = await createSopAnnexFileUrl(file, 60, {
      downloadName: annexDownloadName(file.contentType, file.originalName),
    });
    if (preview) preview.location.replace(signedUrl);
    else window.location.assign(signedUrl);
  } catch (error) {
    preview?.close();
    throw error;
  }
}
