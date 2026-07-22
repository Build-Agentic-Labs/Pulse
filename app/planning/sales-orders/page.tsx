import { PlanningShell } from "@/components/planning/planning-shell";

export const metadata = {
  title: "Sales orders | Pulse",
};

/**
 * Placeholder. The production-schedule upload, column mapping, dry-run preview and import land
 * here in Task 10 of docs/superpowers/plans/2026-07-21-planning-schedule-to-work-orders.md.
 */
export default function SalesOrdersPage() {
  return (
    <PlanningShell title="Sales orders">
      <section className="ui-panel p-5">
        <div className="ui-mono-label">Sales orders</div>
        <p className="mt-3 text-sm text-ink-secondary">
          Upload a monthly production schedule here to create sales orders and resolve each line
          into a work order. Not built yet.
        </p>
      </section>
    </PlanningShell>
  );
}
