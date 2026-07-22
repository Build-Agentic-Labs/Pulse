import { ConfigurationWorkspace } from "@/components/planning/configuration-workspace";
import { PlanningShell } from "@/components/planning/planning-shell";

export const metadata = {
  title: "Product configuration | Pulse",
};

/** Auth, workspace and the access gate come from `app/planning/(workspace)/layout.tsx`. */
export default function ConfigurationPage() {
  return (
    <PlanningShell title="Product configuration">
      <ConfigurationWorkspace />
    </PlanningShell>
  );
}
