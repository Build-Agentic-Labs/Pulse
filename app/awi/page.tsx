import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listAwiMasters } from "@/lib/awi/store";
import { AwiDirectory } from "@/components/awi-directory";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata = { title: "AWI Master List | Pulse" };

export default async function AwiPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const [{ workspace }, groups] = await Promise.all([searchParams, fetchInitialWorkspaceGroups()]);
  const group = groups?.find((item) => item.workspace.id === workspace) ?? groups?.[0];
  const product = group?.projects.find((item) => item.status === "active" && !item.isAwiMaster);
  const initialMasters = group ? await listAwiMasters(group.workspace.id, await createSupabaseServerClient()).catch(() => undefined) : [];
  return <AwiDirectory workspaceId={group?.workspace.id} initialMasters={initialMasters} groups={groups ?? []} project={group && product ? {
    projectId: product.id, projectName: product.name, workspaceId: group.workspace.id,
    workspaceName: group.workspace.name, role: group.role, accessLevel: product.accessLevel,
  } : undefined} />;
}
