import { callerScopedSupabase, getBearerToken, requireApiUser } from "@/lib/api-auth";
import { loadProjectTaskTargetsFromSupabase } from "@/domain/supabase-planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/solidworks/targets
//   (no params)            -> { projects: [{ projectId, projectName, workspaceId, workspaceName }] }
//   ?projectId=<id>        -> { project, tasks: [{ id, name, code, scenarioName }] }
// Feeds the plugin's Project -> Task picker (exploded views attach at the task level). RLS gates
// everything to the service account.
export async function POST() {
  return Response.json({ error: "Use GET." }, { status: 405 });
}

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) {
    return auth.failure;
  }

  const supabase = callerScopedSupabase(getBearerToken(request));
  const projectId = new URL(request.url).searchParams.get("projectId");

  if (!projectId) {
    const { data: projects, error } = await supabase
      .from("projects")
      .select("id, name, workspace_id")
      .order("created_at");
    if (error) {
      return Response.json({ error: error.message }, { status: 502 });
    }

    const workspaceIds = [...new Set((projects ?? []).map((project) => String(project.workspace_id)))];
    const { data: workspaces } = workspaceIds.length
      ? await supabase.from("workspaces").select("id, name").in("id", workspaceIds)
      : { data: [] };
    const workspaceNameById = new Map((workspaces ?? []).map((ws) => [String(ws.id), String(ws.name ?? "")]));

    return Response.json({
      projects: (projects ?? []).map((project) => ({
        projectId: String(project.id),
        projectName: String(project.name ?? ""),
        workspaceId: String(project.workspace_id),
        workspaceName: workspaceNameById.get(String(project.workspace_id)) ?? "",
      })),
    });
  }

  // Confirm the caller can actually see this project before returning its tasks (planner child
  // tables read permissively, so this RLS-gated check is the real authorization boundary here).
  const { data: accessible, error: accessError } = await supabase
    .from("projects")
    .select("id, name, workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  if (accessError) {
    return Response.json({ error: accessError.message }, { status: 502 });
  }
  if (!accessible) {
    return Response.json({ error: "No access to this project." }, { status: 403 });
  }

  const project = {
    projectId: String(accessible.id),
    projectName: String(accessible.name ?? ""),
    workspaceId: String(accessible.workspace_id ?? ""),
  };

  // Tasks across ALL of the project's scenarios (a view attaches at the task level). Pass the
  // caller-scoped client — these tables are RLS-gated. Returns only ids/names.
  const tasks = await loadProjectTaskTargetsFromSupabase(projectId, supabase);
  return Response.json({ project, tasks });
}
