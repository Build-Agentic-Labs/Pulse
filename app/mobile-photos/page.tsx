import type { Metadata } from "next";
import { MobilePhotoRouteShell } from "@/components/project-route-shells";

export const metadata: Metadata = {
  title: "Step Photo Capture | BuildLogic Line Planner",
  description: "Mobile manufacturing step photo capture portal",
};

export default function MobilePhotosPage() {
  return <MobilePhotoRouteShell />;
}
