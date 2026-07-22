import { PlanningShell } from "@/components/planning/planning-shell";

export const metadata = {
  title: "Product configuration | Pulse",
};

/**
 * Placeholder. The SKU → BOM configuration list and editor land here in Task 8 of
 * docs/superpowers/plans/2026-07-21-planning-schedule-to-work-orders.md.
 */
export default function ConfigurationPage() {
  return (
    <PlanningShell title="Product configuration">
      <section className="ui-panel p-5">
        <div className="ui-mono-label">Product configuration</div>
        <p className="mt-3 text-sm text-ink-secondary">
          Assign a BOM parts list to each finished-goods and accessory SKU. Not built yet.
        </p>
      </section>
    </PlanningShell>
  );
}
