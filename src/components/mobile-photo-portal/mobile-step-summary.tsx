import { manufacturingStepDisplayName } from "./step-labels";
import type { StepPhotoAttachment } from "@/domain/step-photos";
import { ChevronDown } from "lucide-react";

import type { ManufacturingStep } from "@/domain/types";

export function MobileStepSummary({
  step,
  toggleStepExpanded,
  stepCode,
  photos,
  stepTools,
  selectedChecks,
  readOnly = false,
}: {
  step: ManufacturingStep;
  toggleStepExpanded: (stepId: string) => void;
  stepCode: string;
  photos: StepPhotoAttachment[];
  stepTools: string[];
  selectedChecks: Set<string>;
  readOnly?: boolean;
}) {
  const content = (
    <span className="ui-photo-mobile-step-summary-main">
      <span className="ui-photo-mobile-step-code">
        {stepCode || `Step ${step.sequence}`}
      </span>
      <span className="ui-photo-mobile-step-summary-name">
        {manufacturingStepDisplayName(step)}
      </span>
      <span className="ui-photo-mobile-step-summary-meta">
        <span>{step.durationMinutes ?? 0} min</span>
        {photos.length > 0 ? (
          <span>
            {photos.length} photo{photos.length === 1 ? "" : "s"}
          </span>
        ) : null}
        {stepTools.length > 0 ? (
          <span>
            {stepTools.length} tool{stepTools.length === 1 ? "" : "s"}
          </span>
        ) : null}
        {selectedChecks.size > 0 ? (
          <span>
            {selectedChecks.size} check
            {selectedChecks.size === 1 ? "" : "s"}
          </span>
        ) : null}
      </span>
    </span>
  );

  return (
    <article key={step.id} className="overflow-hidden ui-panel">
      {readOnly ? (
        <div className="ui-photo-mobile-step-summary">{content}</div>
      ) : (
        <button
          type="button"
          onClick={() => toggleStepExpanded(step.id)}
          className="ui-photo-mobile-step-summary"
          aria-expanded={false}
          aria-label={`Expand step ${step.sequence}`}
        >
          {content}
          <ChevronDown size={16} className="ui-photo-mobile-step-summary-chevron" />
        </button>
      )}
    </article>
  );
}
