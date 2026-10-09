import type { ReactNode } from "react";
import type { Department } from "@/domain/departments";
import { rasicLegend, type Sop } from "@/domain/sop/schema";
import { AutoTextarea } from "../auto-textarea";
import { ProcessFlowchart } from "../process-flowchart";
import { Field, Section } from "./editor-fields";
import type { SectionEditors, SopPatch } from "./editor-types";

export function SopProcedureSection({
  builderHasFeedback,
  builderFeedback,
  reviewCategoriesNeedingAttention,
  sectionEditors,
  sop,
  canEdit,
  update,
  approvalDepartments,
  selectedDepartmentId,
  workspaceRoleNames,
  handleCreateRasicRole,
}: {
  builderHasFeedback: boolean;
  builderFeedback: (category: string) => ReactNode;
  reviewCategoriesNeedingAttention: Set<string>;
  sectionEditors: SectionEditors;
  sop: Sop;
  canEdit: boolean;
  update: (patch: SopPatch) => void;
  approvalDepartments: Department[];
  selectedDepartmentId: string;
  workspaceRoleNames: string[];
  handleCreateRasicRole: (name: string) => void;
}) {
  return (
    <>
      <Section
        title="Responsible person(s)"
        reviewAttention={reviewCategoriesNeedingAttention.has("responsible")}
        reserveMargin={builderHasFeedback}
        feedback={builderFeedback("responsible")}
      >
        {sectionEditors.responsible}
      </Section>
      <Section
        title="Measurement (KPIs)"
        reviewAttention={reviewCategoriesNeedingAttention.has("measurements")}
        reserveMargin={builderHasFeedback}
        feedback={builderFeedback("measurements")}
      >
        {sectionEditors.measurements}
      </Section>
      <Section
        title="Procedure"
        reserveMargin={builderHasFeedback}
        feedback={builderFeedback("procedure")}
        reviewAttention={reviewCategoriesNeedingAttention.has("procedure")}
      >
        <Field label="Process flow description" optional>
          <AutoTextarea
            className="ui-field-standalone min-h-16 py-2"
            value={sop.procedure.processFlowDescription}
            placeholder="Describe the process flow"
            disabled={!canEdit}
            onChange={(event) =>
              update({
                procedure: {
                  ...sop.procedure,
                  processFlowDescription: event.target.value,
                },
              })
            }
          />
        </Field>
        <p className="ui-mono-label mt-3 text-ink-tertiary">
          RASIC — {rasicLegend()}
        </p>
        <ProcessFlowchart
          roles={sop.procedure.roles}
          activities={sop.procedure.activities}
          departments={approvalDepartments}
          owningDepartmentId={selectedDepartmentId}
          workspaceRoleNames={workspaceRoleNames}
          onCreateRole={handleCreateRasicRole}
          disabled={!canEdit}
          onChange={(roles, activities) =>
            update({ procedure: { ...sop.procedure, roles, activities } })
          }
        />
      </Section>
    </>
  );
}
