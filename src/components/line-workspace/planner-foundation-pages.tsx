import { ClipboardCheck, type LucideIcon } from "lucide-react";

export { PfmeaWorkspace } from "./pfmea-workspace";

type PlannerFoundationPageProps = {
  title: string;
  subtitle: string;
  detail: string;
  workspaceLabel: string;
  emptyTitle: string;
  emptyCopy: string;
  icon: LucideIcon;
};

function PlannerFoundationPage({
  title,
  subtitle,
  detail,
  workspaceLabel,
  emptyTitle,
  emptyCopy,
  icon: Icon,
}: PlannerFoundationPageProps) {
  const titleId = `planner-${title.toLowerCase()}-title`;

  return (
    <section className="mx-auto max-w-[1100px] space-y-6" aria-labelledby={titleId}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id={titleId} className="ui-section-title">
            {title}
          </h2>
          <p className="ui-section-subtitle">{subtitle}</p>
          <p className="text-xs text-ink-tertiary">{detail}</p>
        </div>
      </header>

      <section className="overflow-hidden rounded-lg border border-line" aria-label={workspaceLabel}>
        <div className="flex items-baseline justify-between gap-3 border-b border-line px-3 py-2.5">
          <h3 className="ui-setup-section-title">{workspaceLabel}</h3>
          <span className="ui-section-subtitle">0 items</span>
        </div>
        <div className="grid min-h-[24rem] place-items-center p-6">
          <div className="max-w-md text-center">
            <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-tertiary">
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h3 className="mt-3 text-sm font-medium text-ink">{emptyTitle}</h3>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">{emptyCopy}</p>
          </div>
        </div>
      </section>
    </section>
  );
}

export function ChecklistWorkspace() {
  return (
    <PlannerFoundationPage
      title="Checklist"
      subtitle="Build the operator and quality checks used while the product is assembled."
      detail="This will become the in-process traveler used to verify the product as work progresses."
      workspaceLabel="Checklist builder"
      emptyTitle="No checklist content yet"
      emptyCopy="The builder shell is ready. We will define operator checks, quality checks, and traveler behavior next."
      icon={ClipboardCheck}
    />
  );
}
