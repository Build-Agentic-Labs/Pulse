import type { Metadata } from "next";
import { MobilePhotoRouteShell } from "@/components/project-route-shells";

export const metadata: Metadata = {
  title: "Step Photo Capture | Pulse",
  description: "Mobile manufacturing step photo capture portal",
};

export default async function ProjectMobilePhotosPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  return <MobilePhotoRouteShell projectId={projectId} />;
}
