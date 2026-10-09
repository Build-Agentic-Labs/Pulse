import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listAwiMasters } from "@/lib/awi/store";
import { AwiDirectoryRoute } from "@/components/awi-directory-route";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata = { title: "AWI Master List | Pulse" };

export default async function AwiPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const { workspace } = await searchParams;
  // A selected organization lets the list load alongside the sidebar, under its own RLS.
  const [groups, requestedMasters] = await Promise.all([
    fetchInitialWorkspaceGroups("product"),
    workspace ? createSupabaseServerClient().then((client) => listAwiMasters(workspace, client)).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const group = groups?.find((item) => item.workspace.id === workspace) ?? groups?.[0];
  const initialMasters = group
    ? group.workspace.id === workspace && requestedMasters !== undefined
      ? requestedMasters
      : await listAwiMasters(group.workspace.id, await createSupabaseServerClient()).catch(() => undefined)
    : [];
  return <AwiDirectoryRoute initialGroups={groups} initialMasters={initialMasters}
    initialWorkspaceId={group?.workspace.id} requestedWorkspaceId={workspace} />;
}
