import { redirect } from "next/navigation";

// The dashboard is a panel inside the persistent Quality workspace. Keep a
// file-system route for direct links while the query-tab preserves the shell.
export default function SopDashboardRoute() {
  redirect("/sops?tab=dashboard");
}
