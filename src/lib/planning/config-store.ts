/**
 * Product configuration: the SKU → BOM catalog the schedule importer resolves against.
 *
 * Persisted in `work_order_templates` / `work_order_template_lines` — the right tables all
 * along, they were just keyed by `model + customer`. Re-keying to `sku` is what turns
 * resolution from a fuzzy customer search into a dictionary lookup (design decision D1).
 *
 * Mirrors the idioms in `./store.ts`: explicit column projections (never `select('*')`), every
 * query scoped by `workspace_id`, `created_at`/`updated_at` owned by the DB, snake_case mapped
 * to camelCase at the boundary, Supabase errors re-thrown as human-readable `Error`s, and an
 * optional injected client so the same read serves the browser and a server component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildConfigIndex, type ConfigEntry, type ConfigIndex } from "@/domain/planning/schedule-resolve";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";

type PlanningClient = SupabaseClient<Database>;

// ── types ─────────────────────────────────────────────────────────────────

/** One row of the configuration list. */
export interface ConfigSummary {
  id: string;
  sku: string;
  name: string;
  orderType: string;
  model: string;
  customer: string;
  pmConfigId: string | null;
  defaultTrailerLetter: string;
  lineCount: number;
  retiredAt: string | null;
}

/** One BOM line on a configuration. */
export interface ConfigLine {
  id: string;
  itemNo: string;
  description: string;
  buildQty: number;
  position: number;
}

export interface ConfigDetail extends Omit<ConfigSummary, "lineCount"> {
  notesDefault: string;
  lines: ConfigLine[];
}

/** What the editor submits. `id` absent = create. Lines without an `id` are new. */
export interface SaveConfigInput {
  id?: string;
  sku: string;
  name: string;
  orderType: string;
  model: string;
  customer: string;
  pmConfigId: string | null;
  defaultTrailerLetter: string;
  notesDefault: string;
  lines: Array<Omit<ConfigLine, "id"> & { id?: string }>;
}

// ── column projections ────────────────────────────────────────────────────

const CONFIG_COLUMNS =
  "id, sku, name, order_type, model, customer, pm_template_id, default_trailer_letter, notes_default, retired_at";
const CONFIG_LINE_COLUMNS = "id, item_no, description, build_qty, position";

// ── reads ─────────────────────────────────────────────────────────────────

/** Active (non-retired) configurations with their BOM line counts, SKU order. */
export async function listConfigs(workspaceId: string, client?: PlanningClient): Promise<ConfigSummary[]> {
  const supabase = client ?? createPlannerSupabaseClient();

  const { data, error } = await supabase
    .from("work_order_templates")
    .select(`${CONFIG_COLUMNS}, work_order_template_lines(count)`)
    .eq("workspace_id", workspaceId)
    .is("retired_at", null)
    .order("sku", { ascending: true });
  if (error) {
    throw new Error(`Could not load product configurations: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    // PostgREST returns an aggregate relation as an array of one `{ count }` object.
    const relation = (row as { work_order_template_lines?: Array<{ count: number }> }).work_order_template_lines;
    return {
      id: String(row.id),
      sku: String(row.sku ?? ""),
      name: String(row.name ?? ""),
      orderType: String(row.order_type ?? ""),
      model: String(row.model ?? ""),
      customer: String(row.customer ?? ""),
      pmConfigId: row.pm_template_id ? String(row.pm_template_id) : null,
      defaultTrailerLetter: String(row.default_trailer_letter ?? ""),
      lineCount: relation?.[0]?.count ?? 0,
      retiredAt: row.retired_at ? String(row.retired_at) : null,
    };
  });
}

/** One configuration with its BOM lines, or null when it does not exist in this workspace. */
export async function getConfig(
  workspaceId: string,
  id: string,
  client?: PlanningClient,
): Promise<ConfigDetail | null> {
  const supabase = client ?? createPlannerSupabaseClient();

  const { data: header, error: headerError } = await supabase
    .from("work_order_templates")
    .select(CONFIG_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (headerError) {
    throw new Error(`Could not load the product configuration: ${headerError.message}`);
  }
  if (!header) {
    return null;
  }

  const { data: lines, error: linesError } = await supabase
    .from("work_order_template_lines")
    .select(CONFIG_LINE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("template_id", id)
    .order("position", { ascending: true });
  if (linesError) {
    throw new Error(`Could not load the configuration's parts list: ${linesError.message}`);
  }

  return {
    id: String(header.id),
    sku: String(header.sku ?? ""),
    name: String(header.name ?? ""),
    orderType: String(header.order_type ?? ""),
    model: String(header.model ?? ""),
    customer: String(header.customer ?? ""),
    pmConfigId: header.pm_template_id ? String(header.pm_template_id) : null,
    defaultTrailerLetter: String(header.default_trailer_letter ?? ""),
    notesDefault: String(header.notes_default ?? ""),
    retiredAt: header.retired_at ? String(header.retired_at) : null,
    lines: (lines ?? []).map((line) => ({
      id: String(line.id),
      itemNo: String(line.item_no ?? ""),
      description: String(line.description ?? ""),
      buildQty: Number(line.build_qty ?? 0),
      position: Number(line.position ?? 0),
    })),
  };
}

/**
 * The lookup the schedule resolver reads: every active, SKU-bearing configuration plus the
 * workspace's trailer-letter catalog. Configurations with a blank SKU are excluded by
 * `buildConfigIndex` — legacy rows default to `''` and must never match an empty sheet cell.
 */
export async function loadConfigIndex(workspaceId: string, client?: PlanningClient): Promise<ConfigIndex> {
  const supabase = client ?? createPlannerSupabaseClient();

  const [configs, trailers] = await Promise.all([
    supabase
      .from("work_order_templates")
      .select("id, sku, order_type, model, pm_template_id, default_trailer_letter")
      .eq("workspace_id", workspaceId)
      .is("retired_at", null),
    supabase.from("trailer_configs").select("letter").eq("workspace_id", workspaceId),
  ]);

  if (configs.error) {
    throw new Error(`Could not load product configurations: ${configs.error.message}`);
  }
  if (trailers.error) {
    throw new Error(`Could not load trailer configurations: ${trailers.error.message}`);
  }

  const entries: ConfigEntry[] = (configs.data ?? []).map((row) => ({
    id: String(row.id),
    sku: String(row.sku ?? ""),
    orderType: String(row.order_type ?? ""),
    model: String(row.model ?? ""),
    pmConfigId: row.pm_template_id ? String(row.pm_template_id) : null,
    defaultTrailerLetter: String(row.default_trailer_letter ?? ""),
  }));

  return buildConfigIndex(
    entries,
    (trailers.data ?? []).map((row) => String(row.letter ?? "")).filter(Boolean),
  );
}

// ── writes ────────────────────────────────────────────────────────────────

/**
 * Create or update one configuration and reconcile its BOM lines GRANULARLY: update the lines
 * that changed, insert the new ones, and delete only lines belonging to THIS configuration that
 * the submitted set no longer contains. Never a delete-all-then-reinsert — that is the
 * full-state save pattern the planner state tripwire exists to prevent.
 *
 * Returns the configuration's id.
 */
export async function saveConfig(workspaceId: string, input: SaveConfigInput): Promise<string> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await getUserFromSession(supabase);
  const createdBy = userData.user?.id ?? null;

  const sku = input.sku.trim();
  if (!sku) {
    throw new Error("A SKU is required — it is the key the schedule importer resolves against.");
  }

  const header = {
    workspace_id: workspaceId,
    sku,
    name: input.name.trim(),
    order_type: input.orderType,
    model: input.model.trim(),
    customer: input.customer.trim(),
    pm_template_id: input.pmConfigId,
    default_trailer_letter: input.defaultTrailerLetter.trim().toUpperCase(),
    notes_default: input.notesDefault,
  };

  let configId = input.id ?? "";
  if (configId) {
    const { error } = await supabase
      .from("work_order_templates")
      .update(header)
      .eq("workspace_id", workspaceId)
      .eq("id", configId);
    if (error) {
      throw new Error(describeSaveError(error, sku));
    }
  } else {
    const { data, error } = await supabase
      .from("work_order_templates")
      .insert({ ...header, created_by: createdBy })
      .select("id")
      .single();
    if (error) {
      throw new Error(describeSaveError(error, sku));
    }
    configId = String(data.id);
  }

  await reconcileConfigLines(supabase, workspaceId, configId, input.lines);
  return configId;
}

/** A 23505 here is always the partial unique index on (workspace_id, sku) among active rows. */
function describeSaveError(error: { code?: string; message: string }, sku: string): string {
  if (error.code === "23505") {
    return `SKU "${sku}" already has an active configuration. Retire the existing one first, or edit it instead.`;
  }
  return `Could not save the product configuration: ${error.message}`;
}

async function reconcileConfigLines(
  supabase: PlanningClient,
  workspaceId: string,
  configId: string,
  lines: SaveConfigInput["lines"],
): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from("work_order_template_lines")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("template_id", configId);
  if (existingError) {
    throw new Error(`Could not load the configuration's parts list: ${existingError.message}`);
  }

  const submittedIds = new Set(lines.map((line) => line.id).filter((id): id is string => Boolean(id)));
  const removed = (existing ?? []).map((row) => String(row.id)).filter((id) => !submittedIds.has(id));

  const updates = lines.filter((line) => line.id);
  const inserts = lines.filter((line) => !line.id);

  for (const line of updates) {
    const { error } = await supabase
      .from("work_order_template_lines")
      .update({
        item_no: line.itemNo.trim(),
        description: line.description.trim(),
        build_qty: line.buildQty,
        position: line.position,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", line.id as string);
    if (error) {
      throw new Error(`Could not save the parts list: ${error.message}`);
    }
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from("work_order_template_lines").insert(
      inserts.map((line) => ({
        workspace_id: workspaceId,
        template_id: configId,
        item_no: line.itemNo.trim(),
        description: line.description.trim(),
        build_qty: line.buildQty,
        position: line.position,
      })),
    );
    if (error) {
      throw new Error(`Could not add parts to the configuration: ${error.message}`);
    }
  }

  if (removed.length > 0) {
    const { error } = await supabase
      .from("work_order_template_lines")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("template_id", configId)
      .in("id", removed);
    if (error) {
      throw new Error(`Could not remove parts from the configuration: ${error.message}`);
    }
  }
}

/**
 * Retire a configuration. There is deliberately no delete: `work_orders.template_id` points at
 * these rows, so removing one would orphan the provenance of every order built from it. The
 * unique SKU index covers active rows only, so a retired SKU can be superseded by a new config.
 */
export async function retireConfig(workspaceId: string, id: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { error } = await supabase
    .from("work_order_templates")
    .update({ retired_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) {
    throw new Error(`Could not retire the product configuration: ${error.message}`);
  }
}
