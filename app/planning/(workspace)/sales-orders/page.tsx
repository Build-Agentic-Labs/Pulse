import { PlanningShell } from "@/components/planning/planning-shell";
import { SalesOrdersWorkspace } from "@/components/planning/sales-orders-workspace";

export const metadata = {
  title: "Sales orders | Pulse",
};

/** Auth, workspace and the access gate come from `app/planning/(workspace)/layout.tsx`. */
export default function SalesOrdersPage() {
  return (
    <PlanningShell title="Sales orders">
      <SalesOrdersWorkspace />
    </PlanningShell>
  );
}
