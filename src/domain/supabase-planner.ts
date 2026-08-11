import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database, Json, TablesUpdate } from "@/lib/database.types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  AccessLevel,
  ActualEvent,
  CustomColumn,
  Dependency,
  MemberAccess,
  DocumentTypeCode,
  ManufacturingStep,
  ManufacturingComponent,
  PartReference,
  PlannerState,
  PlannerProjectContext,
  Product,
  Project,
  Scenario,
  ScenarioSummary,
  Station,
  Task,
  Workspace,
  WorkspaceAccessGrant,
  WorkspaceMemberProfile,
  WorkspaceProjectGroup,
  WorkspaceRole,
  Zone,
} from "./types";
import {
  STEP_PHOTO_ATTACHMENTS_FIELD,
  getTaskStepPhotoAnnotationMap,
  type StepPhotoAttachment,
} from "./step-photos";
import { EXPLODED_VIEWS_FIELD, normalizeComponents, type ExplodedView } from "./step-exploded-views";
import { TASK_VIDEOS_FIELD, type TaskVideo } from "./task-videos";
import { mergeStepDependencyRefs, splitStepDependencyRefs } from "./step-part-references";
import { STEP_TOOL_LISTS_FIELD, getTaskStepToolListMap } from "./step-tools";
import { formatDisplayTitle } from "@/lib/display-names";
import { isAllowedSignupEmail, SIGNUP_DOMAIN_MESSAGE } from "@/lib/allowed-signup-domain";
import { displayNameValidationMessage, normalizeDisplayName } from "@/lib/profile-name";
import { kickSopNotifications } from "@/lib/sop/notify-kick";
import {
  normalizedInviteEntitlements,
  workspaceRoleForOrganizationRole,
  type WorkspaceInviteEntitlements,
} from "@/domain/workspace/invite-access";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const stepPhotoBucket = "step-photos";
const taskVideoBucket = "task-videos";
const STEP_PHOTO_THUMBNAIL_EDGE = 320;
const STORAGE_SIGNED_URL_SECONDS = 60 * 60;
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
type RealtimePlannerTable =
  | "products"
  | "scenarios"
  | "stations"
  | "zones"
  | "tasks"
  | "task_dependencies"
  | "manufacturing_components"
  | "document_type_codes"
  | "manufacturing_steps"
  | "part_references"
  | "actual_events"
  | "custom_columns"
  | "step_photos"
  | "step_exploded_views"
  | "task_videos"
  | "step_tools"
  | "tool_library";

type PlannerRealtimeScope = {
  productId?: string;
  scenarioId?: string;
  // Membership test for "does this task belong to the scenario I'm showing". Read live at event time
  // (back it with a ref in the component) so the channel never has to be torn down when the task set
  // changes. Task-child tables subscribe unfiltered and are narrowed here instead of by a server-side
  // filter that would rewrite realtime.subscription on every task add/remove/reorder.
  isTaskInScope?: (taskId: string) => boolean;
};

export type PlannerRealtimePayload = {
  table: RealtimePlannerTable;
  eventType: "INSERT" | "UPDATE" | "DELETE" | "*";
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
};

// Extract the owning task id from a realtime payload, for the targeted single-task refresh path.
// Child tables key off `task_id`; the `tasks` table keys off `id`. DELETE payloads still carry these
// because every planner table is REPLICA IDENTITY FULL, so payload.old holds the full row.
export function taskIdFromRealtimePayload(payload: PlannerRealtimePayload): string | undefined {
  const record = payload.new ?? payload.old;
  if (!record) {
    return undefined;
  }

  if (payload.table === "tasks") {
    return typeof record.id === "string" ? record.id : undefined;
  }

  return typeof record.task_id === "string" ? record.task_id : undefined;
}

// Whether a realtime change can be absorbed by re-fetching just the owning task (loadTaskFromSupabase)
// instead of reloading the whole scenario and re-signing every photo. Rows that live ON the task
// (steps, parts, photos, tools) leave their task intact, so ANY event -- including DELETE -- is
// patchable. NOTE: actual_events is deliberately NOT patchable -- those rows load into the top-level
// PlannerState.actualEvents array, not the Task, so loadTaskFromSupabase can't reconcile them; they
// must full-reload (a stale actualEvents can otherwise be re-persisted on save). A `tasks` DELETE
// removes the task and cascades (dependencies, rollups, selection), so it also falls back to a full
// reload.
export function canPatchTaskFromRealtimePayload(payload: PlannerRealtimePayload): boolean {
  switch (payload.table) {
    case "manufacturing_steps":
    case "part_references":
    case "step_photos":
    case "step_exploded_views":
    case "task_videos":
    case "step_tools":
      return true;
    case "tasks":
      return payload.eventType !== "DELETE";
    default:
      return false;
  }
}

// Decide whether a realtime change is relevant to the locally-shown scenario. Structural tables
// (products/scenarios/stations/zones/custom_columns/tasks) are filtered server-side by product/scenario
// scope, so they are always in scope here. Task-child tables subscribe unfiltered -- to keep the
// channel stable across task add/remove -- so they're narrowed to the scenario's tasks at delivery.
// This is a relevance filter, not an authorization boundary: RLS still gates the actual row reads
// (loadTaskFromSupabase / loadPlannerStateFromSupabase), so a missed narrowing leaks no data.
export function isRealtimePayloadInScope(
  payload: PlannerRealtimePayload,
  isTaskInScope: (taskId: string) => boolean,
): boolean {
  const record = payload.new ?? payload.old;
  switch (payload.table) {
    case "manufacturing_steps":
    case "part_references":
    case "actual_events":
    case "step_photos":
    case "step_exploded_views":
    case "task_videos":
    case "step_tools":
      return typeof record?.task_id === "string" && isTaskInScope(record.task_id);
    case "task_dependencies":
      // Dependencies load by successor_task_id (loadTaskFromSupabase / loadProjectPlannerData), so a
      // change is only relevant when the successor is in scope -- this mirrors the server filter this
      // narrowing replaced. A predecessor-only match would force a full reload that can't reflect it.
      return typeof record?.successor_task_id === "string" && isTaskInScope(record.successor_task_id);
    default:
      return true;
  }
}

type StepPhotoRow = {
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

type StepExplodedViewRow = {
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

type StepToolRow = {
  id: string;
  task_id: string;
  step_id: string;
  tool_name: string;
  sequence: number;
};

type ToolLibraryRow = {
  id: string;
  project_id?: string | null;
  tool_name: string;
  image_url?: string | null;
  storage_path?: string | null;
  category?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ToolLibraryItem = {
  id: string;
  projectId?: string;
  toolName: string;
  imageUrl?: string;
  storagePath?: string;
  category?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SaveState = "idle" | "loading" | "saving" | "saved" | "draft" | "retrying" | "conflict" | "error";

type PlannerSupabaseGlobal = typeof globalThis & {
  __buildlogicPlannerSupabaseClient?: SupabaseClient<Database>;
};

/**
 * One-time bridge from the pre-Stage-3 localStorage session to cookie storage:
 * signed-in users keep their session across the cutover instead of being forced
 * to sign in again. The localStorage key is removed BEFORE the async setSession
 * resolves so the bridge can never run twice, and it is skipped entirely when a
 * cookie session already exists (never overwrite a newer session with an older
 * token). Failure mode is benign: the user signs in once, fresh.
 */
function migrateLocalStorageSessionToCookies(client: SupabaseClient<Database>) {
  try {
    const hasCookieSession = document.cookie
      .split(";")
      .some((part) => /^\s*sb-[^=]*-auth-token(?:\.\d+)?=/.test(part));
    if (hasCookieSession) return;

    const legacyKey = Object.keys(window.localStorage).find(
      (key) => key.startsWith("sb-") && key.includes("-auth-token"),
    );
    if (!legacyKey) return;

    const raw = window.localStorage.getItem(legacyKey);
    if (!raw) return;

    // supabase-js may store the payload base64url-encoded with a "base64-" prefix.
    const json = raw.startsWith("base64-")
      ? new TextDecoder().decode(
          Uint8Array.from(atob(raw.slice("base64-".length).replace(/-/g, "+").replace(/_/g, "/")), (c) =>
            c.charCodeAt(0),
          ),
        )
      : raw;

    const parsed = JSON.parse(json) as { access_token?: unknown; refresh_token?: unknown };
    if (typeof parsed.access_token !== "string" || typeof parsed.refresh_token !== "string") {
      return; // Unrecognized shape: leave the key alone rather than destroy it.
    }

    // Remove only once the tokens are safely extracted. Re-running after a failed
    // setSession is harmless (a used refresh token just rejects), and the
    // cookie-present guard above prevents re-running after success.
    window.localStorage.removeItem(legacyKey);
    void client.auth.setSession({
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
    });
  } catch {
    // Corrupt or unreadable legacy token: fall through to a normal sign-in.
  }
}

function plannerClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  if (typeof window !== "undefined") {
    const globalScope = globalThis as PlannerSupabaseGlobal;
    if (!globalScope.__buildlogicPlannerSupabaseClient) {
      // Cookie-backed sessions (@supabase/ssr) replace the previous localStorage
      // sessions so the server can identify the user too (refactor plan, Stage 3).
      // Auth behavior is unchanged: one persistent session, background token
      // refresh, low auth traffic elsewhere (see getUserFromSession).
      globalScope.__buildlogicPlannerSupabaseClient = createSupabaseBrowserClient();
      migrateLocalStorageSessionToCookies(globalScope.__buildlogicPlannerSupabaseClient);
    }
    return globalScope.__buildlogicPlannerSupabaseClient;
  }

  // Server-side there is deliberately NO working client (refactor plan, Stage 4).
  // The old fallback here was a sessionless anon singleton: every RLS-scoped read
  // through it returned zero rows, so a page accidentally calling this from the
  // server rendered EMPTY instead of erroring — the silent failure that becomes a
  // data-loss chain once full-state saves are involved.
  //
  // CONSTRUCTING is allowed, because client components run on the server for the
  // initial HTML and several build a client in render-time useMemo, using it only
  // inside effects/handlers that never run during SSR. USING it on the server is
  // what throws: any property access (auth, from, rpc, ...) fails loudly with
  // guidance. Server code must pass an explicit per-request client
  // (src/lib/supabase/server.ts) to the data functions.
  return new Proxy({} as SupabaseClient<Database>, {
    get(_target, prop) {
      if (typeof prop === "symbol" || prop === "then") {
        // Benign framework probes (thenable checks, React internals) — not real use.
        return undefined;
      }
      throw new Error(
        `createPlannerSupabaseClient() is browser-only: '${String(prop)}' was accessed during a server ` +
          "render. Create a per-request client with createSupabaseServerClient() and pass it to the " +
          "data function explicitly.",
      );
    },
  });
}

export function createPlannerSupabaseClient() {
  return plannerClient();
}

/**
 * The current user from the CACHED session — NO network round-trip. Use this instead of
 * `getUserFromSession(supabase)` for "who am I" (stamping created_by/updated_by, presence keys).
 * `getUser()` calls the auth server on every invocation, which counts against Supabase Auth's
 * (GoTrue) rate limit; under heavy navigation that burst can trip the limit and boot the user to
 * login. `getSession()` reads the already-verified JWT locally. Returns the same
 * `{ data: { user }, error }` shape so call sites don't change how they read the result.
 *
 * SERVER CALLERS (Stage 4+): pass a per-request cookie client and note the semantics —
 * on the server, getSession() reads the UNVERIFIED cookie payload, which is acceptable
 * only because middleware.ts already ran getUser() for the request. And this function
 * returns `user: null` rather than throwing when signed out: a server caller that
 * ignores the null renders an EMPTY page, not an error. Check the null explicitly.
 */
export async function getUserFromSession(
  supabase: SupabaseClient,
): Promise<{ data: { user: User | null }; error: null }> {
  const { data } = await supabase.auth.getSession();
  return { data: { user: data.session?.user ?? null }, error: null };
}

function num(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function maybeNum(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return num(value);
}

function maybeText(value: unknown) {
  return typeof value === "string" && value.length ? value : undefined;
}

function textArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeAccessLevel(value: unknown): AccessLevel {
  return value === "edit" || value === "view" ? value : "none";
}

// PostgREST/Postgres error codes meaning "this table or function isn't in the schema yet"
// (i.e. a migration hasn't been applied). Callers use this to degrade gracefully.
const MISSING_RELATION_CODES = ["42P01", "PGRST205", "PGRST202"];

function isMissingRelationError(error: { code?: string } | null): boolean {
  return Boolean(error && error.code && MISSING_RELATION_CODES.includes(error.code));
}

function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mapInviteProjectAccess(value: unknown): WorkspaceAccessGrant["projectAccess"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = jsonObject(item);
    const projectId = maybeText(row.projectId ?? row.project_id);
    const level = normalizeAccessLevel(row.level);
    return projectId && level !== "none" ? [{ projectId, level }] : [];
  });
}

function mapInviteDepartmentAccess(value: unknown): WorkspaceAccessGrant["departmentAccess"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = jsonObject(item);
    const departmentId = maybeText(row.departmentId ?? row.department_id);
    const role = row.role;
    const positionTitle = maybeText(row.positionTitle ?? row.position_title) ?? "";
    return departmentId && (role === "author" || role === "reviewer" || role === "approver")
      ? [{ departmentId, role, positionTitle }]
      : [];
  });
}

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    projectId: maybeText(row.project_id),
    productCode: maybeText(row.product_code),
    name: String(row.name ?? ""),
    sku: maybeText(row.sku),
    family: maybeText(row.family),
    revision: String(row.revision ?? "Rev A"),
    description: maybeText(row.description),
    ownerId: maybeText(row.owner_id),
    ownerName: String(row.owner_name ?? "Manufacturing Engineering"),
    status: String(row.status ?? "draft") as Product["status"],
    targetManHours: num(row.target_man_hours),
    demandQuantity: num(row.demand_quantity, 1),
    demandPeriod: String(row.demand_period ?? "day") as Product["demandPeriod"],
    grossAvailableMinutes: num(row.gross_available_minutes),
    breakMinutes: num(row.break_minutes),
    lunchMinutes: num(row.lunch_minutes),
    meetingMinutes: num(row.meeting_minutes),
    plannedDowntimeMinutes: num(row.planned_downtime_minutes),
    workDaysPerWeek: num(row.work_days_per_week, 5),
    workWeeksPerMonth: num(row.work_weeks_per_month, 4.33),
    availableWorkDaysPerMonth: num(row.available_work_days_per_month),
    netAvailableMinutes: num(row.net_available_minutes),
    weeklyAvailableMinutes: num(row.weekly_available_minutes),
    monthlyAvailableMinutes: num(row.monthly_available_minutes),
    calculatedTaktMinutes: num(row.calculated_takt_minutes),
    manualTaktMinutes: maybeNum(row.manual_takt_minutes),
    activeTaktMinutes: num(row.active_takt_minutes),
    customFields: jsonObject(row.custom_fields),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// Exact columns consumed by mapWorkspace/mapProject -- avoids select('*') on the hot
// sidebar load path (audit #9). Keep in sync with the mappers below.
const WORKSPACE_COLUMNS = "id, name, owner_id, created_at, updated_at";
const PROJECT_COLUMNS = "id, workspace_id, name, description, status, created_by, created_at, updated_at";

function mapWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    ownerId: maybeText(row.owner_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name ?? ""),
    description: maybeText(row.description),
    status: String(row.status ?? "active") as Project["status"],
    createdBy: maybeText(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapWorkspaceAccessGrant(row: Record<string, unknown>): WorkspaceAccessGrant {
  return {
    workspaceId: String(row.workspace_id),
    email: String(row.email ?? ""),
    role: String(row.role ?? "editor") as WorkspaceRole,
    qualityAccess: normalizeAccessLevel(row.quality_access),
    accessPackage: String(row.access_package ?? "custom"),
    planningAccess: Boolean(row.planning_access),
    projectAccess: mapInviteProjectAccess(row.project_access),
    departmentAccess: mapInviteDepartmentAccess(row.department_access),
    grantedBy: maybeText(row.granted_by),
    redeemedBy: maybeText(row.redeemed_by),
    redeemedAt: maybeText(row.redeemed_at),
    expiresAt: maybeText(row.expires_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapScenario(row: Record<string, unknown>): Scenario {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    name: String(row.name ?? ""),
    description: maybeText(row.description),
    type: String(row.type ?? "current_state") as Scenario["type"],
    status: String(row.status ?? "draft") as Scenario["status"],
    targetOutput: num(row.target_output, 1),
    targetOutputPeriod: String(row.target_output_period ?? "day"),
    notes: maybeText(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// Pure mapper for the lightweight scenario-tab rows. Exported for unit testing.
export function mapScenarioSummary(row: Record<string, unknown>): ScenarioSummary {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    targetOutput: num(row.target_output, 1),
    targetOutputPeriod: String(row.target_output_period ?? "day"),
    notes: maybeText(row.notes),
    createdAt: String(row.created_at),
  };
}

function mapStation(row: Record<string, unknown>): Station {
  return {
    id: String(row.id),
    scenarioId: String(row.scenario_id),
    sequence: num(row.sequence, 1),
    name: String(row.name ?? ""),
    description: maybeText(row.description),
    ownerId: maybeText(row.owner_id),
    ownerName: String(row.owner_name ?? "Manufacturing Engineering"),
    plannedCycleMinutes: num(row.planned_cycle_minutes),
    actualCycleMinutes: maybeNum(row.actual_cycle_minutes),
    plannedOperators: num(row.planned_operators, 1),
    actualOperators: maybeNum(row.actual_operators),
    plannedManHours: num(row.planned_man_hours),
    actualManHours: maybeNum(row.actual_man_hours),
    taktStatus: String(row.takt_status ?? "missing") as Station["taktStatus"],
    bottleneckFlag: Boolean(row.bottleneck_flag),
    wipLimit: maybeNum(row.wip_limit),
    area: maybeText(row.area),
    toolsRequired: textArray(row.tools_required),
    equipmentRequired: textArray(row.equipment_required),
    safetyNotes: maybeText(row.safety_notes),
    qcNotes: maybeText(row.qc_notes),
  };
}

function mapZone(row: Record<string, unknown>): Zone {
  return {
    id: String(row.id),
    scenarioId: String(row.scenario_id),
    sequence: num(row.sequence, 1),
    name: formatDisplayTitle(String(row.name ?? "")),
    code: maybeText(row.code),
    description: maybeText(row.description),
    color: String(row.color ?? "#15756d"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapManufacturingComponent(row: Record<string, unknown>): ManufacturingComponent {
  return {
    id: String(row.id),
    scenarioId: String(row.scenario_id),
    zoneId: maybeText(row.zone_id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    description: maybeText(row.description),
    sequence: num(row.sequence, 1),
    active: row.active !== false,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapDocumentTypeCode(row: Record<string, unknown>): DocumentTypeCode {
  return {
    id: String(row.id),
    projectId: maybeText(row.project_id),
    productId: maybeText(row.product_id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    active: row.active !== false,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapManufacturingStepRecord(row: Record<string, unknown>): ManufacturingStep {
  const stepRefs = splitStepDependencyRefs(textArray(row.dependencyIds ?? row.dependency_ids));

  return {
    id: String(row.id),
    sequence: num(row.sequence, 1),
    name: String(row.name ?? ""),
    instruction: String(row.instruction ?? ""),
    durationMinutes: num(row.durationMinutes ?? row.duration_minutes),
    qualityCheck: maybeText(row.qualityCheck ?? row.quality_check),
    dependencyIds: stepRefs.dependencyIds,
    partReferenceIds: stepRefs.partReferenceIds,
    version: maybeNum(row.version),
  };
}

function mapManufacturingSteps(value: unknown): ManufacturingStep[] {
  return Array.isArray(value)
    ? value.map((item) => mapManufacturingStepRecord(jsonObject(item)))
    : [];
}

function mapPartReferenceRecord(row: Record<string, unknown>): PartReference {
  return {
    id: String(row.id),
    partNumber: String(row.partNumber ?? row.part_number ?? ""),
    description: maybeText(row.description),
    quantity: maybeNum(row.quantity),
    disposition: maybeText(row.disposition),
  };
}

function mapPartReferences(value: unknown): PartReference[] {
  return Array.isArray(value)
    ? value.map((item) => mapPartReferenceRecord(jsonObject(item)))
    : [];
}

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    scenarioId: String(row.scenario_id),
    stationId: String(row.station_id ?? ""),
    zoneId: maybeText(row.zone_id),
    componentId: maybeText(row.component_id),
    taskNumber: maybeNum(row.task_number),
    manufacturingCode: maybeText(row.manufacturing_code),
    codeLocked: Boolean(row.code_locked),
    codeGeneratedAt: maybeText(row.code_generated_at),
    parentTaskId: maybeText(row.parent_task_id),
    rowType: String(row.row_type ?? "task") as Task["rowType"],
    wbs: String(row.wbs ?? ""),
    name: String(row.name ?? ""),
    description: maybeText(row.description),
    plannedStart: String(row.planned_start),
    plannedFinish: String(row.planned_finish),
    plannedDurationMinutes: num(row.planned_duration_minutes),
    actualStart: maybeText(row.actual_start),
    actualFinish: maybeText(row.actual_finish),
    actualDurationMinutes: maybeNum(row.actual_duration_minutes),
    plannedOperators: num(row.planned_operators, 1),
    actualOperators: maybeNum(row.actual_operators),
    plannedManHours: num(row.planned_man_hours),
    actualManHours: maybeNum(row.actual_man_hours),
    status: String(row.status ?? "not_started") as Task["status"],
    percentComplete: num(row.percent_complete),
    ownerId: maybeText(row.owner_id),
    ownerName: maybeText(row.owner_name),
    role: maybeText(row.role),
    skillLevel: maybeText(row.skill_level) as Task["skillLevel"],
    dependencyIds: textArray(row.dependency_ids),
    criticalPath: Boolean(row.critical_path),
    bottleneckFlag: Boolean(row.bottleneck_flag),
    qualityGate: Boolean(row.quality_gate),
    travelerSignoffRequired: Boolean(row.traveler_signoff_required),
    sopLink: maybeText(row.sop_link),
    sopId: maybeText(row.sop_id),
    workInstructionLink: maybeText(row.work_instruction_link),
    drawingLink: maybeText(row.drawing_link),
    materialKit: maybeText(row.material_kit),
    toolsRequired: textArray(row.tools_required),
    equipmentRequired: textArray(row.equipment_required),
    safetyNotes: maybeText(row.safety_notes),
    qcChecklist: maybeText(row.qc_checklist),
    reworkRisk: maybeText(row.rework_risk) as Task["reworkRisk"],
    notes: maybeText(row.notes),
    manufacturingSteps: mapManufacturingSteps(row.manufacturing_steps),
    partReferences: mapPartReferences(row.part_references),
    customFields: jsonObject(row.custom_fields),
    version: maybeNum(row.version),
  };
}

function mapDependency(row: Record<string, unknown>): Dependency {
  return {
    id: String(row.id),
    predecessorTaskId: String(row.predecessor_task_id),
    successorTaskId: String(row.successor_task_id),
    type: String(row.type ?? "finish_to_start") as Dependency["type"],
    lagMinutes: maybeNum(row.lag_minutes),
    constraintType: maybeText(row.constraint_type) as Dependency["constraintType"],
  };
}

function mapActualEvent(row: Record<string, unknown>): ActualEvent {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    eventType: String(row.event_type ?? "note") as ActualEvent["eventType"],
    timestamp: String(row.timestamp),
    userId: maybeText(row.user_id),
    notes: maybeText(row.notes),
    reasonCode: maybeText(row.reason_code),
  };
}

function mapCustomColumn(row: Record<string, unknown>): CustomColumn {
  return {
    id: String(row.id),
    productId: maybeText(row.product_id),
    scenarioId: maybeText(row.scenario_id),
    name: String(row.name ?? ""),
    key: String(row.key ?? ""),
    description: maybeText(row.description),
    type: String(row.type ?? "text") as CustomColumn["type"],
    appliesTo: String(row.applies_to ?? "task") as CustomColumn["appliesTo"],
    required: Boolean(row.required),
    defaultValue: row.default_value,
    options: textArray(row.options),
    formula: maybeText(row.formula),
    unit: maybeText(row.unit),
    precision: maybeNum(row.precision),
    visible: row.visible !== false,
    locked: Boolean(row.locked),
  };
}

function productRow(product: Product) {
  return {
    id: product.id,
    project_id: product.projectId ?? null,
    product_code: product.productCode ?? null,
    name: product.name,
    sku: product.sku ?? null,
    family: product.family ?? null,
    revision: product.revision,
    description: product.description ?? null,
    owner_id: product.ownerId ?? null,
    owner_name: product.ownerName,
    status: product.status,
    target_man_hours: product.targetManHours,
    demand_quantity: product.demandQuantity,
    demand_period: product.demandPeriod,
    gross_available_minutes: product.grossAvailableMinutes,
    break_minutes: product.breakMinutes,
    lunch_minutes: product.lunchMinutes,
    meeting_minutes: product.meetingMinutes,
    planned_downtime_minutes: product.plannedDowntimeMinutes,
    work_days_per_week: product.workDaysPerWeek,
    work_weeks_per_month: product.workWeeksPerMonth,
    available_work_days_per_month: product.availableWorkDaysPerMonth,
    net_available_minutes: product.netAvailableMinutes,
    weekly_available_minutes: product.weeklyAvailableMinutes,
    monthly_available_minutes: product.monthlyAvailableMinutes,
    calculated_takt_minutes: product.calculatedTaktMinutes,
    manual_takt_minutes: product.manualTaktMinutes ?? null,
    active_takt_minutes: product.activeTaktMinutes,
    // Runtime contract unchanged: custom fields have always been JSON-serialized by
    // supabase-js. The cast states that contract at the serialization boundary.
    custom_fields: (product.customFields ?? {}) as Json,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  };
}

function scenarioRow(scenario: Scenario) {
  return {
    id: scenario.id,
    product_id: scenario.productId,
    name: scenario.name,
    description: scenario.description ?? null,
    type: scenario.type,
    status: scenario.status,
    target_output: scenario.targetOutput,
    target_output_period: scenario.targetOutputPeriod,
    notes: scenario.notes ?? null,
    created_at: scenario.createdAt,
    updated_at: scenario.updatedAt,
  };
}

function stationRow(station: Station) {
  return {
    id: station.id,
    scenario_id: station.scenarioId,
    sequence: station.sequence,
    name: station.name,
    description: station.description ?? null,
    owner_id: station.ownerId ?? null,
    owner_name: station.ownerName,
    planned_cycle_minutes: station.plannedCycleMinutes,
    actual_cycle_minutes: station.actualCycleMinutes ?? null,
    planned_operators: station.plannedOperators,
    actual_operators: station.actualOperators ?? null,
    planned_man_hours: station.plannedManHours,
    actual_man_hours: station.actualManHours ?? null,
    takt_status: station.taktStatus,
    bottleneck_flag: station.bottleneckFlag,
    wip_limit: station.wipLimit ?? null,
    area: station.area ?? null,
    tools_required: station.toolsRequired ?? [],
    equipment_required: station.equipmentRequired ?? [],
    safety_notes: station.safetyNotes ?? null,
    qc_notes: station.qcNotes ?? null,
  };
}

function zoneRow(zone: Zone) {
  return {
    id: zone.id,
    scenario_id: zone.scenarioId,
    sequence: zone.sequence,
    name: zone.name,
    code: zone.code ?? null,
    description: zone.description ?? null,
    color: zone.color,
    created_at: zone.createdAt,
    updated_at: zone.updatedAt,
  };
}

function manufacturingComponentRow(component: ManufacturingComponent) {
  return {
    id: component.id,
    scenario_id: component.scenarioId,
    zone_id: component.zoneId ?? null,
    code: component.code,
    name: component.name,
    description: component.description ?? null,
    sequence: component.sequence,
    active: component.active,
    created_at: component.createdAt,
    updated_at: component.updatedAt,
  };
}

function documentTypeCodeRow(documentType: DocumentTypeCode) {
  return {
    id: documentType.id,
    project_id: documentType.projectId ?? null,
    product_id: documentType.productId ?? null,
    code: documentType.code,
    name: documentType.name,
    active: documentType.active,
    created_at: documentType.createdAt,
    updated_at: documentType.updatedAt,
  };
}

// PostgREST `.or()` filters are raw strings where comma, parens, and whitespace are
// structural. App IDs are UUIDs / safeStorageSegment output and never contain these, so any
// occurrence means a malformed or hostile value -- reject it rather than let it alter the query.
function assertSafeOrFilterValue(value: string): string {
  if (!value || /[(),\s]/.test(value)) {
    throw new Error(`Unsafe identifier in query filter: ${JSON.stringify(value)}`);
  }
  return value;
}

// Build a PostgREST `.or()` disjunction from column/value pairs, validating every value.
function buildOrFilter(...pairs: ReadonlyArray<readonly [column: string, value: string]>): string {
  return pairs.map(([column, value]) => `${column}.eq.${assertSafeOrFilterValue(value)}`).join(",");
}

function documentTypeScopeFilter(product: Pick<Product, "id" | "projectId">) {
  return product.projectId
    ? buildOrFilter(["project_id", product.projectId], ["product_id", String(product.id)])
    : buildOrFilter(["product_id", String(product.id)]);
}

function customColumnScopeFilter(productId: string, scenarioId: string): string {
  return buildOrFilter(["product_id", productId], ["scenario_id", scenarioId]);
}

function taskRow(task: Task) {
  return {
    id: task.id,
    scenario_id: task.scenarioId,
    station_id: task.stationId || null,
    zone_id: task.zoneId ?? null,
    component_id: task.componentId ?? null,
    task_number: task.taskNumber ?? null,
    manufacturing_code: task.manufacturingCode ?? null,
    code_locked: Boolean(task.codeLocked),
    code_generated_at: task.codeGeneratedAt ?? null,
    parent_task_id: task.parentTaskId ?? null,
    row_type: task.rowType,
    wbs: task.wbs,
    name: task.name,
    description: task.description ?? null,
    planned_start: task.plannedStart,
    planned_finish: task.plannedFinish,
    planned_duration_minutes: task.plannedDurationMinutes,
    actual_start: task.actualStart ?? null,
    actual_finish: task.actualFinish ?? null,
    actual_duration_minutes: task.actualDurationMinutes ?? null,
    planned_operators: task.plannedOperators,
    actual_operators: task.actualOperators ?? null,
    planned_man_hours: task.plannedManHours,
    actual_man_hours: task.actualManHours ?? null,
    status: task.status,
    percent_complete: task.percentComplete,
    owner_id: task.ownerId ?? null,
    owner_name: task.ownerName ?? null,
    role: task.role ?? null,
    skill_level: task.skillLevel ?? null,
    critical_path: task.criticalPath,
    bottleneck_flag: task.bottleneckFlag,
    quality_gate: task.qualityGate,
    traveler_signoff_required: task.travelerSignoffRequired,
    sop_link: task.sopLink ?? null,
    sop_id: task.sopId ?? null,
    work_instruction_link: task.workInstructionLink ?? null,
    drawing_link: task.drawingLink ?? null,
    material_kit: task.materialKit ?? null,
    tools_required: task.toolsRequired ?? [],
    equipment_required: task.equipmentRequired ?? [],
    safety_notes: task.safetyNotes ?? null,
    qc_checklist: task.qcChecklist ?? null,
    rework_risk: task.reworkRisk ?? null,
    notes: task.notes ?? null,
    custom_fields: customFieldsRow(task.customFields),
  };
}

function customFieldsRow(customFields: Task["customFields"]) {
  const nextCustomFields = { ...(customFields ?? {}) };
  delete nextCustomFields[STEP_PHOTO_ATTACHMENTS_FIELD];
  delete nextCustomFields[EXPLODED_VIEWS_FIELD];
  delete nextCustomFields[TASK_VIDEOS_FIELD];
  delete nextCustomFields[STEP_TOOL_LISTS_FIELD];
  // Same serialization-boundary contract as productRow's custom_fields.
  return nextCustomFields as Json;
}

function dependencyRow(dependency: Dependency) {
  return {
    id: dependency.id,
    predecessor_task_id: dependency.predecessorTaskId,
    successor_task_id: dependency.successorTaskId,
    type: dependency.type,
    lag_minutes: dependency.lagMinutes ?? 0,
    constraint_type: dependency.constraintType ?? null,
  };
}

function manufacturingStepRows(tasks: Task[]) {
  return tasks.flatMap((task) =>
    (task.manufacturingSteps ?? []).map((step) => manufacturingStepRow(task.id, step)),
  );
}

function manufacturingStepRow(taskId: string, step: ManufacturingStep) {
  return {
    id: step.id,
    task_id: taskId,
    sequence: step.sequence,
    name: step.name ?? "",
    instruction: step.instruction,
    duration_minutes: step.durationMinutes ?? 0,
    quality_check: step.qualityCheck ?? null,
    dependency_ids: mergeStepDependencyRefs(step.dependencyIds, step.partReferenceIds),
  };
}

function normalizeManufacturingStepSequences(steps: ManufacturingStep[]): ManufacturingStep[] {
  return steps
    .map((step, index) => ({ step, index }))
    .sort((left, right) => {
      const leftSequence = left.step.sequence >= 100000 ? left.index + 1 : left.step.sequence;
      const rightSequence = right.step.sequence >= 100000 ? right.index + 1 : right.step.sequence;
      return leftSequence - rightSequence || left.index - right.index;
    })
    .map(({ step }, index) => ({ ...step, sequence: index + 1 }));
}

function manufacturingStepSaveNeedsCollisionSafeResequence(
  nextSteps: ManufacturingStep[],
  existingSteps: Array<{ id: unknown; sequence: unknown }>,
): boolean {
  const normalizedNext = normalizeManufacturingStepSequences(nextSteps);
  const existingById = new Map(existingSteps.map((step) => [String(step.id), num(step.sequence)]));
  const nextIds = new Set(normalizedNext.map((step) => step.id));

  if (new Set(normalizedNext.map((step) => step.sequence)).size !== normalizedNext.length) {
    return true;
  }

  for (const step of normalizedNext) {
    const previousSequence = existingById.get(step.id);

    if (previousSequence === undefined) {
      const sequenceOccupied = existingSteps.some(
        (existingStep) =>
          nextIds.has(String(existingStep.id)) &&
          num(existingStep.sequence) === step.sequence &&
          String(existingStep.id) !== step.id,
      );
      if (sequenceOccupied) {
        return true;
      }
      continue;
    }

    if (previousSequence === step.sequence) {
      continue;
    }

    const sequenceOccupied = existingSteps.some(
      (existingStep) =>
        num(existingStep.sequence) === step.sequence &&
        String(existingStep.id) !== step.id &&
        nextIds.has(String(existingStep.id)),
    );
    if (sequenceOccupied) {
      return true;
    }
  }

  return false;
}

async function bumpManufacturingStepSequences(supabase: SupabaseClient, stepIds: string[]) {
  if (stepIds.length === 0) {
    return;
  }

  const currentSteps = await throwIfError(supabase.from("manufacturing_steps").select("id,sequence").in("id", stepIds));
  const maxSequence = Math.max(
    100000,
    ...(currentSteps ?? []).map((step) => num(step.sequence)),
  );
  const temporaryBaseSequence = maxSequence + stepIds.length + 1;

  await Promise.all(
    stepIds.map((stepId, index) =>
      throwIfError(supabase.from("manufacturing_steps").update({ sequence: temporaryBaseSequence + index }).eq("id", stepId)),
    ),
  );
}

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

type TaskVideoRow = {
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

function mapTaskVideoRecord(row: Record<string, unknown>): TaskVideo {
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

function mapStepExplodedViewRecord(row: Record<string, unknown>): ExplodedView {
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

// Pass `cache: true` ONLY for immutable storage paths -- step-photo paths embed a unique photo id, so
// the bytes at a path never change and a reused signed URL is always correct. Tool-library images are
// keyed by tool name and re-uploaded with upsert (same path, new bytes), so caching their URL would
// serve the stale image after a replace; they must use the default (uncached) path.
async function signedStorageUrl(
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

// A media row prepared for rendering: its URL columns are replaced by signed URLs, or left absent
// when signing failed. The buckets are PRIVATE, so the stored public_url/thumbnail_url values (kept
// only because the columns are NOT NULL) can never load -- falling back to them would render a
// permanently-broken image, while an absent URL lets components show a placeholder and retry.
type SignedMediaRow<T> = Omit<T, "public_url" | "thumbnail_url"> & {
  public_url?: string;
  thumbnail_url?: string | null;
};

async function withSignedStepPhotoRows(
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

async function withSignedExplodedViewRows(
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
async function withSignedTaskVideoRows(
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

async function withSignedToolLibraryRows(supabase: SupabaseClient, rows: ToolLibraryRow[] = []) {
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

function withNormalizedStepAssets(
  task: Task,
  photosByTaskId: Map<string, Map<string, StepPhotoAttachment[]>>,
  toolsByTaskId: Map<string, Map<string, string[]>>,
  explodedViewsByTaskId: Map<string, ExplodedView[]> = new Map(),
  videosByTaskId: Map<string, TaskVideo[]> = new Map(),
): Task {
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

function indexStepPhotos(rows: SignedMediaRow<StepPhotoRow>[] = []) {
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
function indexExplodedViews(rows: SignedMediaRow<StepExplodedViewRow>[] = []) {
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

function indexTaskVideos(rows: SignedMediaRow<TaskVideoRow>[] = []) {
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

function indexStepTools(rows: StepToolRow[] = []) {
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

function partReferenceRows(tasks: Task[]) {
  return tasks.flatMap((task) =>
    (task.partReferences ?? []).map((part) => ({
      id: part.id,
      task_id: task.id,
      part_number: part.partNumber,
      description: part.description ?? null,
      quantity: part.quantity ?? null,
      disposition: part.disposition ?? null,
    })),
  );
}

// Project-membership assertions are advisory UX guards -- the real enforcement is RLS, which
// gates every write on has_project_access(). These resolve a task/scenario's project in ONE
// round-trip via the SECURITY DEFINER resolver functions (was 3 sequential queries each).
async function assertTaskInProject(supabase: ReturnType<typeof plannerClient>, taskId: string, projectId?: string) {
  if (!projectId) {
    return;
  }

  const resolvedProjectId = await throwIfError(supabase.rpc("task_project_id", { target_task_id: taskId }));
  if (!resolvedProjectId || String(resolvedProjectId) !== projectId) {
    throw new Error("This task does not belong to the active workspace.");
  }
}

async function assertTaskRowInProject(supabase: ReturnType<typeof plannerClient>, task: Task, projectId?: string) {
  if (!projectId) {
    return;
  }

  // A task's project is determined by its scenario; this works for both new (not-yet-saved)
  // and existing tasks. RLS still independently blocks any cross-project write.
  const resolvedProjectId = await throwIfError(
    supabase.rpc("scenario_project_id", { target_scenario_id: task.scenarioId }),
  );
  if (!resolvedProjectId || String(resolvedProjectId) !== projectId) {
    throw new Error("This task does not belong to the active workspace.");
  }
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
function buildTaskAssetStoragePath(taskId: string, fileName: string, project?: PlannerProjectContext, subdir?: string) {
  const tail = subdir ? [subdir, fileName] : [fileName];
  const pathSegments = project
    ? ["workspaces", project.workspaceId, "projects", project.projectId, "tasks", taskId, ...tail]
    : [taskId, ...tail];

  return pathSegments.map(safeStorageSegment).join("/");
}

function projectScopedStoragePath(
  taskId: string,
  stepId: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
  extension = "jpg",
) {
  return buildStepAssetStoragePath(taskId, stepId, `${photo.id}.${extension}`, project);
}

function projectScopedThumbnailStoragePath(
  taskId: string,
  stepId: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
) {
  return buildStepAssetStoragePath(taskId, stepId, `${photo.id}.webp`, project, "thumbnails");
}

function actualEventRow(event: ActualEvent) {
  return {
    id: event.id,
    task_id: event.taskId,
    event_type: event.eventType,
    timestamp: event.timestamp,
    user_id: event.userId ?? null,
    notes: event.notes ?? null,
    reason_code: event.reasonCode ?? null,
  };
}

function customColumnRow(column: CustomColumn) {
  return {
    id: column.id,
    product_id: column.productId ?? null,
    scenario_id: column.scenarioId ?? null,
    name: column.name,
    key: column.key,
    description: column.description ?? null,
    type: column.type,
    applies_to: column.appliesTo,
    required: column.required,
    default_value: (column.defaultValue ?? null) as Json,
    options: column.options ?? [],
    formula: column.formula ?? null,
    unit: column.unit ?? null,
    precision: column.precision ?? null,
    visible: column.visible,
    locked: column.locked,
  };
}

async function throwIfError<T>(operation: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await operation;
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

function newScopedId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomId}`;
}

async function loadProjectContext(
  supabase: ReturnType<typeof plannerClient>,
  projectId: string,
): Promise<PlannerProjectContext> {
  const project = await throwIfError(supabase.from("projects").select("*").eq("id", projectId).maybeSingle());

  if (!project) {
    throw new Error("Workspace not found or you do not have access to it.");
  }

  const workspace = await throwIfError(supabase.from("workspaces").select("*").eq("id", project.workspace_id).maybeSingle());

  if (!workspace) {
    throw new Error("Organization not found or you do not have access to it.");
  }

  const { data: userData } = await getUserFromSession(supabase);
  const member = userData.user
    ? await throwIfError(
        supabase
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", project.workspace_id)
          .eq("user_id", userData.user.id)
          .maybeSingle(),
      )
    : null;

  const superAdmin = await fetchIsSuperAdmin(supabase);
  const memberRole = member?.role ? (String(member.role) as WorkspaceRole) : undefined;
  // Workspace managers (and superadmins) see/edit every project they manage.
  const isManager = superAdmin || memberRole === "owner" || memberRole === "admin";

  let role: WorkspaceRole | undefined;
  let accessLevel: AccessLevel | undefined;

  if (isManager) {
    role = memberRole ?? "owner";
    accessLevel = "edit";
  } else {
    const level = userData.user
      ? await fetchProjectAccessLevel(supabase, String(project.id), userData.user.id)
      : undefined;
    if (level === undefined) {
      // Access model not available yet — fall back to legacy workspace role.
      role = memberRole;
    } else {
      accessLevel = level;
      // Reuse role-based edit gating: edit -> editor, view -> viewer, none -> no access.
      role = level === "edit" ? "editor" : level === "view" ? "viewer" : undefined;
    }
  }

  return {
    projectId: String(project.id),
    projectName: String(project.name ?? ""),
    workspaceId: String(workspace.id),
    workspaceName: String(workspace.name ?? ""),
    role,
    accessLevel,
  };
}

const inflightSuperAdminChecks = new WeakMap<SupabaseClient, Promise<boolean>>();

// Whether the signed-in user is a platform superadmin. Concurrent workspace/access loads share
// one RPC per client, while later refreshes still perform a fresh permission check.
export function fetchIsSuperAdmin(
  supabase: ReturnType<typeof plannerClient> = plannerClient(),
): Promise<boolean> {
  const pending = inflightSuperAdminChecks.get(supabase);
  if (pending) {
    return pending;
  }

  const check = Promise.resolve(supabase.rpc("is_super_admin")).then(({ data, error }) => {
    if (error) {
      if (error.code === "PGRST202") {
        return false;
      }
      throw error;
    }
    return data === true;
  });
  const trackedCheck = check.finally(() => {
    if (inflightSuperAdminChecks.get(supabase) === trackedCheck) {
      inflightSuperAdminChecks.delete(supabase);
    }
  });
  inflightSuperAdminChecks.set(supabase, trackedCheck);
  return trackedCheck;
}

// The signed-in user's access level for a single project. Returns undefined when the
// project_access table doesn't exist yet (pre-migration) so callers can fall back to
// legacy role-based behavior.
async function fetchProjectAccessLevel(
  supabase: ReturnType<typeof plannerClient>,
  projectId: string,
  userId: string,
): Promise<AccessLevel | undefined> {
  const { data, error } = await supabase
    .from("project_access")
    .select("level")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) {
      return undefined;
    }
    throw error;
  }
  return normalizeAccessLevel(data?.level);
}

// The signed-in user's full project-access map (projectId -> level). Returns undefined when
// the project_access table doesn't exist yet (pre-migration) so callers skip filtering.
async function fetchUserProjectAccessMap(
  supabase: ReturnType<typeof plannerClient>,
  userId: string,
): Promise<Map<string, AccessLevel> | undefined> {
  const { data, error } = await supabase.from("project_access").select("project_id, level").eq("user_id", userId);
  if (error) {
    if (isMissingRelationError(error)) {
      return undefined;
    }
    throw error;
  }
  return new Map((data ?? []).map((row) => [String(row.project_id), normalizeAccessLevel(row.level)]));
}

// The signed-in user's Quality Module access level ("edit" for superadmins).
export async function fetchOrgToolAccess(
  workspaceId: string,
  supabase: ReturnType<typeof plannerClient> = plannerClient(),
): Promise<AccessLevel> {
  const [isSuperAdmin, { data: userData }] = await Promise.all([
    fetchIsSuperAdmin(supabase),
    getUserFromSession(supabase),
  ]);
  if (isSuperAdmin) {
    return "edit";
  }
  if (!userData.user) {
    return "none";
  }
  const { data, error } = await supabase
    .from("org_tool_access")
    .select("level")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) {
      return "none";
    }
    throw error;
  }
  const level = data?.level ? String(data.level) : "none";
  return level === "edit" || level === "view" ? (level as AccessLevel) : "none";
}

// The profile upsert + grant redemption only need to run once per signed-in user per tab:
// both are idempotent, and a full page reload re-runs them. Repeat mounts (auth gate,
// sidebar, SOP provider, client-side navigations) skip the two write round-trips.
//
// Both dedupe structures are keyed BY CLIENT (WeakMap, same pattern as
// inflightSuperAdminChecks): in the browser the client is a tab-wide singleton so
// behavior is unchanged, while on a server a per-request client gets fresh state —
// an unkeyed module-level promise there would hand one user's workspace groups to
// a concurrently-loading different user (refactor plan, Stage 4).
const bootstrappedMembershipUserIdsByClient = new WeakMap<SupabaseClient, Set<string>>();
// Concurrent callers on the same client share one in-flight load instead of issuing
// duplicate query chains. The promise is cleared on settle: later calls (e.g. sidebar
// refresh after creating a project) still fetch fresh data.
const inflightMembershipLoads = new WeakMap<SupabaseClient, Promise<WorkspaceProjectGroup[]>>();

export async function ensureDefaultWorkspaceMembership(
  client?: ReturnType<typeof plannerClient>,
): Promise<WorkspaceProjectGroup[]> {
  const supabase = client ?? plannerClient();
  const inflight = inflightMembershipLoads.get(supabase);
  if (inflight) {
    return inflight;
  }

  const load = (async () => {
    const { data: userData } = await getUserFromSession(supabase);

    if (!userData.user) {
      throw new Error("Sign in before loading organizations.");
    }

    const user = userData.user;
    let bootstrappedUserIds = bootstrappedMembershipUserIdsByClient.get(supabase);
    if (!bootstrappedUserIds) {
      bootstrappedUserIds = new Set<string>();
      bootstrappedMembershipUserIdsByClient.set(supabase, bootstrappedUserIds);
    }
    if (!bootstrappedUserIds.has(user.id)) {
      // The two writes are independent of each other, but grant redemption must land
      // before memberships are read -- it can mint the membership rows a new user's
      // first load depends on -- so both complete before loadWorkspaceProjectGroups.
      const [, redeemResult] = await Promise.all([
        throwIfError(
          supabase.from("profiles").upsert({
            id: user.id,
            full_name: user.user_metadata?.full_name ?? user.email ?? "Pulse User",
            avatar_url: user.user_metadata?.avatar_url ?? null,
          }),
        ),
        supabase.rpc("redeem_workspace_access_grants"),
      ]);

      if (redeemResult.error) {
        if (redeemResult.error.code !== "PGRST202") {
          throw redeemResult.error;
        }
        // Function missing = migrations not applied in this environment. Memberships
        // can't be minted, which looks like "signed in but no projects" — leave a
        // trace instead of failing silently.
        console.warn(
          "redeem_workspace_access_grants is missing — apply database migrations so invites and domain auto-join can mint memberships.",
        );
      }

      bootstrappedUserIds.add(user.id);

      // A redemption may have just minted memberships (invite or domain
      // auto-join) — nudge the notification drain so the welcome email lands in
      // seconds instead of at the next cron. Browser-only no-op elsewhere.
      kickSopNotifications();
    }

    return loadWorkspaceProjectGroups(user.id, supabase);
  })();

  const tracked = load.finally(() => {
    inflightMembershipLoads.delete(supabase);
  });
  inflightMembershipLoads.set(supabase, tracked);

  return tracked;
}

export async function loadWorkspaceProjectGroups(
  knownUserId?: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<WorkspaceProjectGroup[]> {
  const supabase = client ?? plannerClient();
  let userId = knownUserId;

  if (!userId) {
    const { data: userData } = await getUserFromSession(supabase);

    if (!userData.user) {
      throw new Error("Sign in before loading organizations.");
    }

    userId = userData.user.id;
  }

  // The role probe, membership read, and per-project access map only need the user id, so
  // they run together; the extra queries on the (rare) superadmin path are far cheaper
  // than serializing every load behind the probe.
  const [isSuperAdmin, memberships, accessMap] = await Promise.all([
    fetchIsSuperAdmin(supabase),
    throwIfError(
      supabase
        .from("workspace_members")
        .select("workspace_id, role")
        .eq("user_id", userId)
        .order("created_at"),
    ),
    fetchUserProjectAccessMap(supabase, userId),
  ]);

  // Superadmins see every workspace and project (RLS grants full read access), acting as
  // owner with no module restrictions, regardless of membership rows.
  if (isSuperAdmin) {
    const [workspaces, projects] = await Promise.all([
      throwIfError(supabase.from("workspaces").select(WORKSPACE_COLUMNS).order("created_at")),
      throwIfError(supabase.from("projects").select(PROJECT_COLUMNS).order("created_at")),
    ]);

    const projectsByWorkspaceId = new Map<string, Project[]>();
    (projects ?? []).forEach((project) => {
      const mappedProject = mapProject(project);
      projectsByWorkspaceId.set(mappedProject.workspaceId, [
        ...(projectsByWorkspaceId.get(mappedProject.workspaceId) ?? []),
        mappedProject,
      ]);
    });

    return (workspaces ?? []).map((workspace) => {
      const mappedWorkspace = mapWorkspace(workspace);
      return {
        workspace: mappedWorkspace,
        role: "owner" as WorkspaceRole,
        isSuperAdmin: true,
        projects: projectsByWorkspaceId.get(mappedWorkspace.id) ?? [],
      };
    });
  }

  const workspaceIds = [...new Set((memberships ?? []).map((membership) => String(membership.workspace_id)))];

  if (!workspaceIds.length) {
    return [];
  }

  const [workspaces, projects] = await Promise.all([
    throwIfError(supabase.from("workspaces").select(WORKSPACE_COLUMNS).in("id", workspaceIds).order("created_at")),
    throwIfError(supabase.from("projects").select(PROJECT_COLUMNS).in("workspace_id", workspaceIds).order("created_at")),
  ]);

  const membershipByWorkspaceId = new Map(
    (memberships ?? []).map((membership) => [String(membership.workspace_id), membership]),
  );
  const projectsByWorkspaceId = new Map<string, Project[]>();

  (projects ?? []).forEach((project) => {
    const mappedProject = mapProject(project);
    projectsByWorkspaceId.set(mappedProject.workspaceId, [
      ...(projectsByWorkspaceId.get(mappedProject.workspaceId) ?? []),
      mappedProject,
    ]);
  });

  // accessMap (fetched above): the user's per-project access. Managers (owner/admin) see
  // every project in workspaces they manage; other members see only projects they've been
  // granted view/edit on. undefined map = pre-migration: don't filter (legacy behavior).
  return (workspaces ?? []).map((workspace) => {
    const mappedWorkspace = mapWorkspace(workspace);
    const membership = membershipByWorkspaceId.get(mappedWorkspace.id);
    const role = membership?.role ? (String(membership.role) as WorkspaceRole) : "viewer";
    const isManager = role === "owner" || role === "admin";
    const allProjects = projectsByWorkspaceId.get(mappedWorkspace.id) ?? [];

    let visibleProjects: Project[];
    if (isManager || !accessMap) {
      visibleProjects = allProjects.map((project) => ({
        ...project,
        accessLevel: isManager ? "edit" : project.accessLevel,
      }));
    } else {
      visibleProjects = allProjects
        .map((project) => ({ ...project, accessLevel: accessMap.get(project.id) ?? "none" }))
        .filter((project) => project.accessLevel !== "none");
    }

    return {
      workspace: mappedWorkspace,
      role,
      isSuperAdmin: false,
      projects: visibleProjects,
    };
  });
}

export async function createProjectWithStarterPlan(
  workspaceId: string,
  name: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<PlannerProjectContext> {
  const supabase = client ?? plannerClient();
  const projectName = name.trim();
  const projectId = await throwIfError(
    supabase.rpc("create_project_with_starter_plan", {
      p_workspace_id: workspaceId,
      p_name: projectName,
    }),
  );

  if (typeof projectId !== "string" || !projectId) {
    throw new Error("Project creation did not return a project id.");
  }

  return loadProjectContext(supabase, projectId);
}

export async function updateWorkspaceInSupabase(workspaceId: string, patch: { name?: string }) {
  const name = patch.name?.trim();
  if (!name) {
    throw new Error("Organization name is required.");
  }

  const supabase = plannerClient();
  await throwIfError(supabase.from("workspaces").update({ name }).eq("id", workspaceId));
}

/**
 * Resolve display names for a set of user ids via the profiles table. Managers can read
 * fellow profiles (the "profiles workspace manager read" policy), so this powers the
 * "Created by …" label on each workspace. Returns userId -> full name (absent if unknown).
 */
export async function loadProfileNamesByIds(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) {
    return new Map();
  }

  const supabase = plannerClient();
  const rows = await throwIfError(supabase.from("profiles").select("id,full_name").in("id", ids));

  const names = new Map<string, string>();
  (rows ?? []).forEach((row) => {
    const name = maybeText(row.full_name);
    if (name) {
      names.set(String(row.id), name);
    }
  });
  return names;
}

export async function updateProjectInSupabase(
  projectId: string,
  patch: {
    name?: string;
    description?: string | null;
    status?: Project["status"];
  },
) {
  const row: TablesUpdate<"projects"> = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) {
      throw new Error("Workspace name is required.");
    }
    row.name = name;
  }

  if (patch.description !== undefined) {
    row.description = patch.description?.trim() ? patch.description.trim() : null;
  }

  if (patch.status !== undefined) {
    row.status = patch.status;
  }

  if (!Object.keys(row).length) {
    return;
  }

  const supabase = plannerClient();
  await throwIfError(supabase.from("projects").update(row).eq("id", projectId));
}

export async function deleteProjectFromSupabase(projectId: string) {
  const supabase = plannerClient();

  await throwIfError(supabase.from("products").delete().eq("project_id", projectId));
  await throwIfError(supabase.from("projects").delete().eq("id", projectId));
}

export async function loadWorkspaceMembersFromSupabase(
  workspaceId: string,
  client?: SupabaseClient<Database>,
): Promise<WorkspaceMemberProfile[]> {
  const supabase = client ?? plannerClient();
  // Fetch members and profiles separately and merge in JS. There is no direct foreign key
  // between workspace_members and profiles (both only reference auth.users), so a PostgREST
  // embed (`profiles(...)`) fails with PGRST200. Profile names for fellow members are
  // visible thanks to the "profiles workspace manager read" policy.
  const rows = await throwIfError(
    supabase
      .from("workspace_members")
      .select("workspace_id,user_id,role,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
  );
  const members = rows ?? [];

  const userIds = [...new Set(members.map((row) => String(row.user_id)))];
  const profileRows = userIds.length
    ? await throwIfError(supabase.from("profiles").select("id,full_name,avatar_url,email").in("id", userIds))
    : [];
  const profileById = new Map((profileRows ?? []).map((profile) => [String(profile.id), profile]));

  return members.map((row) => {
    const profile = profileById.get(String(row.user_id));
    return {
      workspaceId: String(row.workspace_id),
      userId: String(row.user_id),
      role: String(row.role) as WorkspaceRole,
      createdAt: String(row.created_at),
      fullName: maybeText(profile?.full_name),
      avatarUrl: maybeText(profile?.avatar_url),
      email: maybeText(profile?.email),
    };
  });
}

export async function loadWorkspaceAccessGrantsFromSupabase(workspaceId: string): Promise<WorkspaceAccessGrant[]> {
  const supabase = plannerClient();
  const rows = await throwIfError(
    supabase
      .from("workspace_access_grants")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
  );

  return (rows ?? []).map(mapWorkspaceAccessGrant);
}

// How long an invite stays redeemable. Mirrors the column default in the
// 20260703120000 migration; re-inviting ("resend") refreshes the window.
const GRANT_EXPIRY_DAYS = 30;

export async function upsertWorkspaceAccessGrantInSupabase(
  workspaceId: string,
  email: string,
  entitlements: WorkspaceInviteEntitlements,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!isAllowedSignupEmail(normalizedEmail)) {
    throw new Error(SIGNUP_DOMAIN_MESSAGE);
  }
  const normalizedEntitlements = normalizedInviteEntitlements(entitlements);

  const supabase = plannerClient();
  const { data: userData } = await getUserFromSession(supabase);

  // Re-inviting someone a manager previously removed lifts the revocation, so the
  // grant can mint a membership again on their next sign-in.
  const { error: revocationError } = await supabase
    .from("workspace_revocations")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("email", normalizedEmail);
  if (revocationError && !isMissingRelationError(revocationError)) {
    throw revocationError;
  }

  await throwIfError(
    supabase.from("workspace_access_grants").upsert(
      {
        workspace_id: workspaceId,
        email: normalizedEmail,
        role: workspaceRoleForOrganizationRole(normalizedEntitlements.organizationRole),
        quality_access: normalizedEntitlements.qualityAccess,
        access_package: normalizedEntitlements.accessPackage,
        planning_access: normalizedEntitlements.planningAccess,
        project_access: normalizedEntitlements.projectAccess.map((grant) => ({
          project_id: grant.projectId,
          level: grant.level,
        })) as Json,
        department_access: normalizedEntitlements.departmentAccess.map((grant) => ({
          department_id: grant.departmentId,
          role: grant.role,
          position_title: grant.positionTitle,
        })) as Json,
        granted_by: userData.user?.id ?? null,
        expires_at: new Date(Date.now() + GRANT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        redeemed_by: null,
        redeemed_at: null,
      },
      { onConflict: "workspace_id,email" },
    ),
  );
}

// Offboard a member: the RPC deletes the membership + per-project access + pending
// invites and records a revocation so domain auto-join cannot silently re-add them.
export async function removeWorkspaceMemberInSupabase(workspaceId: string, userId: string): Promise<void> {
  const supabase = plannerClient();
  const { error } = await supabase.rpc("remove_workspace_member", {
    target_workspace_id: workspaceId,
    target_user_id: userId,
  });
  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error("Member removal requires the latest database migration. Apply migrations and retry.");
    }
    throw error;
  }
}

export async function updateWorkspaceMemberRoleInSupabase(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  const supabase = plannerClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) {
    throw error;
  }
  // RLS silently filters rows the caller may not update (e.g. an admin touching an
  // owner row) — surface that instead of pretending the change landed.
  if (!data?.length) {
    throw new Error("You don't have permission to change this member's role.");
  }
}

export async function updateOwnProfileNameInSupabase(fullName: string): Promise<void> {
  const supabase = plannerClient();
  const { data: userData } = await getUserFromSession(supabase);
  if (!userData.user) {
    throw new Error("Sign in first.");
  }

  const name = normalizeDisplayName(fullName);
  const validationError = displayNameValidationMessage(name);
  if (validationError) {
    throw new Error(validationError);
  }

  const profile = await throwIfError(
    supabase
      .from("profiles")
      .upsert({ id: userData.user.id, full_name: name }, { onConflict: "id" })
      .select("id")
      .maybeSingle(),
  );
  if (!profile) {
    throw new Error("Unable to update the display name.");
  }

  // Keep auth metadata in sync so the next profile bootstrap doesn't revert the name.
  const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
  if (error) {
    throw error;
  }
}

export async function deleteWorkspaceAccessGrantFromSupabase(workspaceId: string, email: string): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(
    supabase
      .from("workspace_access_grants")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("email", email.trim().toLowerCase()),
  );
}

// Per-member access matrix for a workspace: each member's role plus their per-project level
// and Quality Module level. Readable by workspace managers and superadmins.
export async function loadMembersAccessForWorkspace(
  workspaceId: string,
  client?: SupabaseClient<Database>,
): Promise<MemberAccess[]> {
  const supabase = client ?? plannerClient();
  const { data: userData } = await getUserFromSession(supabase);
  const selfId = userData.user?.id;

  // Members and the workspace's project list are independent — fetch them together.
  const [members, projectRows] = await Promise.all([
    loadWorkspaceMembersFromSupabase(workspaceId, supabase),
    throwIfError(supabase.from("projects").select("id").eq("workspace_id", workspaceId).order("created_at")),
  ]);
  const projectIds = (projectRows ?? []).map((row) => String(row.id));
  const userIds = members.map((member) => member.userId);

  // Project and Quality grants are independent, but both are scoped to this organization.
  const [accessRows, orgRows] = await Promise.all([
    projectIds.length
      ? throwIfError(supabase.from("project_access").select("project_id, user_id, level").in("project_id", projectIds))
      : Promise.resolve([]),
    userIds.length
      ? throwIfError(
          supabase
            .from("org_tool_access")
            .select("user_id, level")
            .eq("workspace_id", workspaceId)
            .in("user_id", userIds),
        )
      : Promise.resolve([]),
  ]);

  const levelByUserProject = new Map<string, AccessLevel>();
  (accessRows ?? []).forEach((row) => {
    levelByUserProject.set(`${row.user_id}|${row.project_id}`, normalizeAccessLevel(row.level));
  });
  const orgByUser = new Map<string, AccessLevel>();
  (orgRows ?? []).forEach((row) => {
    orgByUser.set(String(row.user_id), normalizeAccessLevel(row.level));
  });

  return members.map((member) => {
    const projectLevels: Record<string, AccessLevel> = {};
    projectIds.forEach((projectId) => {
      projectLevels[projectId] = levelByUserProject.get(`${member.userId}|${projectId}`) ?? "none";
    });
    return {
      userId: member.userId,
      fullName: member.fullName,
      email: member.email,
      role: member.role,
      isSelf: member.userId === selfId,
      joinedAt: member.createdAt,
      projectLevels,
      orgTools: orgByUser.get(member.userId) ?? "none",
    };
  });
}

// One row from the audit_log table (written by DB triggers on the access tables).
export interface AuditLogEntry {
  id: number;
  workspaceId?: string;
  actorId?: string;
  actorEmail?: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: { old?: Record<string, unknown>; new?: Record<string, unknown> };
  createdAt: string;
}

/**
 * Workspace activity, newest first. Managers/superadmins see rows via the
 * "audit_log manager read" policy; other callers just get zero rows back.
 * Organization-scoped entries plus global platform-admin entries are included.
 */
export async function loadAuditLogFromSupabase(
  workspaceId: string,
  options: { beforeId?: number; limit?: number } = {},
): Promise<AuditLogEntry[]> {
  const supabase = plannerClient();
  let query = supabase
    .from("audit_log")
    .select("*")
    .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
    .order("id", { ascending: false })
    .limit(options.limit ?? 30);
  if (options.beforeId !== undefined) {
    query = query.lt("id", options.beforeId);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: Number(row.id),
    workspaceId: maybeText(row.workspace_id),
    actorId: maybeText(row.actor_id),
    actorEmail: maybeText(row.actor_email),
    action: String(row.action ?? ""),
    targetType: String(row.target_type ?? ""),
    targetId: maybeText(row.target_id),
    details: row.details && typeof row.details === "object" ? (row.details as AuditLogEntry["details"]) : undefined,
    createdAt: String(row.created_at),
  }));
}

export async function setProjectAccessInSupabase(
  projectId: string,
  userId: string,
  level: AccessLevel,
): Promise<void> {
  const supabase = plannerClient();
  const { data: userData } = await getUserFromSession(supabase);
  await throwIfError(
    supabase.from("project_access").upsert(
      { project_id: projectId, user_id: userId, level, granted_by: userData.user?.id ?? null },
      { onConflict: "project_id,user_id" },
    ),
  );
}

export async function setOrgToolAccessInSupabase(
  workspaceId: string,
  userId: string,
  level: AccessLevel,
): Promise<void> {
  const supabase = plannerClient();
  const { data: userData } = await getUserFromSession(supabase);
  await throwIfError(
    supabase.from("org_tool_access").upsert(
      { workspace_id: workspaceId, user_id: userId, level, granted_by: userData.user?.id ?? null },
      { onConflict: "workspace_id,user_id" },
    ),
  );
}

export async function loadPlannerStateWithProjectFromSupabase(
  projectId?: string,
  scenarioId?: string,
  client?: ReturnType<typeof plannerClient>,
  options: { includeTaskMedia?: boolean } = {},
): Promise<{
  state: PlannerState;
  project: PlannerProjectContext;
} | null> {
  const supabase = client ?? plannerClient();
  const includeTaskMedia = options.includeTaskMedia !== false;
  let project: PlannerProjectContext | undefined;
  const product = projectId
    ? await throwIfError(
        supabase
          .from("products")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      )
    : await throwIfError(
        supabase.from("products").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle(),
      );

  if (!product) {
    return null;
  }

  if (projectId || product.project_id) {
    project = await loadProjectContext(supabase, String(projectId ?? product.project_id));
  }

  // When a scenarioId is given, load that specific scenario (scoped to this product so a caller can
  // never pull another product's scenario). Otherwise fall back to the earliest = "Main" scenario,
  // which preserves the original single-scenario behavior.
  const scenario = await throwIfError(
    scenarioId
      ? supabase
          .from("scenarios")
          .select("*")
          .eq("product_id", product.id)
          .eq("id", scenarioId)
          .maybeSingle()
      : supabase
          .from("scenarios")
          .select("*")
          .eq("product_id", product.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
  );

  if (!scenario) {
    return null;
  }

  const documentTypeFilter = documentTypeScopeFilter({ id: String(product.id), projectId: maybeText(product.project_id) });
  const [stations, zones, components, documentTypes, taskRows, customColumns] = await Promise.all([
    throwIfError(supabase.from("stations").select("*").eq("scenario_id", scenario.id).order("sequence")),
    throwIfError(supabase.from("zones").select("*").eq("scenario_id", scenario.id).order("sequence")),
    throwIfError(supabase.from("manufacturing_components").select("*").eq("scenario_id", scenario.id).order("sequence")),
    throwIfError(
      supabase
        .from("document_type_codes")
        .select("*")
        .or(documentTypeFilter)
        .order("created_at"),
    ),
    throwIfError(supabase.from("tasks").select("*").eq("scenario_id", scenario.id).order("wbs")),
    throwIfError(
      supabase
        .from("custom_columns")
        .select("*")
        .or(customColumnScopeFilter(String(product.id), String(scenario.id)))
        .order("created_at"),
    ),
  ]);

  const taskIds = (taskRows ?? []).map((task) => String(task.id));
  const [dependencies, manufacturingSteps, partReferences, actualEvents, stepPhotos, stepTools, explodedViews, taskVideos] = taskIds.length
    ? await Promise.all([
        throwIfError(supabase.from("task_dependencies").select("*").in("successor_task_id", taskIds)),
        throwIfError(supabase.from("manufacturing_steps").select("*").in("task_id", taskIds).order("sequence")),
        throwIfError(supabase.from("part_references").select("*").in("task_id", taskIds).order("created_at")),
        throwIfError(supabase.from("actual_events").select("*").in("task_id", taskIds).order("timestamp")),
        includeTaskMedia
          ? throwIfError(supabase.from("step_photos").select("*").in("task_id", taskIds).is("deleted_at", null).order("captured_at"))
          : Promise.resolve([]),
        throwIfError(supabase.from("step_tools").select("*").in("task_id", taskIds).order("sequence")),
        includeTaskMedia
          ? throwIfError(supabase.from("step_exploded_views").select("*").in("task_id", taskIds).is("deleted_at", null).order("captured_at"))
          : Promise.resolve([]),
        includeTaskMedia
          ? throwIfError(supabase.from("task_videos").select("*").in("task_id", taskIds).is("deleted_at", null).order("captured_at"))
          : Promise.resolve([]),
      ])
    : [[], [], [], [], [], [], [], []];
  // Private procedure media is the expensive part of a Product load: three more
  // relational reads followed by storage URL signing. The initial editable-core
  // confirmation deliberately skips it; loadTaskFromSupabase hydrates only the
  // selected task when Procedure is opened. Full callers keep the legacy behavior
  // and all eight task-child queries remain parallel.
  const scenarioTaskIds = new Set(taskIds);
  const dependencyIdsByTaskId = new Map<string, string[]>();
  const stepsByTaskId = new Map<string, ManufacturingStep[]>();
  const partsByTaskId = new Map<string, PartReference[]>();
  const [signedStepPhotos, signedExplodedViews, signedTaskVideos] = await Promise.all([
    withSignedStepPhotoRows(supabase, (stepPhotos ?? []) as StepPhotoRow[]),
    withSignedExplodedViewRows(supabase, (explodedViews ?? []) as StepExplodedViewRow[]),
    withSignedTaskVideoRows(supabase, (taskVideos ?? []) as TaskVideoRow[]),
  ]);
  const photosByTaskId = indexStepPhotos(signedStepPhotos);
  const toolsByTaskId = indexStepTools((stepTools ?? []) as StepToolRow[]);
  const explodedViewsByTaskId = indexExplodedViews(signedExplodedViews);
  const videosByTaskId = indexTaskVideos(signedTaskVideos);

  (dependencies ?? []).forEach((dependency) => {
    const successorTaskId = String(dependency.successor_task_id);
    const currentDependencies = dependencyIdsByTaskId.get(successorTaskId) ?? [];
    currentDependencies.push(String(dependency.predecessor_task_id));
    dependencyIdsByTaskId.set(successorTaskId, currentDependencies);
  });

  (manufacturingSteps ?? []).forEach((step) => {
    const taskId = String(step.task_id);
    const currentSteps = stepsByTaskId.get(taskId) ?? [];
    currentSteps.push(mapManufacturingStepRecord(step));
    stepsByTaskId.set(taskId, normalizeManufacturingStepSequences(currentSteps));
  });

  (partReferences ?? []).forEach((part) => {
    const taskId = String(part.task_id);
    const currentParts = partsByTaskId.get(taskId) ?? [];
    currentParts.push(mapPartReferenceRecord(part));
    partsByTaskId.set(taskId, currentParts);
  });

  const mappedProduct = mapProduct(product);
  const projectContext = project ?? (mappedProduct.projectId ? await loadProjectContext(supabase, mappedProduct.projectId) : undefined);

  if (!projectContext) {
    throw new Error("This product is not assigned to a workspace yet.");
  }

  const state: PlannerState = {
    project: projectContext,
    product: mappedProduct,
    scenario: mapScenario(scenario),
    stations: (stations ?? []).map(mapStation),
    zones: (zones ?? []).map(mapZone),
    components: (components ?? []).map(mapManufacturingComponent),
    documentTypes: (documentTypes ?? []).map(mapDocumentTypeCode),
    tasks: (taskRows ?? []).map((task) => {
      const mappedTask = mapTask({
        ...task,
        // Old rows can still contain denormalized media in custom_fields. Do
        // not let those bypass the lazy-media boundary in a core-only load.
        custom_fields: includeTaskMedia ? task.custom_fields : customFieldsRow(jsonObject(task.custom_fields)),
        dependency_ids: dependencyIdsByTaskId.get(String(task.id)) ?? [],
        manufacturing_steps: stepsByTaskId.get(String(task.id)) ?? [],
        part_references: partsByTaskId.get(String(task.id)) ?? [],
      });

      return withNormalizedStepAssets(mappedTask, photosByTaskId, toolsByTaskId, explodedViewsByTaskId, videosByTaskId);
    }),
    dependencies: (dependencies ?? [])
      .filter(
        (dependency) =>
          scenarioTaskIds.has(String(dependency.predecessor_task_id)) ||
          scenarioTaskIds.has(String(dependency.successor_task_id)),
      )
      .map(mapDependency),
    actualEvents: (actualEvents ?? []).filter((event) => scenarioTaskIds.has(String(event.task_id))).map(mapActualEvent),
    customColumns: (customColumns ?? []).map(mapCustomColumn),
  };

  return { state, project: projectContext };
}

type PlannerSummaryRows = {
  product: Record<string, unknown>;
  scenario: Record<string, unknown>;
  stations: Record<string, unknown>[];
  zones: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
};

const PRODUCT_SUMMARY_COLUMNS =
  "id,project_id,product_code,name,sku,family,revision,description,owner_id,owner_name,status,target_man_hours,demand_quantity,demand_period,gross_available_minutes,break_minutes,lunch_minutes,meeting_minutes,planned_downtime_minutes,work_days_per_week,work_weeks_per_month,available_work_days_per_month,net_available_minutes,weekly_available_minutes,monthly_available_minutes,calculated_takt_minutes,manual_takt_minutes,active_takt_minutes,created_at,updated_at";

/**
 * Build the deliberately narrow Product-dashboard snapshot.
 *
 * This is not a complete editable PlannerState: task children, dependencies,
 * nomenclature, custom columns and media stay absent until the client's
 * editable-core load confirms them. Keeping this transformation explicit prevents a
 * future relational select from accidentally putting procedures or media back
 * into the route's initial RSC payload.
 */
export function buildPlannerSummaryState({
  product,
  scenario,
  stations,
  zones,
  tasks,
}: PlannerSummaryRows): PlannerState {
  return {
    project: undefined,
    // Product custom fields currently hold the master BOM and procedure check
    // definitions. Neither is used by the dashboard, so keep that potentially
    // large editable payload in the complete background load as well.
    product: mapProduct({ ...product, custom_fields: {} }),
    scenario: mapScenario(scenario),
    stations: stations.map(mapStation),
    zones: zones.map(mapZone),
    components: [],
    documentTypes: [],
    tasks: tasks.map((task) =>
      mapTask({
        ...task,
        custom_fields: customFieldsRow(jsonObject(task.custom_fields)),
        dependency_ids: [],
        manufacturing_steps: [],
        part_references: [],
      }),
    ),
    dependencies: [],
    actualEvents: [],
    customColumns: [],
  };
}

/**
 * Product-dashboard first paint. Unlike loadPlannerStateFromSupabase, this
 * intentionally stops at the task rows and never reads task children or signs
 * media URLs. It is safe to display immediately, but callers must keep writes
 * disabled until the editable-core load has confirmed the graph.
 */
export async function loadPlannerSummaryStateFromSupabase(
  projectId: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<PlannerState | null> {
  const supabase = client ?? plannerClient();
  const product = await throwIfError(
    supabase
      .from("products")
      .select(PRODUCT_SUMMARY_COLUMNS)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  );

  if (!product) {
    return null;
  }

  const scenario = await throwIfError(
    supabase
      .from("scenarios")
      .select("*")
      .eq("product_id", product.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  );

  if (!scenario) {
    return null;
  }

  const [stations, zones, tasks] = await Promise.all([
    throwIfError(supabase.from("stations").select("*").eq("scenario_id", scenario.id).order("sequence")),
    throwIfError(supabase.from("zones").select("*").eq("scenario_id", scenario.id).order("sequence")),
    throwIfError(supabase.from("tasks").select("*").eq("scenario_id", scenario.id).order("wbs")),
  ]);

  return buildPlannerSummaryState({
    product,
    scenario,
    stations: (stations ?? []) as Record<string, unknown>[],
    zones: (zones ?? []) as Record<string, unknown>[],
    tasks: (tasks ?? []) as Record<string, unknown>[],
  });
}

export async function loadPlannerStateFromSupabase(
  projectId?: string,
  scenarioId?: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<PlannerState | null> {
  const loaded = await loadPlannerStateWithProjectFromSupabase(projectId, scenarioId, client);
  return loaded?.state ?? null;
}

/**
 * Editable Product planner graph without private procedure media.
 *
 * This confirms the shell, planning rows, steps, parts and tools so autosave is
 * safe without paying to fetch and sign every task's photos, exploded views and
 * videos. Procedure hydrates those assets one selected task at a time.
 */
export async function loadPlannerCoreStateFromSupabase(
  projectId?: string,
  scenarioId?: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<PlannerState | null> {
  const loaded = await loadPlannerStateWithProjectFromSupabase(projectId, scenarioId, client, {
    includeTaskMedia: false,
  });
  return loaded?.state ?? null;
}

// Lightweight list of a product's scenarios for the switcher tabs (earliest first = "Main").
export async function loadScenariosForProduct(productId: string): Promise<ScenarioSummary[]> {
  const supabase = plannerClient();
  const rows = await throwIfError(
    supabase
      .from("scenarios")
      .select("id,name,target_output,target_output_period,notes,created_at")
      .eq("product_id", productId)
      .order("created_at", { ascending: true }),
  );
  return ((rows ?? []) as Record<string, unknown>[]).map(mapScenarioSummary);
}

export type SopSummary = {
  id: string;
  sopNumber?: string;
  title?: string;
  status?: string;
};

// Lightweight list of SOPs for the task SOP picker. The sops table is read-gated by org-tools
// access, so a planner user without that access simply gets zero rows back -- callers treat an
// empty list as "hide the picker" rather than an error. Real errors also degrade to [] (with a
// console.warn) so a broken SOP lookup can never break the planner.
export async function listSopSummariesFromSupabase(): Promise<SopSummary[]> {
  try {
    const supabase = plannerClient();
    const { data, error } = await supabase
      .from("sops")
      .select("id,sop_number,title,status")
      .is("deleted_at", null)
      .order("sop_number", { ascending: true, nullsFirst: false })
      .order("title", { ascending: true });

    if (error) {
      if (!isMissingRelationError(error)) {
        console.warn(`Failed to load SOP summaries for the task picker: ${error.message}`);
      }
      return [];
    }

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      sopNumber: maybeText(row.sop_number),
      title: maybeText(row.title),
      status: maybeText(row.status),
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to load SOP summaries for the task picker: ${detail}`);
    return [];
  }
}

// Deep-copy a scenario into a new independent "projection" scenario (high-level Gantt only -- stations,
// zones, components, tasks with planned time + manpower, dependencies; no procedures/tools/photos/parts)
// via the duplicate_scenario RPC. Returns the new scenario id.
export async function duplicateScenario(sourceScenarioId: string, newName: string): Promise<string> {
  const supabase = plannerClient();
  const newId = await throwIfError(
    supabase.rpc("duplicate_scenario", {
      p_source_scenario_id: sourceScenarioId,
      p_new_name: newName,
    }),
  );
  return String(newId);
}

// Update a scenario's projection target (units + period). This drives the active-scenario takt for
// non-main scenarios (see calculateActiveTaktMinutes).
export async function updateScenarioTarget(
  scenarioId: string,
  targetOutput: number,
  targetOutputPeriod: string,
): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(
    supabase
      .from("scenarios")
      .update({ target_output: targetOutput, target_output_period: targetOutputPeriod })
      .eq("id", scenarioId),
  );
}

// Rename a scenario (used for projection tabs; the UI prevents renaming Main).
export async function renameScenario(scenarioId: string, name: string): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(supabase.from("scenarios").update({ name }).eq("id", scenarioId));
}

// Delete a scenario via the guarded RPC (refuses the Main/earliest scenario and the only scenario).
// Children cascade. The UI also hides delete for Main; this is the DB-level half of that guard.
export async function deleteScenario(scenarioId: string): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(supabase.rpc("delete_scenario", { p_scenario_id: scenarioId }));
}

/**
 * Data-loss tripwire (refactor plan §5). A full-state save hard-deletes every row
 * absent from in-memory state across six tables, and the one credible data-loss
 * chain is a TRUNCATED load: a partial read renders, the user edits, and the save
 * would silently delete everything the read missed — no error anywhere, RLS
 * permits all of it. This guard refuses any save that would delete more than half
 * of an entity's existing rows (once there are enough rows for the fraction to
 * mean anything). Genuine bulk deletions still work in smaller batches.
 *
 * Known limit: it guards row DELETION per entity, not per-task child replacement —
 * a truncated steps array inside a surviving task is not detectable here.
 */
export function assertSaneStateDeletion(entity: string, existingCount: number, staleCount: number): void {
  const MIN_ROWS_FOR_TRIPWIRE = 5;
  const MAX_DELETE_FRACTION = 0.5;
  if (existingCount >= MIN_ROWS_FOR_TRIPWIRE && staleCount > existingCount * MAX_DELETE_FRACTION) {
    throw new Error(
      `Refusing to save: this would delete ${staleCount} of ${existingCount} ${entity}. ` +
        "A truncated planner load looks exactly like mass deletion, so large removals are blocked as a " +
        "safety measure. If the deletion is intentional, remove items in smaller batches.",
    );
  }
}

export async function savePlannerStateToSupabase(state: PlannerState) {
  if (state.tasks.length === 0) {
    throw new Error("Refusing to save an empty Gantt. Add at least one task before saving.");
  }

  if (!state.product.projectId) {
    throw new Error("Select a workspace before saving planner data.");
  }

  const supabase = plannerClient();
  const [existingTasks, existingStations, existingZones, existingComponents, existingDocumentTypes, existingCustomColumns] = await Promise.all([
    throwIfError(supabase.from("tasks").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("stations").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("zones").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("manufacturing_components").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(
      supabase
        .from("document_type_codes")
        .select("id")
        .or(documentTypeScopeFilter(state.product)),
    ),
    throwIfError(
      supabase
        .from("custom_columns")
        .select("id")
        .or(customColumnScopeFilter(String(state.product.id), String(state.scenario.id))),
    ),
  ]);

  const nextTaskIds = state.tasks.map((task) => task.id);
  const taskIds = [...new Set([...(existingTasks ?? []).map((task) => String(task.id)), ...nextTaskIds])];
  const staleTaskIds = (existingTasks ?? [])
    .map((task) => String(task.id))
    .filter((taskId) => !nextTaskIds.includes(taskId));
  const nextStationIds = state.stations.map((station) => station.id);
  const staleStationIds = (existingStations ?? [])
    .map((station) => String(station.id))
    .filter((stationId) => !nextStationIds.includes(stationId));
  const nextZoneIds = state.zones.map((zone) => zone.id);
  const staleZoneIds = (existingZones ?? [])
    .map((zone) => String(zone.id))
    .filter((zoneId) => !nextZoneIds.includes(zoneId));
  const nextComponentIds = state.components.map((component) => component.id);
  const staleComponentIds = (existingComponents ?? [])
    .map((component) => String(component.id))
    .filter((componentId) => !nextComponentIds.includes(componentId));
  const nextDocumentTypeIds = state.documentTypes.map((documentType) => documentType.id);
  const staleDocumentTypeIds = (existingDocumentTypes ?? [])
    .map((documentType) => String(documentType.id))
    .filter((documentTypeId) => !nextDocumentTypeIds.includes(documentTypeId));
  const nextCustomColumnIds = state.customColumns.map((column) => column.id);
  const staleCustomColumnIds = (existingCustomColumns ?? [])
    .map((column) => String(column.id))
    .filter((columnId) => !nextCustomColumnIds.includes(columnId));

  // Tripwire BEFORE any write: refuse mass deletion that signals a truncated load.
  assertSaneStateDeletion("tasks", (existingTasks ?? []).length, staleTaskIds.length);
  assertSaneStateDeletion("stations", (existingStations ?? []).length, staleStationIds.length);
  assertSaneStateDeletion("zones", (existingZones ?? []).length, staleZoneIds.length);
  assertSaneStateDeletion("components", (existingComponents ?? []).length, staleComponentIds.length);
  assertSaneStateDeletion("document types", (existingDocumentTypes ?? []).length, staleDocumentTypeIds.length);
  assertSaneStateDeletion("custom columns", (existingCustomColumns ?? []).length, staleCustomColumnIds.length);

  await throwIfError(supabase.from("products").upsert(productRow(state.product)));
  await throwIfError(supabase.from("scenarios").upsert(scenarioRow(state.scenario)));

  if (state.stations.length) {
    await throwIfError(supabase.from("stations").upsert(state.stations.map(stationRow)));
  }

  if (state.zones.length) {
    await throwIfError(supabase.from("zones").upsert(state.zones.map(zoneRow)));
  }

  if (state.components.length) {
    await throwIfError(supabase.from("manufacturing_components").upsert(state.components.map(manufacturingComponentRow)));
  }

  if (state.documentTypes.length) {
    await throwIfError(supabase.from("document_type_codes").upsert(state.documentTypes.map(documentTypeCodeRow)));
  }

  await throwIfError(supabase.from("tasks").upsert(state.tasks.map(taskRow)));

  // Atomically replace every child row for these tasks in a single server-side transaction.
  // Previously this was 5 deletes followed by 4 inserts as separate requests -- a failure in
  // the gap permanently lost steps/parts/events. The RPC deletes + re-inserts in one
  // transaction, so the children are never missing and the UNIQUE(task_id, sequence) constraint
  // on steps is never transiently violated.
  await throwIfError(
    supabase.rpc("replace_task_children", {
      p_task_ids: taskIds,
      p_dependencies: state.dependencies.map(dependencyRow),
      p_steps: manufacturingStepRows(state.tasks),
      p_parts: partReferenceRows(state.tasks),
      p_actual_events: state.actualEvents.map(actualEventRow),
    }),
  );

  if (state.customColumns.length) {
    await throwIfError(supabase.from("custom_columns").upsert(state.customColumns.map(customColumnRow)));
  }

  if (staleTaskIds.length) {
    await throwIfError(supabase.from("tasks").delete().in("id", staleTaskIds));
  }

  if (staleZoneIds.length) {
    await throwIfError(supabase.from("zones").delete().in("id", staleZoneIds));
  }

  if (staleComponentIds.length) {
    await throwIfError(supabase.from("manufacturing_components").delete().in("id", staleComponentIds));
  }

  if (staleDocumentTypeIds.length) {
    await throwIfError(supabase.from("document_type_codes").delete().in("id", staleDocumentTypeIds));
  }

  if (staleStationIds.length) {
    await throwIfError(supabase.from("stations").delete().in("id", staleStationIds));
  }

  if (staleCustomColumnIds.length) {
    await throwIfError(supabase.from("custom_columns").delete().in("id", staleCustomColumnIds));
  }
}

export async function savePlannerShellToSupabase(state: PlannerState) {
  if (state.tasks.length === 0) {
    throw new Error("Refusing to save an empty Gantt. Add at least one task before saving.");
  }

  if (!state.product.projectId) {
    throw new Error("Select a workspace before saving planner data.");
  }

  const supabase = plannerClient();
  const [existingTasks, existingStations, existingZones, existingComponents, existingDocumentTypes, existingCustomColumns] = await Promise.all([
    throwIfError(supabase.from("tasks").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("stations").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("zones").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(supabase.from("manufacturing_components").select("id").eq("scenario_id", state.scenario.id)),
    throwIfError(
      supabase
        .from("document_type_codes")
        .select("id")
        .or(documentTypeScopeFilter(state.product)),
    ),
    throwIfError(
      supabase
        .from("custom_columns")
        .select("id")
        .or(customColumnScopeFilter(String(state.product.id), String(state.scenario.id))),
    ),
  ]);

  const nextTaskIds = state.tasks.map((task) => task.id);
  const staleTaskIds = (existingTasks ?? [])
    .map((task) => String(task.id))
    .filter((taskId) => !nextTaskIds.includes(taskId));
  const nextStationIds = state.stations.map((station) => station.id);
  const staleStationIds = (existingStations ?? [])
    .map((station) => String(station.id))
    .filter((stationId) => !nextStationIds.includes(stationId));
  const nextZoneIds = state.zones.map((zone) => zone.id);
  const staleZoneIds = (existingZones ?? [])
    .map((zone) => String(zone.id))
    .filter((zoneId) => !nextZoneIds.includes(zoneId));
  const nextComponentIds = state.components.map((component) => component.id);
  const staleComponentIds = (existingComponents ?? [])
    .map((component) => String(component.id))
    .filter((componentId) => !nextComponentIds.includes(componentId));
  const nextDocumentTypeIds = state.documentTypes.map((documentType) => documentType.id);
  const staleDocumentTypeIds = (existingDocumentTypes ?? [])
    .map((documentType) => String(documentType.id))
    .filter((documentTypeId) => !nextDocumentTypeIds.includes(documentTypeId));
  const nextCustomColumnIds = state.customColumns.map((column) => column.id);
  const staleCustomColumnIds = (existingCustomColumns ?? [])
    .map((column) => String(column.id))
    .filter((columnId) => !nextCustomColumnIds.includes(columnId));

  // Tripwire BEFORE any write: refuse mass deletion that signals a truncated load.
  assertSaneStateDeletion("tasks", (existingTasks ?? []).length, staleTaskIds.length);
  assertSaneStateDeletion("stations", (existingStations ?? []).length, staleStationIds.length);
  assertSaneStateDeletion("zones", (existingZones ?? []).length, staleZoneIds.length);
  assertSaneStateDeletion("components", (existingComponents ?? []).length, staleComponentIds.length);
  assertSaneStateDeletion("document types", (existingDocumentTypes ?? []).length, staleDocumentTypeIds.length);
  assertSaneStateDeletion("custom columns", (existingCustomColumns ?? []).length, staleCustomColumnIds.length);

  await throwIfError(supabase.from("products").upsert(productRow(state.product)));
  await throwIfError(supabase.from("scenarios").upsert(scenarioRow(state.scenario)));

  if (state.stations.length) {
    await throwIfError(supabase.from("stations").upsert(state.stations.map(stationRow)));
  }

  if (state.zones.length) {
    await throwIfError(supabase.from("zones").upsert(state.zones.map(zoneRow)));
  }

  if (state.components.length) {
    await throwIfError(supabase.from("manufacturing_components").upsert(state.components.map(manufacturingComponentRow)));
  }

  if (state.documentTypes.length) {
    await throwIfError(supabase.from("document_type_codes").upsert(state.documentTypes.map(documentTypeCodeRow)));
  }

  await throwIfError(supabase.from("tasks").upsert(state.tasks.map(taskRow)));

  const existingDependencies = await throwIfError(
    supabase.from("task_dependencies").select("id").in("successor_task_id", nextTaskIds),
  );
  const nextDependencyIds = state.dependencies.map((dependency) => dependency.id);
  const staleDependencyIds = (existingDependencies ?? [])
    .map((dependency) => String(dependency.id))
    .filter((dependencyId) => !nextDependencyIds.includes(dependencyId));

  if (state.dependencies.length) {
    await throwIfError(supabase.from("task_dependencies").upsert(state.dependencies.map(dependencyRow)));
  }

  if (staleDependencyIds.length) {
    await throwIfError(supabase.from("task_dependencies").delete().in("id", staleDependencyIds));
  }

  if (state.customColumns.length) {
    await throwIfError(supabase.from("custom_columns").upsert(state.customColumns.map(customColumnRow)));
  }

  if (staleTaskIds.length) {
    await throwIfError(supabase.from("tasks").delete().in("id", staleTaskIds));
  }

  if (staleZoneIds.length) {
    await throwIfError(supabase.from("zones").delete().in("id", staleZoneIds));
  }

  if (staleComponentIds.length) {
    await throwIfError(supabase.from("manufacturing_components").delete().in("id", staleComponentIds));
  }

  if (staleDocumentTypeIds.length) {
    await throwIfError(supabase.from("document_type_codes").delete().in("id", staleDocumentTypeIds));
  }

  if (staleStationIds.length) {
    await throwIfError(supabase.from("stations").delete().in("id", staleStationIds));
  }

  if (staleCustomColumnIds.length) {
    await throwIfError(supabase.from("custom_columns").delete().in("id", staleCustomColumnIds));
  }
}

export async function saveTasksToSupabase(tasks: Task[], projectId?: string) {
  if (tasks.length === 0) {
    return;
  }

  const supabase = plannerClient();
  await Promise.all(tasks.map((task) => assertTaskRowInProject(supabase, task, projectId)));
  await throwIfError(supabase.from("tasks").upsert(tasks.map(taskRow)));
  await syncStepToolsForTasks(supabase, tasks);
}

export async function saveTaskRowToSupabase(task: Task, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskRowInProject(supabase, task, projectId);
  await throwIfError(supabase.from("tasks").upsert(taskRow(task)));
}

export async function saveTaskToSupabase(task: Task, projectId?: string) {
  await saveTasksToSupabase([task], projectId);
}

export async function saveTaskCustomFieldsToSupabase(taskId: string, customFields: Task["customFields"], projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  await throwIfError(supabase.from("tasks").update({ custom_fields: customFieldsRow(customFields) }).eq("id", taskId));
}

export async function saveTaskWithManufacturingStepsToSupabase(task: Task, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  await throwIfError(supabase.from("tasks").upsert(taskRow(task)));
  const existingSteps = await throwIfError(supabase.from("manufacturing_steps").select("id").eq("task_id", task.id));
  const nextStepIds = (task.manufacturingSteps ?? []).map((step) => step.id);
  const staleStepIds = (existingSteps ?? [])
    .map((step) => String(step.id))
    .filter((stepId) => !nextStepIds.includes(stepId));

  if (existingSteps?.length) {
    await bumpManufacturingStepSequences(
      supabase,
      existingSteps.map((step) => String(step.id)),
    );
  }

  const steps = manufacturingStepRows([task]);
  if (steps.length) {
    await throwIfError(supabase.from("manufacturing_steps").upsert(steps));
  }

  if (staleStepIds.length) {
    await throwIfError(supabase.from("manufacturing_steps").delete().in("id", staleStepIds));
  }

  await syncStepToolsForTask(supabase, task, { allowEmptyWipe: true });
}

export async function saveTaskAndManufacturingStepToSupabase(task: Task, step: ManufacturingStep, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  await throwIfError(supabase.from("tasks").upsert(taskRow(task)));
  await throwIfError(supabase.from("manufacturing_steps").upsert(manufacturingStepRow(task.id, step)));
}

export async function saveManufacturingStepToSupabase(taskId: string, step: ManufacturingStep, projectId?: string) {
  // Merge the incoming step into the task's current step set and persist via the version-checked,
  // retry-on-conflict procedure path. The previous standalone read-then-upsert had a lost-update
  // window (audit #12): a concurrent write between the read and the upsert was silently
  // overwritten. saveProcedureTaskUpdateToSupabase performs per-step version checks and, on a
  // conflict, reloads the latest server state and re-applies -- so concurrent step edits to the
  // same task serialize instead of clobbering each other.
  const task = await loadTaskFromSupabase(taskId, projectId);
  if (!task) {
    throw new Error("Task not found or you do not have access to it.");
  }

  const existingSteps = task.manufacturingSteps ?? [];
  const mergedSteps = existingSteps.some((candidate) => candidate.id === step.id)
    ? existingSteps.map((candidate) =>
        // Apply the edit but keep the freshly-loaded server version so the optimistic check
        // (and its retry) is anchored to current state, not a stale client value.
        candidate.id === step.id ? { ...candidate, ...step, version: candidate.version } : candidate,
      )
    : [...existingSteps, step];

  await saveProcedureTaskUpdateToSupabase({ ...task, manufacturingSteps: mergedSteps }, [], projectId);
}

type TaskFieldPatch = Partial<
  Pick<
    Task,
    | "name"
    | "description"
    | "plannedStart"
    | "plannedFinish"
    | "plannedDurationMinutes"
    | "plannedOperators"
    | "plannedManHours"
    | "status"
    | "percentComplete"
    | "ownerId"
    | "ownerName"
    | "role"
    | "skillLevel"
    | "criticalPath"
    | "bottleneckFlag"
    | "qualityGate"
    | "travelerSignoffRequired"
    | "safetyNotes"
    | "qcChecklist"
    | "notes"
    | "zoneId"
    | "componentId"
    | "taskNumber"
    | "manufacturingCode"
    | "codeLocked"
    | "codeGeneratedAt"
    | "stationId"
    | "wbs"
  >
>;

function taskFieldPatchRow(patch: TaskFieldPatch) {
  const row: Record<string, unknown> = {};
  // Column names are constrained to the generated schema: a renamed or typo'd
  // column now fails to compile instead of silently no-oping at runtime.
  const setters: [keyof TaskFieldPatch, keyof TablesUpdate<"tasks"> & string][] = [
    ["name", "name"],
    ["description", "description"],
    ["plannedStart", "planned_start"],
    ["plannedFinish", "planned_finish"],
    ["plannedDurationMinutes", "planned_duration_minutes"],
    ["plannedOperators", "planned_operators"],
    ["plannedManHours", "planned_man_hours"],
    ["status", "status"],
    ["percentComplete", "percent_complete"],
    ["ownerId", "owner_id"],
    ["ownerName", "owner_name"],
    ["role", "role"],
    ["skillLevel", "skill_level"],
    ["criticalPath", "critical_path"],
    ["bottleneckFlag", "bottleneck_flag"],
    ["qualityGate", "quality_gate"],
    ["travelerSignoffRequired", "traveler_signoff_required"],
    ["safetyNotes", "safety_notes"],
    ["qcChecklist", "qc_checklist"],
    ["notes", "notes"],
    ["zoneId", "zone_id"],
    ["componentId", "component_id"],
    ["taskNumber", "task_number"],
    ["manufacturingCode", "manufacturing_code"],
    ["codeLocked", "code_locked"],
    ["codeGeneratedAt", "code_generated_at"],
    ["stationId", "station_id"],
    ["wbs", "wbs"],
  ];

  setters.forEach(([key, column]) => {
    if (patch[key] !== undefined) {
      row[column] = patch[key] ?? null;
    }
  });

  // Dynamic build above; the cast is safe because every key came from the
  // schema-constrained setters table.
  return row as TablesUpdate<"tasks">;
}

export async function updateTaskFields(taskId: string, patch: TaskFieldPatch, expectedVersion?: number, projectId?: string) {
  const supabase = plannerClient();
  const row = taskFieldPatchRow(patch);

  if (Object.keys(row).length === 0) {
    return;
  }

  await assertTaskInProject(supabase, taskId, projectId);
  let operation = supabase.from("tasks").update(row).eq("id", taskId);

  if (expectedVersion !== undefined) {
    operation = operation.eq("version", expectedVersion);
  }

  const saved = await throwIfError(operation.select("id,version").maybeSingle());
  if (!saved) {
    throw new Error("Task save conflict. Reload this task before saving again.");
  }
}

export async function upsertProcedureStep(taskId: string, step: ManufacturingStep, expectedVersion?: number, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);

  if (expectedVersion === undefined) {
    await throwIfError(supabase.from("manufacturing_steps").upsert(manufacturingStepRow(taskId, step)));
    return;
  }

  const row = manufacturingStepRow(taskId, step);
  const saved = await throwIfError(
    supabase.from("manufacturing_steps").update(row).eq("id", step.id).eq("version", expectedVersion).select("id,version").maybeSingle(),
  );

  if (!saved) {
    throw new Error("Procedure step save conflict. Reload this task before saving again.");
  }
}

export async function reorderProcedureSteps(taskId: string, orderedStepIds: string[], projectId?: string) {
  if (orderedStepIds.length === 0) {
    return;
  }

  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  // Atomic, single round-trip: the RPC does the two-phase sequence swap server-side inside one
  // transaction, so a partial failure can no longer leave steps with duplicate sequences.
  await throwIfError(
    supabase.rpc("reorder_manufacturing_steps", { p_task_id: taskId, p_step_ids: orderedStepIds }),
  );
}

export async function addStepToolToSupabase(taskId: string, stepId: string, toolName: string, sequence = 1, projectId?: string) {
  const tool = toolName.trim();
  if (!tool) {
    return;
  }

  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  await throwIfError(
    supabase.from("step_tools").upsert({
      id: stepToolId(stepId, tool),
      task_id: taskId,
      step_id: stepId,
      tool_name: tool,
      sequence,
    }),
  );
}

export async function removeStepToolFromSupabase(stepId: string, toolName: string, taskId?: string, projectId?: string) {
  const supabase = plannerClient();
  if (taskId) {
    await assertTaskInProject(supabase, taskId, projectId);
  }
  await throwIfError(supabase.from("step_tools").delete().eq("id", stepToolId(stepId, toolName)));
}

export async function syncStepToolsForStepToSupabase(
  taskId: string,
  stepId: string,
  toolNames: string[],
  projectId?: string,
) {
  const cleanedToolNames = toolNames
    .map((toolName) => toolName.trim())
    .filter(Boolean)
    .filter(
      (tool, index, list) =>
        list.findIndex((candidate) => candidate.toLocaleLowerCase() === tool.toLocaleLowerCase()) === index,
    );
  const nextTools = cleanedToolNames.map((toolName, index) => ({
    id: stepToolId(stepId, toolName),
    task_id: taskId,
    step_id: stepId,
    tool_name: toolName,
    sequence: index + 1,
  }));
  const nextToolIds = nextTools.map((tool) => tool.id);
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  const existingTools = await throwIfError(
    supabase.from("step_tools").select("id").eq("task_id", taskId).eq("step_id", stepId),
  );
  const staleToolIds = (existingTools ?? [])
    .map((tool) => String(tool.id))
    .filter((toolId) => !nextToolIds.includes(toolId));

  if (nextTools.length) {
    await throwIfError(supabase.from("step_tools").upsert(nextTools));
  }

  if (staleToolIds.length) {
    await throwIfError(supabase.from("step_tools").delete().in("id", staleToolIds));
  }
}

// Tools are project-scoped; every tool-library mutation requires a project context.
function requireToolLibraryProjectId(projectId: string | undefined, action: string): string {
  if (!projectId) {
    throw new Error(`Select a workspace before ${action} the library.`);
  }
  return projectId;
}

export async function loadToolLibraryFromSupabase(projectId?: string): Promise<ToolLibraryItem[]> {
  // Tools are project-scoped; with no project context there is no library to load.
  if (!projectId) {
    return [];
  }

  const supabase = plannerClient();
  const rows = await throwIfError(
    supabase.from("tool_library").select("*").eq("project_id", projectId).order("tool_name"),
  );
  const signedRows = await withSignedToolLibraryRows(supabase, (rows ?? []) as ToolLibraryRow[]);
  return signedRows.map(mapToolLibraryRow);
}

export async function uploadToolLibraryImage(
  toolName: string,
  photo: StepPhotoAttachment,
  project?: PlannerProjectContext,
): Promise<ToolLibraryItem> {
  const tool = toolName.trim();
  if (!tool) {
    throw new Error("Add a tool name before uploading an image.");
  }

  if (!project) {
    throw new Error("Select a workspace before adding tools to the library.");
  }

  const supabase = plannerClient();
  const projectId = project.projectId;
  const blob = await dataUrlToBlob(photo.dataUrl);
  const extension = photo.contentType?.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const pathSegments = ["workspaces", project.workspaceId, "projects", project.projectId, "tool-library", `${toolLibraryId(tool, projectId)}.${extension}`];
  const storagePath = pathSegments.map(safeStorageSegment).join("/");

  await throwIfError(
    supabase.storage.from(stepPhotoBucket).upload(storagePath, blob, {
      cacheControl: "31536000",
      contentType: photo.contentType ?? blob.type ?? "image/jpeg",
      upsert: true,
    }),
  );

  const row = {
    id: toolLibraryId(tool, projectId),
    project_id: projectId,
    tool_name: tool,
    image_url: stableStoragePublicUrl(storagePath),
    storage_path: storagePath,
  };

  const saved = await throwIfError(supabase.from("tool_library").upsert(row).select("*").single());
  const [signedSaved] = await withSignedToolLibraryRows(supabase, [saved as ToolLibraryRow]);
  return mapToolLibraryRow(signedSaved);
}

export async function upsertToolLibraryMetadata(input: {
  toolName: string;
  category?: string;
  projectId?: string;
  previousToolName?: string;
}): Promise<ToolLibraryItem> {
  const toolName = input.toolName.trim();
  if (!toolName) {
    throw new Error("Tool name is required.");
  }

  const projectId = requireToolLibraryProjectId(input.projectId, "saving tools to");

  const supabase = plannerClient();
  const previousName = input.previousToolName?.trim();
  let existing: ToolLibraryRow | null = null;

  if (previousName && previousName.toLocaleLowerCase() !== toolName.toLocaleLowerCase()) {
    const oldId = toolLibraryId(previousName, projectId);
    existing = (await throwIfError(
      supabase.from("tool_library").select("*").eq("id", oldId).maybeSingle(),
    )) as ToolLibraryRow | null;

    if (existing) {
      await throwIfError(supabase.from("tool_library").delete().eq("id", oldId));
    }
  } else {
    existing = (await throwIfError(
      supabase.from("tool_library").select("*").eq("id", toolLibraryId(toolName, projectId)).maybeSingle(),
    )) as ToolLibraryRow | null;
  }

  const row = {
    id: toolLibraryId(toolName, projectId),
    project_id: projectId,
    tool_name: toolName,
    category: input.category?.trim() || null,
    image_url: existing?.image_url ?? null,
    storage_path: existing?.storage_path ?? null,
  };

  const saved = await throwIfError(supabase.from("tool_library").upsert(row).select("*").single());
  const [signedSaved] = await withSignedToolLibraryRows(supabase, [saved as ToolLibraryRow]);
  return mapToolLibraryRow(signedSaved);
}

type StorageObjectPathRow = { storage_path?: string | null; thumbnail_storage_path?: string | null };

function storageObjectPaths(rows: StorageObjectPathRow[]): string[] {
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
async function removeStorageObjects(supabase: SupabaseClient, bucket: string, paths: string[]) {
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

export async function deleteToolLibraryFromSupabase(id: string, projectId?: string) {
  const ensuredProjectId = requireToolLibraryProjectId(projectId, "removing tools from");
  const supabase = plannerClient();
  // Read the storage path before the row delete so the object can be cleaned up afterwards.
  const existing = (await throwIfError(
    supabase
      .from("tool_library")
      .select("storage_path")
      .eq("id", id)
      .eq("project_id", ensuredProjectId)
      .maybeSingle(),
  )) as Pick<ToolLibraryRow, "storage_path"> | null;
  await throwIfError(
    supabase.from("tool_library").delete().eq("id", id).eq("project_id", ensuredProjectId),
  );
  if (existing?.storage_path) {
    await removeStorageObjects(supabase, stepPhotoBucket, [existing.storage_path]);
  }
}

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

export async function deletePlannerTask(taskId: string, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  // Snapshot the task's storage object paths BEFORE the row delete: the FK cascade removes the
  // step_photos/step_exploded_views/task_videos rows, after which the paths are unrecoverable and
  // the objects would be orphaned in Storage. Soft-deleted rows are included on purpose -- the
  // cascade removes them too, so their objects would otherwise orphan as well.
  const [photoRows, explodedViewRows, videoRows] = await Promise.all([
    throwIfError(supabase.from("step_photos").select("storage_path,thumbnail_storage_path").eq("task_id", taskId)),
    throwIfError(supabase.from("step_exploded_views").select("storage_path,thumbnail_storage_path").eq("task_id", taskId)),
    throwIfError(supabase.from("task_videos").select("storage_path,thumbnail_storage_path").eq("task_id", taskId)),
  ]);
  // task_dependencies (both endpoints), manufacturing_steps, part_references, actual_events and
  // step_tools all FK to tasks ON DELETE CASCADE, so deleting the task atomically removes them.
  // The previous manual dependency deletes were redundant and opened a split-brain window
  // (edges gone, task still present) if the task delete then failed.
  await throwIfError(supabase.from("tasks").delete().eq("id", taskId));
  // Best-effort storage cleanup once the delete has committed (photos and exploded views share the
  // step-photos bucket; videos live in their own). Failures are logged, not thrown.
  await removeStorageObjects(
    supabase,
    stepPhotoBucket,
    storageObjectPaths([...((photoRows ?? []) as StorageObjectPathRow[]), ...((explodedViewRows ?? []) as StorageObjectPathRow[])]),
  );
  await removeStorageObjects(supabase, taskVideoBucket, storageObjectPaths((videoRows ?? []) as StorageObjectPathRow[]));
}

function mergeTaskWithServerVersions(localTask: Task, serverTask: Task): Task {
  const serverStepById = new Map((serverTask.manufacturingSteps ?? []).map((step) => [step.id, step]));
  const localStepIds = new Set((localTask.manufacturingSteps ?? []).map((step) => step.id));
  const mergedSteps = [
    ...(localTask.manufacturingSteps ?? []).map((step) => {
      const serverStep = serverStepById.get(step.id);
      return serverStep ? { ...serverStep, ...step, version: serverStep.version } : step;
    }),
    ...(serverTask.manufacturingSteps ?? []).filter((step) => !localStepIds.has(step.id)),
  ];

  return {
    ...serverTask,
    ...localTask,
    version: serverTask.version,
    manufacturingSteps: normalizeManufacturingStepSequences(
      mergedSteps.length > 0 ? mergedSteps : (serverTask.manufacturingSteps ?? []),
    ),
  };
}

export async function saveProcedureTaskUpdateToSupabase(
  task: Task,
  _scheduledTasks: Task[],
  projectId?: string,
  allowVersionRetry = true,
) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  const normalizedSteps = normalizeManufacturingStepSequences(task.manufacturingSteps ?? []);
  const taskToSave = { ...task, manufacturingSteps: normalizedSteps };
  const { custom_fields: _customFields, ...taskProcedurePatch } = taskRow(taskToSave);
  let taskUpdate = supabase.from("tasks").update(taskProcedurePatch).eq("id", task.id);

  if (taskToSave.version !== undefined) {
    taskUpdate = taskUpdate.eq("version", taskToSave.version);
  }

  const savedTask = await throwIfError(taskUpdate.select("id,version").maybeSingle());
  if (!savedTask) {
    if (allowVersionRetry && taskToSave.version !== undefined) {
      const latestTask = await loadTaskFromSupabase(taskToSave.id, projectId);
      if (latestTask) {
        return saveProcedureTaskUpdateToSupabase(
          mergeTaskWithServerVersions(taskToSave, latestTask),
          _scheduledTasks,
          projectId,
          false,
        );
      }
    }

    throw new Error("Task save conflict. Reload this task before saving again.");
  }

  const [existingSteps, existingParts] = await Promise.all([
    throwIfError(supabase.from("manufacturing_steps").select("id,sequence,version").eq("task_id", taskToSave.id)),
    throwIfError(supabase.from("part_references").select("id").eq("task_id", taskToSave.id)),
  ]);
  const existingStepById = new Map((existingSteps ?? []).map((step) => [String(step.id), step]));
  const nextStepIds = normalizedSteps.map((step) => step.id);
  const staleStepIds = (existingSteps ?? [])
    .map((step) => String(step.id))
    .filter((stepId) => !nextStepIds.includes(stepId));
  const nextPartIds = (taskToSave.partReferences ?? []).map((part) => part.id);
  const stalePartIds = (existingParts ?? [])
    .map((part) => String(part.id))
    .filter((partId) => !nextPartIds.includes(partId));

  const needsCollisionSafeResequence = manufacturingStepSaveNeedsCollisionSafeResequence(
    normalizedSteps,
    existingSteps ?? [],
  );

  if (staleStepIds.length) {
    await throwIfError(supabase.from("manufacturing_steps").delete().in("id", staleStepIds));
  }

  if (needsCollisionSafeResequence && existingSteps?.length) {
    await bumpManufacturingStepSequences(
      supabase,
      (existingSteps ?? []).map((step) => String(step.id)),
    );
  }

  for (const step of normalizedSteps) {
    const row = manufacturingStepRow(taskToSave.id, step);
    const existingStep = existingStepById.get(step.id);

    if (!existingStep || needsCollisionSafeResequence) {
      await throwIfError(supabase.from("manufacturing_steps").upsert(row));
      continue;
    }

    let stepUpdate = supabase.from("manufacturing_steps").update(row).eq("id", step.id);
    if (step.version !== undefined) {
      stepUpdate = stepUpdate.eq("version", step.version);
    }

    const savedStep = await throwIfError(stepUpdate.select("id,version").maybeSingle());
    if (!savedStep) {
      if (allowVersionRetry && step.version !== undefined) {
        const latestTask = await loadTaskFromSupabase(taskToSave.id, projectId);
        if (latestTask) {
          return saveProcedureTaskUpdateToSupabase(
            mergeTaskWithServerVersions(taskToSave, latestTask),
            _scheduledTasks,
            projectId,
            false,
          );
        }
      }

      throw new Error("Procedure step save conflict. Reload this task before saving again.");
    }
  }

  const parts = partReferenceRows([taskToSave]);
  if (parts.length) {
    await throwIfError(supabase.from("part_references").upsert(parts));
  }

  if (stalePartIds.length) {
    await throwIfError(supabase.from("part_references").delete().in("id", stalePartIds));
  }

  return loadTaskFromSupabase(taskToSave.id, projectId);
}

export async function moveManufacturingStepToTaskInSupabase(
  sourceTask: Task,
  targetTask: Task,
  stepId: string,
  scheduledTasks: Task[],
  projectId?: string,
) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, sourceTask.id, projectId);
  await assertTaskInProject(supabase, targetTask.id, projectId);

  const movedStep = targetTask.manufacturingSteps?.find((step) => step.id === stepId);
  if (!movedStep) {
    throw new Error("Unable to find the manufacturing step to move.");
  }

  const targetExistingSteps =
    (await throwIfError(supabase.from("manufacturing_steps").select("id").eq("task_id", targetTask.id))) ?? [];

  if (targetExistingSteps.length > 0) {
    await bumpManufacturingStepSequences(
      supabase,
      targetExistingSteps.map((step) => String(step.id)),
    );
  }

  await throwIfError(
    supabase
      .from("manufacturing_steps")
      .update({ task_id: targetTask.id, sequence: 200000 })
      .eq("id", stepId),
  );

  await throwIfError(supabase.from("step_tools").update({ task_id: targetTask.id }).eq("step_id", stepId));
  await throwIfError(
    supabase.from("step_photos").update({ task_id: targetTask.id }).eq("step_id", stepId).is("deleted_at", null),
  );
  // Exploded views are task-level (step_id is null), so a step move does not carry them.

  await saveProcedureTaskUpdateToSupabase(sourceTask, scheduledTasks, projectId);
  await saveProcedureTaskUpdateToSupabase(targetTask, scheduledTasks, projectId);
}

export type ProjectTaskTarget = {
  id: string;
  name: string;
  code: string | null;
  scenarioName: string;
  zoneName: string | null;
  zoneCode: string | null;
};

// Lightweight picker feed for the SolidWorks plugin: the tasks of each product's MAIN scenario only
// (exploded views attach at the task level, and we don't want the duplicated "Optimized"/Gantt
// scenarios cluttering the picker with the same task many times). "Main" is the earliest-created
// scenario per product — the same convention the planner uses for its default load. Returns only the
// ids/names the picker needs — no full planner state, photos, or signed URLs. Milestone/inspection
// marker rows are excluded.
//
// Requires a CALLER-SCOPED client (the user's bearer token): products/scenarios/tasks are gated by
// real RLS, so the anon server client would read nothing.
export async function loadProjectTaskTargetsFromSupabase(
  projectId: string,
  supabase: SupabaseClient,
): Promise<ProjectTaskTarget[]> {
  const products = await throwIfError(supabase.from("products").select("id").eq("project_id", projectId));
  const productIds = (products ?? []).map((product) => String(product.id));
  if (!productIds.length) {
    return [];
  }

  // Earliest-created scenario per product is the canonical "Main" plan; ignore the rest.
  const scenarios = await throwIfError(
    supabase.from("scenarios").select("id,name,product_id").in("product_id", productIds).order("created_at", { ascending: true }),
  );
  const mainScenarioIdByProduct = new Map<string, string>();
  const scenarioNameById = new Map<string, string>();
  (scenarios ?? []).forEach((scenario) => {
    const productId = String(scenario.product_id);
    scenarioNameById.set(String(scenario.id), String(scenario.name ?? ""));
    if (!mainScenarioIdByProduct.has(productId)) {
      mainScenarioIdByProduct.set(productId, String(scenario.id)); // first in created_at order = Main
    }
  });
  const scenarioIds = [...mainScenarioIdByProduct.values()];
  if (!scenarioIds.length) {
    return [];
  }

  // Zones of the Main scenarios, so the picker can group tasks by zone (and order by zone sequence).
  const zones = await throwIfError(
    supabase.from("zones").select("id,name,code,sequence").in("scenario_id", scenarioIds),
  );
  const zoneById = new Map(
    (zones ?? []).map((zone) => [
      String(zone.id),
      { name: String(zone.name ?? ""), code: maybeText(zone.code) ?? null, sequence: num(zone.sequence, 0) },
    ]),
  );

  // PostgREST caps a single response at ~1000 rows; page through so a large project never silently
  // drops tasks from the picker.
  const tasks: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += 1000) {
    const page = ((await throwIfError(
      supabase
        .from("tasks")
        .select("id,name,manufacturing_code,scenario_id,row_type,zone_id")
        .in("scenario_id", scenarioIds)
        .order("wbs")
        .range(from, from + 999),
    )) ?? []) as Array<Record<string, unknown>>;
    tasks.push(...page);
    if (page.length < 1000) {
      break;
    }
  }

  const NON_WORK_ROWS = new Set(["milestone", "inspection"]);
  const UNZONED_SEQUENCE = Number.MAX_SAFE_INTEGER;
  return tasks
    .filter((task) => !NON_WORK_ROWS.has(String(task.row_type ?? "task")))
    .map((task) => {
      const zone = task.zone_id ? zoneById.get(String(task.zone_id)) : undefined;
      return {
        id: String(task.id),
        name: String(task.name ?? ""),
        code: maybeText(task.manufacturing_code) ?? null,
        scenarioName: scenarioNameById.get(String(task.scenario_id)) ?? "",
        zoneName: zone?.name ?? null,
        zoneCode: zone?.code ?? null,
        zoneSequence: zone?.sequence ?? UNZONED_SEQUENCE,
      };
    })
    // Group by zone (stable sort keeps the within-zone wbs order from the query above).
    .sort((left, right) => left.zoneSequence - right.zoneSequence)
    .map(({ zoneSequence: _zoneSequence, ...target }) => target);
}

export async function loadTaskFromSupabase(taskId: string, projectId?: string): Promise<Task | null> {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  const task = await throwIfError(supabase.from("tasks").select("*").eq("id", taskId).maybeSingle());

  if (!task) {
    return null;
  }

  const [dependencies, manufacturingSteps, partReferences, stepPhotos, stepTools, explodedViews, taskVideos] = await Promise.all([
    throwIfError(supabase.from("task_dependencies").select("*").eq("successor_task_id", taskId)),
    throwIfError(supabase.from("manufacturing_steps").select("*").eq("task_id", taskId).order("sequence")),
    throwIfError(supabase.from("part_references").select("*").eq("task_id", taskId).order("created_at")),
    throwIfError(supabase.from("step_photos").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at")),
    throwIfError(supabase.from("step_tools").select("*").eq("task_id", taskId).order("sequence")),
    throwIfError(supabase.from("step_exploded_views").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at")),
    throwIfError(supabase.from("task_videos").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at")),
  ]);

  const mappedTask = mapTask({
    ...task,
    dependency_ids: (dependencies ?? []).map((dependency) => String(dependency.predecessor_task_id)),
    manufacturing_steps: normalizeManufacturingStepSequences((manufacturingSteps ?? []).map(mapManufacturingStepRecord)),
    part_references: (partReferences ?? []).map(mapPartReferenceRecord),
  });

  const [signedStepPhotos, signedExplodedViews, signedTaskVideos] = await Promise.all([
    withSignedStepPhotoRows(supabase, (stepPhotos ?? []) as StepPhotoRow[]),
    withSignedExplodedViewRows(supabase, (explodedViews ?? []) as StepExplodedViewRow[]),
    withSignedTaskVideoRows(supabase, (taskVideos ?? []) as TaskVideoRow[]),
  ]);

  return withNormalizedStepAssets(
    mappedTask,
    indexStepPhotos(signedStepPhotos),
    indexStepTools((stepTools ?? []) as StepToolRow[]),
    indexExplodedViews(signedExplodedViews),
    indexTaskVideos(signedTaskVideos),
  );
}

export async function mergeLatestTaskToSupabase(taskId: string, updateTask: (task: Task) => Task, projectId?: string): Promise<Task | null> {
  const latestTask = await loadTaskFromSupabase(taskId, projectId);
  if (!latestTask) {
    return null;
  }

  const nextTask = updateTask(latestTask);
  await saveTaskToSupabase(nextTask, projectId);
  return nextTask;
}

function dataUrlToBlob(dataUrl: string) {
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

async function createPhotoThumbnailBlob(blob: Blob) {
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

function safeStorageSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function stepToolId(stepId: string, toolName: string) {
  return `tool-${safeStorageSegment(stepId)}-${safeStorageSegment(toolName.trim().toLocaleLowerCase())}`;
}

function toolLibraryId(toolName: string, projectId?: string) {
  const scope = projectId ? safeStorageSegment(projectId) : "global";
  return `tool-library-${scope}-${safeStorageSegment(toolName.trim().toLocaleLowerCase())}`;
}

// The value stored in the NOT NULL public_url/thumbnail_url/image_url columns. The buckets are
// PRIVATE, so this URL can never actually load -- it is written only to satisfy the schema and is
// never trusted on the read path (rendering always uses signed URLs; see SignedMediaRow).
function stableStoragePublicUrl(storagePath: string) {
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

function mapToolLibraryRow(row: ToolLibraryRow): ToolLibraryItem {
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : undefined,
    toolName: String(row.tool_name),
    imageUrl: row.image_url ?? undefined,
    storagePath: row.storage_path ?? undefined,
    category: row.category ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

function stepToolRowsFromTask(task: Task): StepToolRow[] {
  return Object.entries(getTaskStepToolListMap(task)).flatMap(([stepId, tools]) =>
    tools.map((toolName, index) => ({
      id: stepToolId(stepId, toolName),
      task_id: task.id,
      step_id: stepId,
      tool_name: toolName,
      sequence: index + 1,
    })),
  );
}

// Batched equivalent of calling syncStepToolsForTask per task: one existence read, one upsert,
// one stale-delete across the whole task set (was 2-3 queries PER task). Preserves the default
// allowEmptyWipe=false semantics -- a task that ends up with no tools keeps its existing tools
// (only tasks that contribute at least one tool have their stale rows removed).
async function syncStepToolsForTasks(supabase: ReturnType<typeof plannerClient>, tasks: Task[]) {
  if (tasks.length === 0) {
    return;
  }

  const taskIds = tasks.map((task) => task.id);
  const nextToolsByTask = new Map(tasks.map((task) => [task.id, stepToolRowsFromTask(task)] as const));
  const nextTools = [...nextToolsByTask.values()].flat();
  const nextToolIds = new Set(nextTools.map((tool) => tool.id));
  const wipeableTaskIds = new Set(
    [...nextToolsByTask].filter(([, tools]) => tools.length > 0).map(([id]) => id),
  );

  const existingTools = await throwIfError(
    supabase.from("step_tools").select("id, task_id").in("task_id", taskIds),
  );
  const staleToolIds = (existingTools ?? [])
    .filter((tool) => !nextToolIds.has(String(tool.id)) && wipeableTaskIds.has(String(tool.task_id)))
    .map((tool) => String(tool.id));

  if (nextTools.length) {
    await throwIfError(supabase.from("step_tools").upsert(nextTools));
  }

  if (staleToolIds.length) {
    await throwIfError(supabase.from("step_tools").delete().in("id", staleToolIds));
  }
}

async function syncStepToolsForTask(
  supabase: ReturnType<typeof plannerClient>,
  task: Task,
  options: { allowEmptyWipe?: boolean } = {},
) {
  const nextTools = stepToolRowsFromTask(task);
  const nextToolIds = nextTools.map((tool) => tool.id);
  const existingTools = await throwIfError(supabase.from("step_tools").select("id").eq("task_id", task.id));
  const staleToolIds = (existingTools ?? [])
    .map((tool) => String(tool.id))
    .filter((toolId) => !nextToolIds.includes(toolId));

  if (nextTools.length) {
    await throwIfError(supabase.from("step_tools").upsert(nextTools));
  }

  if (!staleToolIds.length) {
    return;
  }

  if (nextTools.length === 0 && !options.allowEmptyWipe) {
    return;
  }

  await throwIfError(supabase.from("step_tools").delete().in("id", staleToolIds));
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

export function subscribePlannerStateChanges(onChange: (payload: PlannerRealtimePayload) => void, scope?: PlannerRealtimeScope) {
  const supabase = plannerClient();
  const channel = supabase.channel(`planner-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const isTaskInScope = scope?.isTaskInScope;

  // Task-child tables are subscribed unfiltered (so adding/removing a task never re-subscribes the
  // channel); drop here any change whose owning task isn't in the shown scenario. Structural tables
  // are server-filtered by product/scenario scope, so they always pass.
  function emit(payload: PlannerRealtimePayload) {
    if (isTaskInScope && !isRealtimePayloadInScope(payload, isTaskInScope)) {
      return;
    }
    onChange(payload);
  }

  function listen(table: RealtimePlannerTable, filter?: string) {
    channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, (payload) => {
      emit({
        table,
        eventType: payload.eventType as PlannerRealtimePayload["eventType"],
        new: payload.new as Record<string, unknown> | undefined,
        old: payload.old as Record<string, unknown> | undefined,
      });
    });
  }

  listen("products", scope?.productId ? `id=eq.${scope.productId}` : undefined);
  listen("scenarios", scope?.productId ? `product_id=eq.${scope.productId}` : undefined);
  listen("stations", scope?.scenarioId ? `scenario_id=eq.${scope.scenarioId}` : undefined);
  listen("zones", scope?.scenarioId ? `scenario_id=eq.${scope.scenarioId}` : undefined);
  listen("tasks", scope?.scenarioId ? `scenario_id=eq.${scope.scenarioId}` : undefined);
  // No task-id server filter on the child tables: that list changes on every task add/remove, and a
  // filtered postgres_changes subscription rewrites realtime.subscription each time -- the churn this
  // change removes. emit() narrows these to the scenario via isTaskInScope instead.
  listen("task_dependencies");
  listen("manufacturing_steps");
  listen("part_references");
  listen("actual_events");
  listen("step_photos");
  listen("step_exploded_views");
  listen("task_videos");
  listen("step_tools");
  if (scope?.productId) {
    listen("custom_columns", `product_id=eq.${scope.productId}`);
  }
  if (scope?.scenarioId) {
    listen("custom_columns", `scenario_id=eq.${scope.scenarioId}`);
  }

  channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
