import type { ReactNode } from "react";
import { Section } from "./editor-fields";
import type { SectionEditors } from "./editor-types";

export function SopOverviewSection({
  builderHasFeedback,
  builderFeedback,
  reviewCategoriesNeedingAttention,
  sectionEditors,
}: {
  builderHasFeedback: boolean;
  builderFeedback: (category: string) => ReactNode;
  reviewCategoriesNeedingAttention: Set<string>;
  sectionEditors: SectionEditors;
}) {
  return (
    <>
      <Section
        title="Purpose"
        reserveMargin={builderHasFeedback}
        feedback={builderFeedback("purpose")}
        reviewAttention={reviewCategoriesNeedingAttention.has("purpose")}
      >
        {sectionEditors.purpose}
      </Section>
      <Section
        title="Scope"
        reserveMargin={builderHasFeedback}
        feedback={builderFeedback("scope")}
        reviewAttention={reviewCategoriesNeedingAttention.has("scope")}
      >
        {sectionEditors.scope}
      </Section>
      <Section
        title="Definitions"
        reserveMargin={builderHasFeedback}
        feedback={builderFeedback("definitions")}
        reviewAttention={reviewCategoriesNeedingAttention.has("definitions")}
      >
        {sectionEditors.definitions}
      </Section>
      <Section
        title="References"
        reserveMargin={builderHasFeedback}
        feedback={builderFeedback("references")}
        hideHeading
        reviewAttention={reviewCategoriesNeedingAttention.has("references")}
      >
        {sectionEditors.references}
      </Section>
    </>
  );
}
