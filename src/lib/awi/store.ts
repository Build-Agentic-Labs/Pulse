import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";
import { throwIfError } from "@/lib/supabase-errors";
import { readAllPages } from "@/lib/supabase/read-all-pages";

export type AwiMaster = Database["public"]["Tables"]["awi_masters"]["Row"];
export async function updateAwiMetadata(master: AwiMaster, documentNumber: string, category: string) {
  const { error } = await createPlannerSupabaseClient().rpc("update_awi_metadata", {
    p_master_id: master.id, p_document_number: documentNumber.trim(), p_category: category.trim(),
    p_expected_number: master.document_number, p_expected_category: master.category ?? "",
  });
  if (error?.code === "23505") throw new Error("That AWI number is already in use. Choose another number.");
  if (error) throw new Error(error.message);
}
export function awiDraftStatus(master: AwiMaster) {
  if (!master.published_at) return "Draft";
  return new Date(master.draft_updated_at).getTime() > new Date(master.published_at).getTime() ? "Published · draft changes" : "Published";
}
export async function listAwiMasters(workspaceId: string, client?: SupabaseClient<Database>): Promise<AwiMaster[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  return readAllPages((from, to) => throwIfError(supabase.from("awi_masters").select("*")
    .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).order("id").range(from, to)));
}
export async function getAwiMaster(id: string, client?: SupabaseClient<Database>): Promise<AwiMaster | null> {
  return await throwIfError((client ?? createPlannerSupabaseClient()).from("awi_masters").select("*").eq("id", id).maybeSingle());
}
export async function createAwiMaster(workspaceId: string, title: string, documentNumber: string): Promise<AwiMaster> {
  const client = createPlannerSupabaseClient();
  const id = await throwIfError(client.rpc("create_awi_master", { p_workspace_id: workspaceId, p_title: title.trim(), p_document_number: documentNumber.trim() }));
  if (!id) throw new Error("Unable to create AWI.");
  const master = await getAwiMaster(id, client);
  if (!master) throw new Error("Your AWI was created but could not be opened. Reload the master list to resume it.");
  return master;
}

export async function renameAwiMaster(master: AwiMaster, title: string, client = createPlannerSupabaseClient()) {
  await throwIfError(client.rpc("rename_awi_master", { p_master: master.id, p_title: title.trim(), p_expected_title: master.title }));
  return { ...master, title: title.trim() };
}

export async function copyAwiMaster(source: AwiMaster, title: string, client = createPlannerSupabaseClient()): Promise<AwiMaster> {
  const id = await throwIfError(client.rpc("copy_awi_master", { p_source: source.id, p_title: title.trim() }));
  if (!id) throw new Error("Unable to create copy.");
  const copy = await getAwiMaster(id, client);
  if (!copy) throw new Error("Copy created. Reload the list to open it.");
  try {
    const sourceSteps = await throwIfError(client.from('manufacturing_steps').select('id,sequence').eq('task_id', source.task_id));
    const targetSteps = await throwIfError(client.from('manufacturing_steps').select('id,sequence').eq('task_id', copy.task_id));
    const stepIds = new Map((sourceSteps ?? []).map(s => [s.id, targetSteps?.find(t => t.sequence === s.sequence)?.id]));
    const photoIds = new Map<string, string>();
    for (const table of ['step_photos', 'step_exploded_views', 'task_videos'] as const) {
      const rows = await readAllPages((from, to) => throwIfError(client.from(table).select('*').eq('task_id', source.task_id).is('deleted_at', null).order('id').range(from, to)));
      for (const row of rows) {
        const newId = crypto.randomUUID();
        if (table === "step_photos") photoIds.set(row.id, newId);
        const bucket = table === 'task_videos' ? 'task-videos' : 'step-photos';
        const prefix = `workspaces/${copy.workspace_id}/projects/${copy.project_id}/tasks/${copy.task_id}/${newId}`;
        const path = `${prefix}/${row.file_name || 'attachment'}`;
        await throwIfError(client.storage.from(bucket).copy(row.storage_path, path));
        const thumbnail = row.thumbnail_storage_path ? `${prefix}/thumbnail` : null;
        if (thumbnail && row.thumbnail_storage_path) await throwIfError(client.storage.from(bucket).copy(row.thumbnail_storage_path, thumbnail));
        const next = { ...row, id: newId, task_id: copy.task_id, storage_path: path, public_url: '', thumbnail_storage_path: thumbnail, thumbnail_url: null };
        if ('step_id' in next && next.step_id) {
          const mapped = stepIds.get(next.step_id);
          if (!mapped) throw new Error('Source steps changed during copy.');
          next.step_id = mapped;
        }
        if (table === 'step_photos') await throwIfError(client.from('step_photos').insert(next as Database['public']['Tables']['step_photos']['Insert']));
        else if (table === 'step_exploded_views') await throwIfError(client.from('step_exploded_views').insert(next as Database['public']['Tables']['step_exploded_views']['Insert']));
        else await throwIfError(client.from('task_videos').insert(next as Database['public']['Tables']['task_videos']['Insert']));
      }
    }
    if (photoIds.size) {
      const task = await throwIfError(client.from('tasks').select('custom_fields,version').eq('id', copy.task_id).single());
      if (!task) throw new Error('Copied draft unavailable.');
      const fields = task.custom_fields as Record<string, import('@/lib/database.types').Json>;
      if (fields.stepPhotoAnnotations) {
        let annotations = JSON.stringify(fields.stepPhotoAnnotations);
        for (const [oldId, newId] of photoIds) annotations = annotations.split(JSON.stringify(oldId)).join(JSON.stringify(newId));
        const saved = await throwIfError(client.from('tasks').update({custom_fields: {...fields,stepPhotoAnnotations: JSON.parse(annotations)}}).eq('id',copy.task_id).eq('version',task.version).select('id').maybeSingle());
        if (!saved) throw new Error('The new draft changed while copying annotations.');
      }
    }
  } catch (error) {
    throw new Error(`Draft "${copy.title}" was created, but some attachments could not be copied. Open that draft before making another copy. ${error instanceof Error ? error.message : ''}`);
  }
  return copy;
}
