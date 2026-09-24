import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";
import type { ProblemCase } from "@/domain/problem-solving";

type Client = SupabaseClient<Database>;
export type CaseInput = Pick<ProblemCase, "title" | "source" | "owner" | "reported_on" | "severity" | "stage" | "problem" | "expected" | "affected" | "containment" | "root_cause" | "cause_evidence" | "prevention" | "verification_plan" | "verification_result" | "verified_on">;
export async function listCases(workspaceId: string, client?: Client) {
  const db = client ?? createPlannerSupabaseClient();
  const { data, error } = await db.from("problem_cases").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}
export async function listActions(caseIds: string[], client?: Client) {
  if (!caseIds.length) return [];
  const { data, error } = await (client ?? createPlannerSupabaseClient()).from("problem_actions").select("*").in("case_id", caseIds).order("due_on");
  if (error) throw error;
  return data;
}
export async function createCase(workspaceId: string, title: string, client?: Client) {
  const { data, error } = await (client ?? createPlannerSupabaseClient()).from("problem_cases").insert({ workspace_id: workspaceId, title: title.trim() }).select().single();
  if (error) throw error;
  return data;
}
export async function saveCase(row: ProblemCase, client?: Client) {
  const { title, source, owner, reported_on, severity, stage, problem, expected, affected, containment, root_cause, cause_evidence, prevention, verification_plan, verification_result, verified_on } = row;
  const input: CaseInput = { title: title.trim(), source, owner, reported_on, severity, stage, problem, expected, affected, containment, root_cause, cause_evidence, prevention, verification_plan, verification_result, verified_on };
  const { data, error } = await (client ?? createPlannerSupabaseClient()).from("problem_cases").update(input).eq("id", row.id).eq("version", row.version).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This case changed in another session. Reopen it to load the latest version before saving.");
  return data;
}
export async function caseDetails(id: string, client?: Client) {
  const db = client ?? createPlannerSupabaseClient();
  const [actions, evidence, history] = await Promise.all([
    listActions([id], db),
    db.from("problem_evidence").select("*").eq("case_id", id).order("created_at"),
    db.from("problem_history").select("*").eq("case_id", id).order("created_at", { ascending: false }),
  ]);
  if (evidence.error) throw evidence.error;
  if (history.error) throw history.error;
  return { actions, evidence: evidence.data, history: history.data };
}
export async function addAction(input: Database["public"]["Tables"]["problem_actions"]["Insert"], client?: Client) {
  const { error } = await (client ?? createPlannerSupabaseClient()).from("problem_actions").insert(input);
  if (error) throw error;
}
export async function completeAction(id: string, evidence: string, client?: Client) {
  const { data, error } = await (client ?? createPlannerSupabaseClient()).from("problem_actions").update({ status: "done", completion_evidence: evidence.trim() }).eq("id", id).eq("status", "open").select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This action has changed. Reload the case.");
}
export async function uploadEvidence(c: ProblemCase, section: string, file: File, client?: Client) {
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose a file smaller than 20 MB.");
  const db = client ?? createPlannerSupabaseClient();
  const path = `${c.workspace_id}/${c.id}/${section}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error } = await db.storage.from("problem-evidence").upload(path, file, { upsert: false });
  if (error) throw error;
  const result = await db.from("problem_evidence").insert({ case_id: c.id, section, file_name: file.name, storage_path: path });
  if (result.error) throw new Error(`File uploaded, but could not be linked to the case: ${result.error.message}. Retry to attach it.`);
}
export async function evidenceUrl(path: string, client?: Client) {
  const { data, error } = await (client ?? createPlannerSupabaseClient()).storage.from("problem-evidence").createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}
