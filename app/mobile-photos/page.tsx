import type { Metadata } from "next";
import { MobilePhotoRouteShell } from "@/components/project-route-shells";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata: Metadata = {
  title: "Step Photo Capture | Pulse",
  description: "Mobile manufacturing step photo capture portal",
};

export default async function MobilePhotosPage() {
  return <MobilePhotoRouteShell initialGroups={await fetchInitialWorkspaceGroups()} />;
}
