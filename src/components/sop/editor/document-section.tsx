import type { ReactNode } from "react";
import type { AuthoringMode } from "@/domain/sop/authoring";
import type { Department } from "@/domain/departments";
import { SOP_STATUS_LABELS, type Sop } from "@/domain/sop/schema";
import { ThemedSelect } from "@/components/themed-select";
import { DocumentField } from "./editor-fields";
import type { SopPatch } from "./editor-types";

export function SopDocumentSection({
  builderHasFeedback,
  reviewCategoriesNeedingAttention,
  authMode,
  persistedUpdatedAt,
  canEdit,
  deptId,
  setDeptId,
  selectedDept,
  displaySopNumber,
  sop,
  update,
  controlledVersion,
  approvalReviewCycle,
  navigation,
  builderFeedback,
}: {
  builderHasFeedback: boolean;
  reviewCategoriesNeedingAttention: Set<string>;
  authMode: AuthoringMode | null;
  persistedUpdatedAt: string | undefined;
  canEdit: boolean;
  deptId: string;
  setDeptId: (id: string) => void;
  selectedDept: Department | null;
  displaySopNumber: string;
  sop: Sop;
  update: (patch: SopPatch) => void;
  controlledVersion: string;
  approvalReviewCycle: number;
  navigation: ReactNode;
  builderFeedback: (category: string) => ReactNode;
}) {
  return (
    <div
      className={`grid min-h-[calc(100dvh-8rem)] gap-6 py-8 ${builderHasFeedback ? "xl:grid-cols-[minmax(0,16rem)_minmax(0,56rem)_minmax(0,16rem)]" : ""}`}
    >
      <section
        className={`flex min-w-0 w-full flex-col px-2 py-4 sm:px-5 sm:py-8 ${builderHasFeedback ? "xl:col-start-2" : ""}`}
        data-review-attention={
          reviewCategoriesNeedingAttention.has("document") ||
          reviewCategoriesNeedingAttention.has("overall")
            ? "true"
            : undefined
        }
      >
        <h2 className="border-b border-line pb-4 text-lg font-semibold leading-7 text-ink">
          Document
        </h2>
        <div className="mt-8 grid gap-x-12 gap-y-9 sm:grid-cols-2">
          {authMode && authMode.kind !== "blocked" ? (
            <DocumentField label="Owning department" className="sm:col-span-2">
              {authMode.kind === "choose" && !persistedUpdatedAt ? (
                <div
                  className={
                    canEdit
                      ? "sop-document-select-shell"
                      : "border-b border-line"
                  }
                >
                  <ThemedSelect
                    variant="sop"
                    ariaLabel="Owning department"
                    value={deptId}
                    disabled={!canEdit}
                    triggerClassName="ui-sop-select-inline"
                    options={authMode.departments.map((department) => ({
                      value: department.id,
                      label: `${department.code} · ${department.name}`,
                    }))}
                    onChange={setDeptId}
                  />
                </div>
              ) : (
                <div
                  className="sop-document-field flex items-center"
                  aria-readonly="true"
                >
                  <span className="truncate">{selectedDept?.name ?? "—"}</span>
                </div>
              )}
            </DocumentField>
          ) : null}

          <DocumentField label="SOP number">
            <div
              className="sop-document-field flex items-center"
              aria-readonly="true"
            >
              <span className="truncate">
                {/* The number is earned at release, so the placeholder stands for all of
                              authoring and review -- "Assigned on save" was true only while the
                              first save minted it. Without a department chosen there is not even a
                              sequence to name yet. */}
                {selectedDept ? displaySopNumber : "Assigned at release"}
              </span>
            </div>
          </DocumentField>

          <DocumentField label="Title">
            <input
              className={`ui-field-standalone sop-document-field ${canEdit ? "sop-document-input" : ""}`}
              value={sop.meta.title}
              placeholder="QMS"
              disabled={!canEdit}
              onChange={(event) =>
                update({ meta: { ...sop.meta, title: event.target.value } })
              }
            />
          </DocumentField>

          <DocumentField label="Version">
            <div
              className="sop-document-field flex items-center"
              aria-readonly="true"
            >
              <span className="truncate">{controlledVersion}</span>
            </div>
          </DocumentField>

          <DocumentField label="Status">
            <div className="flex h-11 items-center">
              <span
                className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${
                  sop.status === "approved"
                    ? "bg-accent-subtle text-accent"
                    : sop.status === "obsolete"
                      ? "bg-danger-muted text-danger"
                      : "bg-surface-muted text-ink-secondary"
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full bg-current opacity-70"
                  aria-hidden
                />
                {SOP_STATUS_LABELS[sop.status]}
              </span>
            </div>
          </DocumentField>

          {approvalReviewCycle > 0 ? (
            <DocumentField label="Revision date">
              <input
                type="date"
                required
                className={`ui-field-standalone sop-document-field ${canEdit ? "sop-document-input" : ""}`}
                value={sop.meta.revisionDate}
                disabled={!canEdit}
                onChange={(event) =>
                  update({
                    meta: { ...sop.meta, revisionDate: event.target.value },
                  })
                }
              />
            </DocumentField>
          ) : null}
        </div>

        {navigation}
      </section>
      {builderHasFeedback ? (
        <aside className="min-w-0 xl:col-start-3">
          {builderFeedback("document")}
        </aside>
      ) : null}
    </div>
  );
}
