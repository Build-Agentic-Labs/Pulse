import { PlanningShell } from "@/components/planning/planning-shell";
import { SalesOrdersWorkspace } from "@/components/planning/sales-orders-workspace";
import { fetchInitialPlanningSalesOrders } from "@/lib/supabase/server-data";

export const metadata = {
  title: "Sales orders | Pulse",
};

/** Auth, workspace and the access gate come from `app/planning/(workspace)/layout.tsx`. */
export default async function SalesOrdersPage() {
  const initial = await fetchInitialPlanningSalesOrders();
  return (
    <PlanningShell title="Sales orders">
      <SalesOrdersWorkspace
        initialSalesOrders={initial?.data.salesOrders}
        initialImports={initial?.data.imports}
        initialWorkspaceId={initial?.workspaceId}
      />
    </PlanningShell>
  );
}
