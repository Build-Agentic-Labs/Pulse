import { HomeRouteShell } from "@/components/project-route-shells";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

// Stage 5 (refactor plan): workspace groups are fetched on the server with the
// caller's cookie session and arrive with the document, so the shell paints
// content on the first frame instead of a loading shell. Signed-out or failed
// fetches pass undefined and the client resolves exactly as before.
export default async function Home() {
  return <HomeRouteShell initialGroups={await fetchInitialWorkspaceGroups()} />;
}
