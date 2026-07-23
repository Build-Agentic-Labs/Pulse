import { redirect } from "next/navigation";

// Department and SOP-access administration lives inside the SOP workspace.
export default function DepartmentsPage() {
  redirect("/sops?tab=settings");
}
