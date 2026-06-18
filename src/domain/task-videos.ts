import type { Task } from "./types";

// Task-level build animations (motion videos) from the SolidWorks add-in. Same task-level shape as
// exploded views, stored as a flat array on task.customFields["taskVideos"]; the task_videos table is
// the source of truth, hydrated into customFields on load.
export const TASK_VIDEOS_FIELD = "taskVideos";

export interface TaskVideo {
  id: string;
  name: string;
  videoUrl: string;
  capturedAt: string;
  contentType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  storagePath?: string;
  thumbnailUrl?: string;
  thumbnailStoragePath?: string;
  caption?: string;
  solidworksFilePath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeVideo(value: unknown): TaskVideo | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id : "";
  const videoUrl = typeof value.videoUrl === "string" ? value.videoUrl : "";

  // Require an id and an http(s) URL (videos are streamed from Storage, never inlined).
  if (!id || !/^https?:\/\//.test(videoUrl)) {
    return null;
  }

  return {
    id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : "Build animation",
    videoUrl,
    capturedAt:
      typeof value.capturedAt === "string" && value.capturedAt.trim()
        ? value.capturedAt
        : new Date().toISOString(),
    contentType: typeof value.contentType === "string" ? value.contentType : undefined,
    sizeBytes: typeof value.sizeBytes === "number" ? value.sizeBytes : undefined,
    durationSeconds: typeof value.durationSeconds === "number" ? value.durationSeconds : undefined,
    width: typeof value.width === "number" ? value.width : undefined,
    height: typeof value.height === "number" ? value.height : undefined,
    storagePath: typeof value.storagePath === "string" ? value.storagePath : undefined,
    thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : undefined,
    thumbnailStoragePath: typeof value.thumbnailStoragePath === "string" ? value.thumbnailStoragePath : undefined,
    caption: typeof value.caption === "string" ? value.caption : undefined,
    solidworksFilePath: typeof value.solidworksFilePath === "string" ? value.solidworksFilePath : undefined,
  };
}

export function getTaskVideos(task: Pick<Task, "customFields">): TaskVideo[] {
  const raw = task.customFields?.[TASK_VIDEOS_FIELD];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(sanitizeVideo).filter((video): video is TaskVideo => Boolean(video));
}

export function countTaskVideos(task: Pick<Task, "customFields">) {
  return getTaskVideos(task).length;
}

function writeVideos(task: Task, videos: TaskVideo[]): Task {
  const nextCustomFields = { ...task.customFields };
  if (videos.length > 0) {
    nextCustomFields[TASK_VIDEOS_FIELD] = videos;
  } else {
    delete nextCustomFields[TASK_VIDEOS_FIELD];
  }
  return { ...task, customFields: nextCustomFields };
}

export function addTaskVideos(task: Task, videos: TaskVideo[]): Task {
  if (videos.length === 0) {
    return task;
  }
  return writeVideos(task, [...getTaskVideos(task), ...videos]);
}

export function upsertTaskVideos(task: Task, videos: TaskVideo[]): Task {
  if (videos.length === 0) {
    return task;
  }
  const byId = new Map(getTaskVideos(task).map((video) => [video.id, video]));
  videos.forEach((video) => byId.set(video.id, video));
  return writeVideos(task, [...byId.values()]);
}

export function removeTaskVideo(task: Task, videoId: string): Task {
  return writeVideos(task, getTaskVideos(task).filter((video) => video.id !== videoId));
}
