// Planner media persistence: step-photo upload (storage object, thumbnail, metadata row with attribution),
// metadata-only re-save, server-side copy to another step, caption updates, soft deletes and best-effort
// object removal for photos, exploded views and videos, and the SolidWorks ingest of exploded views and
// build animations through a caller-scoped client. Every scoped write checks the task's project first.
// Moved verbatim from supabase-planner.ts (Phase 4).

import { plannerClient, supabaseUrl } from "./client";
import {
  mapStepExplodedViewRecord,
  mapTaskVideoRecord,
  type StepExplodedViewRow,
  type StepPhotoRow,
  type TaskVideoRow,
} from "./media-rows";
import {
  buildTaskAssetStoragePath,
  createPhotoThumbnailBlob,
  dataUrlToBlob,
  projectScopedStoragePath,
  projectScopedThumbnailStoragePath,
  removeStorageObjects,
  safeStorageSegment,
  signedStorageUrl,
  stableStoragePublicUrl,
  stepPhotoBucket,
  STORAGE_SIGNED_URL_SECONDS,
  taskVideoBucket,
} from "./media-storage";
import { assertTaskInProject, newScopedId, throwIfError } from "./query-helpers";
import { type ExplodedView, normalizeComponents } from "@/domain/step-exploded-views";
import type { StepPhotoAttachment } from "@/domain/step-photos";
import type { TaskVideo } from "@/domain/task-videos";
import type { PlannerProjectContext } from "@/domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function softDeleteStepPhotoAttachmentFromSupabase(photoId: string, taskId?: string, projectId?: string) {
  const supabase = plannerClient();
  if (taskId) {
    await assertTaskInProject(supabase, taskId, projectId);
  }
  await throwIfError(supabase.from("step_photos").update({ deleted_at: new Date().toISOString() }).eq("id", photoId));
}

export async function softDeleteExplodedViewFromSupabase(viewId: string, taskId?: string, projectId?: string) {
  const supabase = plannerClient();
  if (taskId) {
    await assertTaskInProject(supabase, taskId, projectId);
  }
  await throwIfError(
    supabase.from("step_exploded_views").update({ deleted_at: new Date().toISOString() }).eq("id", viewId),
  );
}

// Best-effort removal of the stored image (the row soft-delete is what hides the view; a Storage
// failure is logged inside removeStorageObjects but never surfaced).
export async function removeExplodedViewObject(view: Pick<ExplodedView, "storagePath">) {
  if (!view.storagePath) {
    return;
  }
  await removeStorageObjects(plannerClient(), stepPhotoBucket, [view.storagePath]);
}

export async function updateStepPhotoCaptionInSupabase(photoId: string, caption: string, taskId?: string, projectId?: string) {
  const supabase = plannerClient();
  if (taskId) {
    await assertTaskInProject(supabase, taskId, projectId);
  }
  await throwIfError(
    supabase
      .from("step_photos")
      .update({ caption: caption.trim() ? caption.trim() : null })
      .eq("id", photoId)
      .is("deleted_at", null),
  );
}

// Best-effort current-user lookup for attribution columns (uploaded_by). Reads the locally cached
// session; failures are logged and treated as "unknown user" -- attribution never blocks a save.
async function currentUserIdForAttribution(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn(`Could not resolve the current user for upload attribution: ${error.message}`);
      return null;
    }
    return data.session?.user?.id ?? null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Could not resolve the current user for upload attribution: ${detail}`);
    return null;
  }
}

function stepPhotoRow(
  taskId: string,
  stepId: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
  uploadedBy: string | null = null,
): StepPhotoRow {
  const storagePath = photo.storagePath || projectScopedStoragePath(taskId, stepId, photo, project);

  return {
    id: photo.id,
    task_id: taskId,
    step_id: stepId,
    storage_path: storagePath,
    public_url: stableStoragePublicUrl(storagePath),
    thumbnail_url: photo.thumbnailStoragePath ? stableStoragePublicUrl(photo.thumbnailStoragePath) : (photo.thumbnailUrl ?? null),
    thumbnail_storage_path: photo.thumbnailStoragePath ?? null,
    file_name: photo.name || "Step photo",
    mime_type: photo.contentType ?? null,
    size_bytes: photo.sizeBytes ?? null,
    width: photo.width ?? null,
    height: photo.height ?? null,
    caption: photo.caption?.trim() ? photo.caption.trim() : null,
    captured_at: photo.capturedAt,
    uploaded_by: uploadedBy,
    deleted_at: null,
  };
}

async function saveStepPhotoMetadataToSupabase(
  taskId: string,
  stepId: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, project?.projectId);
  const uploadedBy = await currentUserIdForAttribution(supabase);
  await throwIfError(supabase.from("step_photos").upsert(stepPhotoRow(taskId, stepId, photo, project, uploadedBy)));
}

export async function uploadStepPhotoAttachment(
  taskId: string,
  stepId: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
): Promise<StepPhotoAttachment> {
  if (!photo.dataUrl.startsWith("data:image/")) {
    if (photo.storagePath && /^https?:\/\//.test(photo.dataUrl)) {
      await saveStepPhotoMetadataToSupabase(taskId, stepId, photo, project);
    }
    return photo;
  }

  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, project?.projectId);
  const blob = await dataUrlToBlob(photo.dataUrl);
  const extension = photo.contentType?.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const storagePath = projectScopedStoragePath(taskId, stepId, photo, project, safeStorageSegment(extension));

  await throwIfError(
    supabase.storage.from(stepPhotoBucket).upload(storagePath, blob, {
      cacheControl: "31536000",
      contentType: photo.contentType ?? blob.type ?? "image/jpeg",
      upsert: true,
    }),
  );

  const signedUrl = await signedStorageUrl(supabase, storagePath, { cache: true });
  let thumbnailUrl: string | undefined;
  let thumbnailStoragePath: string | undefined;

  const thumbnailBlob = await createPhotoThumbnailBlob(blob).catch(() => null);
  if (thumbnailBlob) {
    thumbnailStoragePath = projectScopedThumbnailStoragePath(taskId, stepId, photo, project);
    await throwIfError(
      supabase.storage.from(stepPhotoBucket).upload(thumbnailStoragePath, thumbnailBlob, {
        cacheControl: "31536000",
        contentType: thumbnailBlob.type || "image/webp",
        upsert: true,
      }),
    );
    thumbnailUrl = await signedStorageUrl(supabase, thumbnailStoragePath, { cache: true });
  }

  const uploadedPhoto = {
    ...photo,
    dataUrl: signedUrl ?? "",
    storagePath,
    thumbnailUrl,
    thumbnailStoragePath,
    contentType: photo.contentType ?? blob.type,
    sizeBytes: blob.size,
  };

  await saveStepPhotoMetadataToSupabase(taskId, stepId, uploadedPhoto, project);

  // The bucket is private, so the fabricated public URL can never load -- returning it would hand
  // the caller a permanently-broken image. The row is saved (a reload re-signs it), so fail loudly.
  if (!signedUrl) {
    throw new Error("The photo was saved, but a signed URL could not be created for it. Reload to retry.");
  }

  return uploadedPhoto;
}

export async function removeStepPhotoAttachmentObject(photo: StepPhotoAttachment) {
  const paths = [photo.storagePath, photo.thumbnailStoragePath].filter((value): value is string => Boolean(value));
  if (!paths.length) {
    return;
  }

  const supabase = plannerClient();
  await throwIfError(supabase.storage.from(stepPhotoBucket).remove(paths));
}

/**
 * Duplicate a stored photo object onto another step, server-side.
 *
 * `uploadStepPhotoAttachment` deliberately short-circuits for photos that already live in
 * Storage — it only re-saves metadata — which is right for re-saving but wrong for a copy:
 * the duplicate would inherit the source's `storage_path`, and deleting the source TASK
 * hard-deletes every object belonging to its photos, breaking the copy. So a paste gets its
 * own object. Storage `.copy()` does this on the server; no download/upload round trip.
 *
 * `photo` must already carry the NEW id (see `duplicateStepPhotoAttachment`) — destination
 * paths key on it, which is what keeps the copy on a distinct path.
 */
export async function copyStepPhotoAttachmentToStep(
  targetTaskId: string,
  targetStepId: string,
  photo: StepPhotoAttachment,
  sourceStoragePath: string,
  sourceThumbnailStoragePath: string | undefined,
  project?: PlannerProjectContext,
): Promise<StepPhotoAttachment> {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, targetTaskId, project?.projectId);

  const extension = photo.contentType?.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const storagePath = projectScopedStoragePath(
    targetTaskId,
    targetStepId,
    photo,
    project,
    safeStorageSegment(extension),
  );
  // Destination paths key on photo.id. If the caller passed the photo with its ORIGINAL id
  // instead of a duplicated one (see the precondition in the doc comment above), the derived
  // path collapses onto the source path, and the upsert in saveStepPhotoMetadataToSupabase
  // below would silently overwrite the source row -- moving it to the target task/step and
  // orphaning the original Storage object. Fail loudly, before any Storage write, instead of
  // corrupting data silently.
  if (storagePath === sourceStoragePath) {
    throw new Error(
      "copyStepPhotoAttachmentToStep: destination path matches the source path. The photo must be " +
        "duplicated with a fresh id (see duplicateStepPhotoAttachment) before it is copied to another step.",
    );
  }

  // Verified present in the installed client: storage-js exposes
  // copy(fromPath, toPath, options?) — node_modules/@supabase/storage-js/dist/index.d.mts:1149
  await throwIfError(supabase.storage.from(stepPhotoBucket).copy(sourceStoragePath, storagePath));

  let thumbnailStoragePath: string | undefined;
  let thumbnailUrl: string | undefined;
  if (sourceThumbnailStoragePath) {
    thumbnailStoragePath = projectScopedThumbnailStoragePath(targetTaskId, targetStepId, photo, project);
    await throwIfError(
      supabase.storage.from(stepPhotoBucket).copy(sourceThumbnailStoragePath, thumbnailStoragePath),
    );
    thumbnailUrl = await signedStorageUrl(supabase, thumbnailStoragePath, { cache: true });
  }

  const signedUrl = await signedStorageUrl(supabase, storagePath, { cache: true });

  const copiedPhoto: StepPhotoAttachment = {
    ...photo,
    dataUrl: signedUrl ?? "",
    storagePath,
    thumbnailUrl,
    thumbnailStoragePath,
  };

  await saveStepPhotoMetadataToSupabase(targetTaskId, targetStepId, copiedPhoto, project);

  // The bucket is private, so the fabricated public URL can never load -- returning it would hand
  // the caller a permanently-broken image. The row is saved (a reload re-signs it), so fail loudly.
  if (!signedUrl) {
    throw new Error("The photo was copied, but a signed URL could not be created for it. Reload to retry.");
  }

  return copiedPhoto;
}

export type ExplodedViewUploadInput = {
  taskId: string;
  bytes: Blob | ArrayBuffer;
  projectId?: string;
  fileName?: string;
  contentType?: string;
  caption?: string;
  solidworksFilePath?: string;
  explodeConfigName?: string;
  frameNumber?: number;
  components?: string[];
  width?: number;
  height?: number;
  project?: PlannerProjectContext;
  // Authenticated uploader (auth user id) for the uploaded_by attribution column.
  uploadedBy?: string;
};

// Server-side ingest for a SolidWorks exploded view: upload the rendered image, insert the
// step_exploded_views row (the source of truth that the load path hydrates into customFields),
// and return the view with a signed URL. RLS independently gates the write to the task's project.
// Requires a CALLER-SCOPED client (the user's bearer token): the step-photos storage bucket and the
// step_exploded_views table are gated by authenticated, project-scoped RLS. input.project must carry
// the real workspaceId/projectId so the storage path is workspace-scoped (the storage policy requires
// a `workspaces/<ws>/projects/<proj>/…` name).
export async function saveExplodedViewToSupabase(
  input: ExplodedViewUploadInput,
  supabase: SupabaseClient,
): Promise<ExplodedView> {
  await assertTaskInProject(supabase, input.taskId, input.project?.projectId ?? input.projectId);

  const id = newScopedId("view");
  const contentType = input.contentType || (input.bytes instanceof Blob ? input.bytes.type : "") || "image/png";
  const extension = contentType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  // Reuse the step-photos bucket (see migration note) under a task-scoped `exploded/` segment.
  const storagePath = buildTaskAssetStoragePath(
    input.taskId,
    `${id}.${safeStorageSegment(extension)}`,
    input.project,
    "exploded",
  );
  const blob = input.bytes instanceof Blob ? input.bytes : new Blob([input.bytes], { type: contentType });

  await throwIfError(
    supabase.storage.from(stepPhotoBucket).upload(storagePath, blob, {
      cacheControl: "31536000",
      contentType,
      upsert: true,
    }),
  );

  const publicUrl = stableStoragePublicUrl(storagePath);
  const signedUrl = await signedStorageUrl(supabase, storagePath, { cache: true });
  const components = normalizeComponents(input.components);

  const row: StepExplodedViewRow = {
    id,
    task_id: input.taskId,
    step_id: null,
    storage_path: storagePath,
    public_url: publicUrl,
    thumbnail_url: null,
    thumbnail_storage_path: null,
    file_name: input.fileName?.trim() || "Exploded view",
    mime_type: contentType,
    size_bytes: blob.size,
    width: input.width ?? null,
    height: input.height ?? null,
    caption: input.caption?.trim() ? input.caption.trim() : null,
    solidworks_file_path: input.solidworksFilePath?.trim() || null,
    config_name: input.explodeConfigName?.trim() || null,
    frame_number: input.frameNumber ?? null,
    components: components ?? null,
    captured_at: new Date().toISOString(),
    uploaded_by: input.uploadedBy ?? null,
    deleted_at: null,
  };

  await throwIfError(supabase.from("step_exploded_views").insert(row));

  // The bucket is private, so the fabricated public URL can never load -- returning it would hand
  // the caller a permanently-broken image. The row is saved (a reload re-signs it), so fail loudly.
  if (!signedUrl) {
    throw new Error("The exploded view was saved, but a signed URL could not be created for it. Reload to retry.");
  }

  // Derive the returned view from the same row the load path maps, swapping in the signed URL.
  return {
    ...mapStepExplodedViewRecord(row as unknown as Record<string, unknown>),
    dataUrl: signedUrl,
  };
}

export type TaskVideoUploadInput = {
  taskId: string;
  bytes: Blob | ArrayBuffer;
  projectId?: string;
  fileName?: string;
  contentType?: string;
  caption?: string;
  solidworksFilePath?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  project?: PlannerProjectContext;
  // Authenticated uploader (auth user id) for the uploaded_by attribution column.
  uploadedBy?: string;
};

// Server-side ingest for a SolidWorks build animation: upload the video to the task-videos bucket
// (workspace-scoped path) and insert the task_videos row. Requires a CALLER-SCOPED client — the bucket
// and table are gated by authenticated, project-scoped RLS.
export async function saveTaskVideoToSupabase(input: TaskVideoUploadInput, supabase: SupabaseClient): Promise<TaskVideo> {
  await assertTaskInProject(supabase, input.taskId, input.project?.projectId ?? input.projectId);

  const id = newScopedId("video");
  const contentType = input.contentType || (input.bytes instanceof Blob ? input.bytes.type : "") || "video/mp4";
  const extension = contentType.includes("webm") ? "webm" : "mp4";
  const storagePath = buildTaskAssetStoragePath(input.taskId, `${id}.${extension}`, input.project, "videos");
  const blob = input.bytes instanceof Blob ? input.bytes : new Blob([input.bytes], { type: contentType });

  await throwIfError(
    supabase.storage.from(taskVideoBucket).upload(storagePath, blob, {
      cacheControl: "31536000",
      contentType,
      upsert: true,
    }),
  );

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${taskVideoBucket}/${storagePath}`;
  const { data: signed } = await supabase.storage.from(taskVideoBucket).createSignedUrl(storagePath, STORAGE_SIGNED_URL_SECONDS);

  const row: TaskVideoRow = {
    id,
    task_id: input.taskId,
    storage_path: storagePath,
    public_url: publicUrl,
    thumbnail_url: null,
    thumbnail_storage_path: null,
    file_name: input.fileName?.trim() || "Build animation",
    mime_type: contentType,
    size_bytes: blob.size,
    duration_seconds: input.durationSeconds ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    caption: input.caption?.trim() ? input.caption.trim() : null,
    solidworks_file_path: input.solidworksFilePath?.trim() || null,
    captured_at: new Date().toISOString(),
    uploaded_by: input.uploadedBy ?? null,
    deleted_at: null,
  };

  await throwIfError(supabase.from("task_videos").insert(row));

  // Same private-bucket rule as exploded views: the fabricated public URL can never load, so an
  // unsigned video is an explicit error rather than a permanently-broken player.
  if (!signed?.signedUrl) {
    throw new Error("The build animation was saved, but a signed URL could not be created for it. Reload to retry.");
  }

  return {
    ...mapTaskVideoRecord(row as unknown as Record<string, unknown>),
    videoUrl: signed.signedUrl,
  };
}

export async function softDeleteTaskVideoFromSupabase(videoId: string, taskId?: string, projectId?: string) {
  const supabase = plannerClient();
  if (taskId) {
    await assertTaskInProject(supabase, taskId, projectId);
  }
  await throwIfError(supabase.from("task_videos").update({ deleted_at: new Date().toISOString() }).eq("id", videoId));
}

// Best-effort removal of the stored video (the row soft-delete is what hides it; a Storage failure
// is logged inside removeStorageObjects but never surfaced).
export async function removeTaskVideoObject(video: Pick<TaskVideo, "storagePath">) {
  if (!video.storagePath) {
    return;
  }
  await removeStorageObjects(plannerClient(), taskVideoBucket, [video.storagePath]);
}
