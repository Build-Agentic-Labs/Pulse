import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Step Photo Capture | BuildLogic Line Planner",
  description: "Mobile manufacturing step photo capture portal",
};

export default function ProjectMobilePhotosPage() {
  redirect("/mobile-photos");
}
