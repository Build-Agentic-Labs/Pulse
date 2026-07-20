import { SettingsRouteShell } from "@/components/project-route-shells";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata = {
  title: "Settings | Pulse",
};

// Server-first (refactor plan, Stage 5): workspace groups arrive with the
// document so the settings shell paints content on the first frame. Signed-out
// or failed fetches pass undefined and the client resolves exactly as before.
export default async function SettingsPage() {
  return <SettingsRouteShell initialGroups={await fetchInitialWorkspaceGroups()} />;
}
