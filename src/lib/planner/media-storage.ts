// Planner media storage: bucket names, storage-path builders (project-scoped where a project is known),
// signing with the browser-only signed-URL cache, row signing for photos, exploded views, videos and tool
// images, best-effort object removal, and data-URL/thumbnail helpers. The signed-URL cache is deliberately
// browser-only (never read or written on the server, where one process serves many users) -- keep its two
// guards together with it. Moved verbatim from supabase-planner.ts (Phase 4).

import { plannerClient, supabaseUrl } from "./client";
import {
  SignedMediaRow,
  StepExplodedViewRow,
  StepPhotoRow,
  TaskVideoRow,
  ToolLibraryRow,
} from "./media-rows";
import { throwIfError } from "./query-helpers";
import type { StepPhotoAttachment } from "@/domain/step-photos";
import type { PlannerProjectContext } from "@/domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const stepPhotoBucket = "step-photos";
export const taskVideoBucket = "task-videos";
const STEP_PHOTO_THUMBNAIL_EDGE = 320;
export const STORAGE_SIGNED_URL_SECONDS = 60 * 60;
// Reuse a signed URL across loads until it's within this margin of expiry. The step-photos bucket is
// private, so every image needs a signed URL -- but objects are immutable (paths embed a unique photo
// id), so the only reason to re-sign is token expiry. Re-signing on every planner load (egress audit)
// changed the `?token=` each time, which is the browser's HTTP cache key, so the 1-year cacheControl
// on the objects never took effect and every realtime-triggered reload re-downloaded every photo.
// Caching keeps the URL stable, so each image downloads ~once per token lifetime per browser instead.
const STORAGE_SIGNED_URL_REFRESH_MARGIN_MS = 10 * 60 * 1000;

type CachedSignedUrl = { url: string; expiresAt: number };
// Keyed by storage path; only ever holds immutable paths (callers opt in via `cache: true` -- see
// signedStorageUrl). Module-scoped so it survives the planner reloads a single page session triggers
// (where the repeated re-signing happened); a hard refresh starts cold, which is fine.
const signedUrlCache = new Map<string, CachedSignedUrl>();

// Only the browser caches: each user's tab is its own process, so a cached URL can never reach a
// different user. On the server the module is a shared process, so we always sign fresh there -- a
// shared cache could otherwise hand one user a URL signed under another user's RLS check.
function cachedSignedUrl(storagePath: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const entry = signedUrlCache.get(storagePath);
  if (entry && entry.expiresAt - Date.now() > STORAGE_SIGNED_URL_REFRESH_MARGIN_MS) {
    return entry.url;
  }
  return undefined;
}

function rememberSignedUrl(storagePath: string, url: string) {
  if (typeof window === "undefined") {
    return;
  }
  signedUrlCache.set(storagePath, { url, expiresAt: Date.now() + STORAGE_SIGNED_URL_SECONDS * 1000 });
}

// Pass `cache: true` ONLY for immutable storage paths -- step-photo paths embed a unique photo id, so
// the bytes at a path never change and a reused signed URL is always correct. Tool-library images are
// keyed by tool name and re-uploaded with upsert (same path, new bytes), so caching their URL would
// serve the stale image after a replace; they must use the default (uncached) path.
export async function signedStorageUrl(
  supabase: SupabaseClient,
  storagePath?: string | null,
  { cache = false }: { cache?: boolean } = {},
) {
  if (!storagePath) {
    return undefined;
  }

  if (cache) {
    const hit = cachedSignedUrl(storagePath);
    if (hit) {
      return hit;
    }
  }

  const { data, error } = await supabase.storage
    .from(stepPhotoBucket)
    .createSignedUrl(storagePath, STORAGE_SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    return undefined;
  }

  if (cache) {
    rememberSignedUrl(storagePath, data.signedUrl);
  }
  return data.signedUrl;
}

async function signedStorageUrls(
  supabase: SupabaseClient,
  storagePaths: string[],
  { cache = false }: { cache?: boolean } = {},
) {
  const uniquePaths = [...new Set(storagePaths.filter(Boolean))];
  const resolved = new Map<string, string>();
  const missing: string[] = [];

  for (const path of uniquePaths) {
    const hit = cache ? cachedSignedUrl(path) : undefined;
    if (hit) {
      resolved.set(path, hit);
    } else {
      missing.push(path);
    }
  }

  if (missing.length === 0) {
    return resolved;
  }

  const { data, error } = await supabase.storage
    .from(stepPhotoBucket)
    .createSignedUrls(missing, STORAGE_SIGNED_URL_SECONDS);

  if (error || !data) {
    return resolved;
  }

  for (const entry of data) {
    if (entry.path && entry.signedUrl) {
      const path = String(entry.path);
      const url = String(entry.signedUrl);
      if (cache) {
        rememberSignedUrl(path, url);
      }
      resolved.set(path, url);
    }
  }

  return resolved;
}

export async function withSignedStepPhotoRows(
  supabase: SupabaseClient,
  rows: StepPhotoRow[] = [],
): Promise<SignedMediaRow<StepPhotoRow>[]> {
  const signedUrls = await signedStorageUrls(
    supabase,
    rows.flatMap((row) => [row.storage_path, row.thumbnail_storage_path].filter((value): value is string => Boolean(value))),
    { cache: true },
  );

  return rows.map((row) => ({
    ...row,
    public_url: row.storage_path ? signedUrls.get(row.storage_path) : undefined,
    thumbnail_url: (row.thumbnail_storage_path ? signedUrls.get(row.thumbnail_storage_path) : undefined) ?? null,
  }));
}

export async function withSignedExplodedViewRows(
  supabase: SupabaseClient,
  rows: StepExplodedViewRow[] = [],
): Promise<SignedMediaRow<StepExplodedViewRow>[]> {
  const signedUrls = await signedStorageUrls(
    supabase,
    rows.flatMap((row) => [row.storage_path, row.thumbnail_storage_path].filter((value): value is string => Boolean(value))),
    { cache: true },
  );

  return rows.map((row) => ({
    ...row,
    public_url: row.storage_path ? signedUrls.get(row.storage_path) : undefined,
    thumbnail_url: (row.thumbnail_storage_path ? signedUrls.get(row.thumbnail_storage_path) : undefined) ?? null,
  }));
}

// Videos live in their own bucket, so sign against it directly (the shared helpers target step-photos).
export async function withSignedTaskVideoRows(
  supabase: SupabaseClient,
  rows: TaskVideoRow[] = [],
): Promise<SignedMediaRow<TaskVideoRow>[]> {
  const paths = [
    ...new Set(
      rows.flatMap((row) => [row.storage_path, row.thumbnail_storage_path].filter((value): value is string => Boolean(value))),
    ),
  ];
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(taskVideoBucket).createSignedUrls(paths, STORAGE_SIGNED_URL_SECONDS);
    (data ?? []).forEach((entry) => {
      if (entry.path && entry.signedUrl) {
        signed.set(String(entry.path), String(entry.signedUrl));
      }
    });
  }

  return rows.map((row) => ({
    ...row,
    public_url: row.storage_path ? signed.get(row.storage_path) : undefined,
    thumbnail_url: (row.thumbnail_storage_path ? signed.get(row.thumbnail_storage_path) : undefined) ?? null,
  }));
}

export async function withSignedToolLibraryRows(supabase: SupabaseClient, rows: ToolLibraryRow[] = []) {
  const signedUrls = await signedStorageUrls(
    supabase,
    rows.map((row) => row.storage_path).filter((value): value is string => Boolean(value)),
  );

  // Same private-bucket rule as the step assets: the stored image_url is a fabricated public URL
  // that can never load, so an unsigned path yields an absent image, not a broken one.
  return rows.map((row) => ({
    ...row,
    image_url: (row.storage_path ? signedUrls.get(row.storage_path) : undefined) ?? null,
  }));
}

// Shared layout for every step-scoped storage asset (photos, thumbnails, exploded views). When a
// project context is present the path is workspace/project scoped; otherwise it falls back to a flat
// task/step path. `subdir` inserts an extra segment (e.g. "thumbnails", "exploded") before the file.
function buildStepAssetStoragePath(
  taskId: string,
  stepId: string,
  fileName: string,
  project?: PlannerProjectContext,
  subdir?: string,
) {
  const tail = subdir ? [subdir, fileName] : [fileName];
  const pathSegments = project
    ? ["workspaces", project.workspaceId, "projects", project.projectId, "tasks", taskId, "steps", stepId, ...tail]
    : [taskId, stepId, ...tail];

  return pathSegments.map(safeStorageSegment).join("/");
}

// Task-scoped variant (no step segment) for task-level assets like exploded views. Still produces a
// `workspaces/<ws>/projects/<proj>/tasks/<task>/…` path that satisfies the step-photos storage policy.
export function buildTaskAssetStoragePath(taskId: string, fileName: string, project?: PlannerProjectContext, subdir?: string) {
  const tail = subdir ? [subdir, fileName] : [fileName];
  const pathSegments = project
    ? ["workspaces", project.workspaceId, "projects", project.projectId, "tasks", taskId, ...tail]
    : [taskId, ...tail];

  return pathSegments.map(safeStorageSegment).join("/");
}

export function projectScopedStoragePath(
  taskId: string,
  stepId: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
  extension = "jpg",
) {
  return buildStepAssetStoragePath(taskId, stepId, `${photo.id}.${extension}`, project);
}

export function projectScopedThumbnailStoragePath(
  taskId: string,
  stepId: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
) {
  return buildStepAssetStoragePath(taskId, stepId, `${photo.id}.webp`, project, "thumbnails");
}

export type StorageObjectPathRow = { storage_path?: string | null; thumbnail_storage_path?: string | null };

export function storageObjectPaths(rows: StorageObjectPathRow[]): string[] {
  return [
    ...new Set(
      rows
        .flatMap((row) => [row.storage_path, row.thumbnail_storage_path])
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

// Best-effort Storage object removal. The bucket DELETE policies allow anyone with per-project
// 'edit' access, so this normally succeeds; failures are logged (never thrown) so storage cleanup
// can never block or roll back the row-level operation it accompanies.
export async function removeStorageObjects(supabase: SupabaseClient, bucket: string, paths: string[]) {
  if (paths.length === 0) {
    return;
  }

  try {
    await throwIfError(supabase.storage.from(bucket).remove(paths));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to remove ${paths.length} object(s) from the ${bucket} bucket: ${detail}`);
  }
}

export function dataUrlToBlob(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("Unable to prepare photo for upload.");
  }

  const metadata = dataUrl.slice("data:".length, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const metadataParts = metadata.split(";");
  const contentType = metadataParts[0] || "application/octet-stream";
  const isBase64 = metadataParts.includes("base64");
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: contentType });
}

function blobToImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (typeof Image === "undefined" || typeof URL === "undefined") {
      reject(new Error("Photo thumbnails can only be generated in the browser."));
      return;
    }

    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to generate photo thumbnail."));
    };
    image.src = objectUrl;
  });
}

export async function createPhotoThumbnailBlob(blob: Blob) {
  if (typeof document === "undefined") {
    return null;
  }

  const image = await blobToImage(blob);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const scale = Math.min(1, STEP_PHOTO_THUMBNAIL_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(image, 0, 0, width, height);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((thumbnailBlob) => resolve(thumbnailBlob), "image/webp", 0.78);
  });
}

export function safeStorageSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

// The value stored in the NOT NULL public_url/thumbnail_url/image_url columns. The buckets are
// PRIVATE, so this URL can never actually load -- it is written only to satisfy the schema and is
// never trusted on the read path (rendering always uses signed URLs; see SignedMediaRow).
export function stableStoragePublicUrl(storagePath: string) {
  return `${supabaseUrl}/storage/v1/object/public/${stepPhotoBucket}/${storagePath}`;
}

// Re-sign a storage object URL after the browser reports a load failure -- typically an expired
// signed URL in a tab that sat idle past STORAGE_SIGNED_URL_SECONDS. Replaces the cached entry for
// photo paths (videos are never cached; see withSignedTaskVideoRows) so subsequent renders reuse
// the fresh URL. Returns undefined when re-signing fails, letting callers fall back to a placeholder.
export async function refreshSignedMediaUrl(storagePath: string, kind: "photo" | "video"): Promise<string | undefined> {
  if (!storagePath) {
    return undefined;
  }

  const supabase = plannerClient();
  const bucket = kind === "video" ? taskVideoBucket : stepPhotoBucket;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, STORAGE_SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    console.warn(
      `Failed to refresh the signed URL for ${bucket}/${storagePath}: ${error?.message ?? "no URL returned"}`,
    );
    return undefined;
  }

  if (kind === "photo") {
    rememberSignedUrl(storagePath, data.signedUrl);
  }
  return data.signedUrl;
}
