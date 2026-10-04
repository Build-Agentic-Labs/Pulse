// Planner media rows: the database row shapes for step photos, exploded views, task videos, step tools and
// tool-library entries; their mappers to domain media; and the normalization that indexes media and tool
// rows by task/step and merges them into a task's step-scoped custom fields. No network access. Moved
// verbatim from supabase-planner.ts (Phase 4).

import { maybeNum, maybeText } from "./row-mappers";
import { EXPLODED_VIEWS_FIELD, type ExplodedView, normalizeComponents } from "@/domain/step-exploded-views";
import {
  getTaskStepPhotoAnnotationMap,
  STEP_PHOTO_ATTACHMENTS_FIELD,
  type StepPhotoAttachment,
} from "@/domain/step-photos";
import { STEP_TOOL_LISTS_FIELD } from "@/domain/step-tools";
import type { TaskPrivateMedia } from "@/domain/task-private-media";
import { TASK_VIDEOS_FIELD, type TaskVideo } from "@/domain/task-videos";

export type StepPhotoRow = {
  id: string;
  task_id: string;
  step_id: string;
  storage_path: string;
  public_url: string;
  thumbnail_url?: string | null;
  thumbnail_storage_path?: string | null;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
  // NOT NULL with defaults in the schema: may be omitted, but never written as null.
  captured_at?: string;
  uploaded_by?: string | null;
  deleted_at?: string | null;
  created_at?: string;
};

export type StepExplodedViewRow = {
  id: string;
  task_id: string;
  step_id?: string | null;
  storage_path: string;
  public_url: string;
  thumbnail_url?: string | null;
  thumbnail_storage_path?: string | null;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
  solidworks_file_path?: string | null;
  config_name?: string | null;
  frame_number?: number | null;
  components?: string[] | null;
  captured_at?: string | null;
  uploaded_by?: string | null;
  deleted_at?: string | null;
  created_at?: string | null;
};

export type StepToolRow = {
  id: string;
  task_id: string;
  step_id: string;
  tool_name: string;
  sequence: number;
};

export type ToolLibraryRow = {
  id: string;
  project_id?: string | null;
  tool_name: string;
  image_url?: string | null;
  storage_path?: string | null;
  category?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function mapStepPhotoRecord(row: Record<string, unknown>): StepPhotoAttachment {
  return {
    id: String(row.id),
    name: String(row.file_name ?? "Step photo"),
    dataUrl: String(row.public_url ?? ""),
    capturedAt: String(row.captured_at ?? row.created_at ?? new Date().toISOString()),
    contentType: maybeText(row.mime_type),
    sizeBytes: maybeNum(row.size_bytes),
    width: maybeNum(row.width),
    height: maybeNum(row.height),
    storagePath: maybeText(row.storage_path),
    thumbnailUrl: maybeText(row.thumbnail_url),
    thumbnailStoragePath: maybeText(row.thumbnail_storage_path),
    caption: maybeText(row.caption),
  };
}

export type TaskVideoRow = {
  id: string;
  task_id: string;
  storage_path: string;
  public_url: string;
  thumbnail_url?: string | null;
  thumbnail_storage_path?: string | null;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
  solidworks_file_path?: string | null;
  captured_at?: string | null;
  uploaded_by?: string | null;
  deleted_at?: string | null;
  created_at?: string | null;
};

export function mapTaskVideoRecord(row: Record<string, unknown>): TaskVideo {
  return {
    id: String(row.id),
    name: String(row.file_name ?? "Build animation"),
    videoUrl: String(row.public_url ?? ""),
    capturedAt: String(row.captured_at ?? row.created_at ?? new Date().toISOString()),
    contentType: maybeText(row.mime_type),
    sizeBytes: maybeNum(row.size_bytes),
    durationSeconds: maybeNum(row.duration_seconds),
    width: maybeNum(row.width),
    height: maybeNum(row.height),
    storagePath: maybeText(row.storage_path),
    thumbnailUrl: maybeText(row.thumbnail_url),
    thumbnailStoragePath: maybeText(row.thumbnail_storage_path),
    caption: maybeText(row.caption),
    solidworksFilePath: maybeText(row.solidworks_file_path),
  };
}

export function mapStepExplodedViewRecord(row: Record<string, unknown>): ExplodedView {
  return {
    id: String(row.id),
    name: String(row.file_name ?? "Exploded view"),
    dataUrl: String(row.public_url ?? ""),
    capturedAt: String(row.captured_at ?? row.created_at ?? new Date().toISOString()),
    contentType: maybeText(row.mime_type),
    sizeBytes: maybeNum(row.size_bytes),
    width: maybeNum(row.width),
    height: maybeNum(row.height),
    storagePath: maybeText(row.storage_path),
    thumbnailUrl: maybeText(row.thumbnail_url),
    thumbnailStoragePath: maybeText(row.thumbnail_storage_path),
    caption: maybeText(row.caption),
    solidworksFilePath: maybeText(row.solidworks_file_path),
    explodeConfigName: maybeText(row.config_name),
    frameNumber: maybeNum(row.frame_number),
    components: normalizeComponents(row.components),
  };
}

// A media row prepared for rendering: its URL columns are replaced by signed URLs, or left absent
// when signing failed. The buckets are PRIVATE, so the stored public_url/thumbnail_url values (kept
// only because the columns are NOT NULL) can never load -- falling back to them would render a
// permanently-broken image, while an absent URL lets components show a placeholder and retry.
export type SignedMediaRow<T> = Omit<T, "public_url" | "thumbnail_url"> & {
  public_url?: string;
  thumbnail_url?: string | null;
};

export function withNormalizedStepAssets<T extends TaskPrivateMedia>(
  task: T,
  photosByTaskId: Map<string, Map<string, StepPhotoAttachment[]>>,
  toolsByTaskId: Map<string, Map<string, string[]>>,
  explodedViewsByTaskId: Map<string, ExplodedView[]> = new Map(),
  videosByTaskId: Map<string, TaskVideo[]> = new Map(),
): T {
  const photoMap = photosByTaskId.get(task.id);
  const toolMap = toolsByTaskId.get(task.id);
  const explodedViews = explodedViewsByTaskId.get(task.id);
  const videos = videosByTaskId.get(task.id);

  if (!photoMap && !toolMap && !explodedViews && !videos) {
    return task;
  }

  const customFields = { ...task.customFields };

  if (photoMap) {
    const annotationMap = getTaskStepPhotoAnnotationMap(task);
    customFields[STEP_PHOTO_ATTACHMENTS_FIELD] = Object.fromEntries(
      [...photoMap.entries()].map(([stepId, photos]) => [
        stepId,
        photos.map((photo) => {
          const annotations = annotationMap[photo.id];
          return annotations ? { ...photo, annotations } : photo;
        }),
      ]),
    );
  }

  if (toolMap) {
    customFields[STEP_TOOL_LISTS_FIELD] = Object.fromEntries(toolMap);
  }

  if (explodedViews) {
    customFields[EXPLODED_VIEWS_FIELD] = explodedViews;
  }

  if (videos) {
    customFields[TASK_VIDEOS_FIELD] = videos;
  }

  return {
    ...task,
    customFields,
  };
}

export function indexStepPhotos(rows: SignedMediaRow<StepPhotoRow>[] = []) {
  const photosByTaskId = new Map<string, Map<string, StepPhotoAttachment[]>>();

  rows
    .filter((row) => !row.deleted_at)
    .forEach((row) => {
      const taskId = String(row.task_id);
      const stepId = String(row.step_id);
      const stepMap = photosByTaskId.get(taskId) ?? new Map<string, StepPhotoAttachment[]>();
      stepMap.set(stepId, [...(stepMap.get(stepId) ?? []), mapStepPhotoRecord(row as unknown as Record<string, unknown>)]);
      photosByTaskId.set(taskId, stepMap);
    });

  return photosByTaskId;
}

// Task-level: collect every exploded view for a task into one flat list (step_id is unused).
export function indexExplodedViews(rows: SignedMediaRow<StepExplodedViewRow>[] = []) {
  const explodedViewsByTaskId = new Map<string, ExplodedView[]>();

  rows
    .filter((row) => !row.deleted_at)
    .forEach((row) => {
      const taskId = String(row.task_id);
      explodedViewsByTaskId.set(taskId, [
        ...(explodedViewsByTaskId.get(taskId) ?? []),
        mapStepExplodedViewRecord(row as unknown as Record<string, unknown>),
      ]);
    });

  return explodedViewsByTaskId;
}

export function indexTaskVideos(rows: SignedMediaRow<TaskVideoRow>[] = []) {
  const videosByTaskId = new Map<string, TaskVideo[]>();

  rows
    .filter((row) => !row.deleted_at)
    .forEach((row) => {
      const taskId = String(row.task_id);
      videosByTaskId.set(taskId, [
        ...(videosByTaskId.get(taskId) ?? []),
        mapTaskVideoRecord(row as unknown as Record<string, unknown>),
      ]);
    });

  return videosByTaskId;
}

export function indexStepTools(rows: StepToolRow[] = []) {
  const toolsByTaskId = new Map<string, Map<string, string[]>>();

  [...rows]
    .sort((left, right) => left.sequence - right.sequence || left.tool_name.localeCompare(right.tool_name))
    .forEach((row) => {
      const taskId = String(row.task_id);
      const stepId = String(row.step_id);
      const stepMap = toolsByTaskId.get(taskId) ?? new Map<string, string[]>();
      stepMap.set(stepId, [...(stepMap.get(stepId) ?? []), String(row.tool_name)]);
      toolsByTaskId.set(taskId, stepMap);
    });

  return toolsByTaskId;
}
