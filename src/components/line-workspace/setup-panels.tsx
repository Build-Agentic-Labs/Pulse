"use client";

import { Eye, FileText, ListChecks, Plus, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  getManufacturingStepCheckDefinitions,
  getManufacturingStepCheckState,
  normalizeManufacturingStepCheck,
  type ManufacturingStepCheckDefinition,
} from "@/domain/manufacturing-step-checks";
import { countTaskStepTools } from "@/domain/step-tools";
import { normalizeCode } from "@/domain/nomenclature";
import type {
  DemandPeriod,
  DocumentTypeCode,
  ManufacturingComponent,
  PlannerState,
  Product,
  ProductStatus,
  Task,
  Zone,
} from "@/domain/types";
import { ClearableNumberInput } from "../clearable-number-input";
import { ThemedSelect } from "../themed-select";
import { WorkInstructionPrintPreview } from "../work-instruction/work-instruction-print";
import { type FeedbackConfirm } from "../themed-feedback";
import { NumericField, StatCard, type ProductNumberField, type ProductTextField } from "./shared";

const demandPeriodOptions: Array<{ value: DemandPeriod; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

const productStatusOptions: Array<{ value: ProductStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "Review" },
  { value: "approved", label: "Approved" },
  { value: "released", label: "Released" },
  { value: "obsolete", label: "Obsolete" },
];

function SetupFieldGroup({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ui-setup-section ${className}`}>
      <div className="ui-setup-section-head">
        <div className="ui-setup-section-title">{title}</div>
        {description ? <div className="ui-setup-section-desc">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function ProductSetupPanel({
  product,
  onProductNumber,
  onProductText,
}: {
  product: Product;
  onProductNumber: (field: ProductNumberField, value: number) => void;
  onProductText: (field: ProductTextField, value: string) => void;
}) {
  return (
    <section className="ui-product-setup">
      <div className="ui-product-setup-head">
        <div>
          <h2 className="ui-section-title">Product Setup</h2>
          <div className="ui-section-subtitle">Demand, available time, takt, and target labor</div>
        </div>
      </div>

      <div className="ui-product-setup-body">
        <SetupFieldGroup title="Product Identity" description="What is being planned">
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(110px,0.55fr)_minmax(150px,0.7fr)_minmax(130px,0.6fr)_minmax(150px,0.7fr)]">
            <label className="block">
              <span className="ui-field-label">Product</span>
              <input
                className="ui-field-standalone"
                value={product.name}
                onChange={(event) => onProductText("name", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ui-field-label">Product Code</span>
              <input
                className="ui-field-standalone font-mono uppercase"
                value={product.productCode ?? ""}
                onChange={(event) =>
                  onProductText("productCode", event.target.value.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "").slice(0, 20))
                }
                placeholder="FB-V2"
              />
            </label>
            <label className="block">
              <span className="ui-field-label">SKU</span>
              <input
                className="ui-field-standalone"
                value={product.sku ?? ""}
                onChange={(event) => onProductText("sku", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ui-field-label">Revision</span>
              <input
                className="ui-field-standalone"
                value={product.revision}
                onChange={(event) => onProductText("revision", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ui-field-label">Status</span>
              <ThemedSelect
                className="w-full"
                value={product.status}
                options={productStatusOptions}
                onChange={(value) => onProductText("status", value as ProductStatus)}
              />
            </label>
          </div>
        </SetupFieldGroup>

        <div className="ui-product-setup-split">
          <SetupFieldGroup title="Demand & Labor" description="Volume, takt override, and labor target">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <label className="block">
                <span className="ui-field-label">Demand</span>
                <div className="ui-field-shell ui-field-shell-select-combo">
                  <ClearableNumberInput
                    className="number-input ui-field-control"
                    value={product.demandQuantity}
                    min={0}
                    step={1}
                    precision={0}
                    normalize={Math.round}
                    onValueChange={(value) => onProductNumber("demandQuantity", value)}
                  />
                  <ThemedSelect
                    className="w-28 shrink-0"
                    triggerClassName="h-9 rounded-none rounded-r border-0 border-l px-2"
                    value={product.demandPeriod}
                    options={demandPeriodOptions}
                    onChange={(value) => onProductText("demandPeriod", value as DemandPeriod)}
                  />
                </div>
              </label>
              <NumericField
                label="Manual Takt"
                value={product.manualTaktMinutes ?? 0}
                suffix="min"
                onChange={(value) => onProductNumber("manualTaktMinutes", value)}
              />
              <NumericField
                label="Target MH"
                value={product.targetManHours}
                suffix="MH"
                onChange={(value) => onProductNumber("targetManHours", value)}
              />
            </div>
          </SetupFieldGroup>

          <SetupFieldGroup title="Available Workday" description="Shift time minus planned non-production time">
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              <NumericField
                label="Workday"
                value={product.grossAvailableMinutes}
                suffix="min"
                onChange={(value) => onProductNumber("grossAvailableMinutes", value)}
              />
              <NumericField
                label="Breaks"
                value={product.breakMinutes}
                suffix="min"
                onChange={(value) => onProductNumber("breakMinutes", value)}
              />
              <NumericField
                label="Lunch"
                value={product.lunchMinutes}
                suffix="min"
                onChange={(value) => onProductNumber("lunchMinutes", value)}
              />
              <NumericField
                label="Meetings"
                value={product.meetingMinutes}
                suffix="min"
                onChange={(value) => onProductNumber("meetingMinutes", value)}
              />
              <NumericField
                label="Planned Downtime"
                value={product.plannedDowntimeMinutes}
                suffix="min"
                onChange={(value) => onProductNumber("plannedDowntimeMinutes", value)}
              />
            </div>
          </SetupFieldGroup>
        </div>

        <SetupFieldGroup title="Calendar" description="Working pattern used for weekly and monthly capacity">
          <div className="grid gap-3 md:grid-cols-3">
            <NumericField
              label="Days / Week"
              value={product.workDaysPerWeek}
              suffix="days"
              precision={2}
              onChange={(value) => onProductNumber("workDaysPerWeek", value)}
            />
            <NumericField
              label="Weeks / Month"
              value={product.workWeeksPerMonth}
              suffix="wk"
              precision={2}
              onChange={(value) => onProductNumber("workWeeksPerMonth", value)}
            />
            <NumericField
              label="Days / Month"
              value={product.availableWorkDaysPerMonth}
              suffix="days"
              precision={1}
              readOnly
              onChange={() => undefined}
            />
          </div>
        </SetupFieldGroup>

      </div>
    </section>
  );
}

export function ProcedureChecksSetupPanel({
  product,
  onProductStepChecks,
  onConfirmAction,
}: {
  product: Product;
  onProductStepChecks: (definitions: ManufacturingStepCheckDefinition[]) => void;
  onConfirmAction: (message: FeedbackConfirm) => void;
}) {
  const checkDefinitions = getManufacturingStepCheckDefinitions(product.customFields);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});

  function setLabelDraft(key: string, value: string) {
    setLabelDrafts((current) => ({ ...current, [key]: value }));
  }

  function commitLabel(definition: ManufacturingStepCheckDefinition) {
    const draft = labelDrafts[definition.key];
    setLabelDrafts((current) => {
      if (!(definition.key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[definition.key];
      return next;
    });

    if (draft === undefined) {
      return;
    }

    const trimmed = draft.trim();
    if (!trimmed || trimmed === definition.label) {
      return;
    }

    updateCheckDefinition(definition.key, { label: trimmed });
  }

  function updateCheckDefinition(key: string, patch: Partial<ManufacturingStepCheckDefinition>) {
    onProductStepChecks(
      checkDefinitions.map((definition) =>
        definition.key === key
          ? {
              ...definition,
              ...patch,
            }
          : definition,
      ),
    );
  }

  function getUniqueCheckKey(label: string) {
    const baseKey = normalizeManufacturingStepCheck(label) || "custom_check";
    const existingKeys = new Set(checkDefinitions.map((definition) => definition.key));
    let candidate = baseKey;
    let index = 2;

    while (existingKeys.has(candidate)) {
      candidate = `${baseKey}_${index}`;
      index += 1;
    }

    return candidate;
  }

  function addCheckDefinition() {
    const label = "New check";
    onProductStepChecks([
      ...checkDefinitions,
      {
        key: getUniqueCheckKey(label),
        label,
        enabled: true,
        inputType: "checkbox",
      },
    ]);
  }

  function removeCheckDefinition(key: string) {
    setLabelDrafts((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    onProductStepChecks(checkDefinitions.filter((definition) => definition.key !== key));
  }

  return (
    <section className="ui-product-setup">
      <div className="ui-product-setup-head">
        <div>
          <h2 className="ui-section-title">Procedure Checks</h2>
          <div className="ui-section-subtitle">Choose the checks shown on manufacturing steps</div>
        </div>
        <button type="button" onClick={addCheckDefinition} className="ui-btn-ghost h-9 gap-2">
          <Plus size={15} strokeWidth={1.75} />
          Check
        </button>
      </div>

      <div className="ui-product-setup-body">
        <div className="ui-procedure-checks">
          {checkDefinitions.map((definition) => (
            <div
              key={definition.key}
              data-enabled={definition.enabled}
              className="ui-procedure-checks-row flex items-center gap-3"
            >
              <input
                type="checkbox"
                checked={definition.enabled}
                onChange={(event) => updateCheckDefinition(definition.key, { enabled: event.target.checked })}
                aria-label={`Enable ${definition.label}`}
              />
              <label className="min-w-0 flex-1">
                <span className="sr-only">Check name</span>
                <input
                  className="ui-procedure-step-inline-text w-full min-w-0 text-xs"
                  value={labelDrafts[definition.key] ?? definition.label}
                  onChange={(event) => setLabelDraft(definition.key, event.target.value)}
                  onBlur={() => commitLabel(definition)}
                />
              </label>
              {definition.inputType === "number" ? (
                <ThemedSelect
                  aria-label={`${definition.label} default unit`}
                  className="w-24 shrink-0"
                  triggerClassName="h-9"
                  value={definition.defaultUnit ?? definition.unitOptions?.[0] ?? "Nm"}
                  options={(definition.unitOptions?.length ? definition.unitOptions : ["Nm", "ft-lb"]).map((unit) => ({
                    value: unit,
                    label: unit,
                  }))}
                  onChange={(unit) => updateCheckDefinition(definition.key, { defaultUnit: unit })}
                />
              ) : null}
              <button
                type="button"
                className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded text-ink-tertiary transition hover:bg-danger-muted hover:text-danger"
                onClick={() =>
                  onConfirmAction({
                    title: `Remove ${definition.label}?`,
                    body: "This removes the check from manufacturing steps for this product.",
                    tone: "danger",
                    confirmLabel: "Remove Check",
                    onConfirm: () => removeCheckDefinition(definition.key),
                  })
                }
                aria-label={`Remove ${definition.label}`}
                title={`Remove ${definition.label}`}
              >
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function WorkInstructionsPanel({
  tasks,
  zones,
  product,
  initialPlannerState,
  hydratedTaskIds,
  onOpenTask,
}: {
  tasks: Task[];
  zones: Zone[];
  product: Product;
  initialPlannerState?: PlannerState;
  hydratedTaskIds?: ReadonlySet<string>;
  onOpenTask: (taskId: string) => void;
}) {
  const parentIds = new Set(tasks.map((task) => task.parentTaskId).filter((id): id is string => Boolean(id)));
  // One work instruction per leaf work-task (skip summary rows, milestones, holds, etc.).
  const workTasks = tasks.filter((task) => task.rowType === "task" && !parentIds.has(task.id));
  const checkDefinitions = getManufacturingStepCheckDefinitions(product.customFields);

  const hasWorkInstruction = (task: Task) => Boolean(task.workInstructionLink || task.sopLink);
  const hasTools = (task: Task) => countTaskStepTools(task) > 0;
  const hasChecks = (task: Task) =>
    (task.manufacturingSteps ?? []).some((step) => getManufacturingStepCheckState(step.qualityCheck, checkDefinitions).selected.size > 0);
  // Prerequisites for generating a work instruction: it needs tools AND a checklist first.
  const isReady = (task: Task) => hasTools(task) && hasChecks(task);

  const createdCount = workTasks.filter(hasWorkInstruction).length;
  const readyCount = workTasks.filter((task) => !hasWorkInstruction(task) && isReady(task)).length;
  const incompleteCount = workTasks.filter((task) => !hasWorkInstruction(task) && !isReady(task)).length;
  const [previewSelection, setPreviewSelection] = useState<{ taskIds: string[]; scenarioId?: string } | null>(null);

  const UNZONED_KEY = "__unzoned__";
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const grouped = new Map<string, Task[]>();
  workTasks.forEach((task) => {
    const key = task.zoneId && zoneById.has(task.zoneId) ? task.zoneId : UNZONED_KEY;
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  });
  const orderedZoneKeys = [
    ...zones.map((zone) => zone.id).filter((id) => grouped.has(id)),
    ...(grouped.has(UNZONED_KEY) ? [UNZONED_KEY] : []),
  ];

  function statusOf(task: Task) {
    if (hasWorkInstruction(task)) {
      return { label: "Created", className: "border-accent/30 bg-accent/5 text-ink-secondary" };
    }
    if (isReady(task)) {
      return { label: "Ready", className: "border-accent/50 bg-accent/10 text-ink" };
    }
    return { label: "Incomplete", className: "border-line bg-surface-raised text-ink-secondary" };
  }

  // The print route reloads planner state by project, so a product with no
  // project behind it cannot produce a shareable document.
  const projectId = product.projectId;

  // Batch preview stacks one document per task in a single print job, so a whole
  // line can go to the printer in one pass.
  const canPreviewAll = workTasks.length > 0;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="ui-section-title">Work Instructions</h2>
          <p className="ui-section-subtitle">
            {workTasks.length === 0
              ? "Add tasks in the Gantt to see the work instructions you need to build."
              : `${readyCount} of ${workTasks.length} ready to generate · ${incompleteCount} still need tools & checks.`}
          </p>
          <p className="text-xs text-ink-tertiary">
            A work instruction can be generated once its steps have both tools and a checklist assigned.
          </p>
        </div>
        {projectId ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canPreviewAll ? (
              <button
                type="button"
                className="ui-btn-ghost h-9 gap-2 px-3"
                onClick={() =>
                  setPreviewSelection({
                    taskIds: workTasks.map((task) => task.id),
                    scenarioId: workTasks[0]?.scenarioId,
                  })
                }
              >
                <Eye size={15} />
                Preview all ({workTasks.length})
              </button>
            ) : null}
            <Link
              href={`/projects/${projectId}/planner/work-instructions/print?blank=1`}
              target="_blank"
              className="ui-btn-ghost h-9 gap-2 px-3"
            >
              <FileText size={15} />
              Blank template
            </Link>
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Needed" value={String(workTasks.length)} meta="one per task" />
        <StatCard label="Ready" value={String(readyCount)} tone={readyCount > 0 ? "good" : "neutral"} meta="tools + checks done" />
        <StatCard label="Incomplete" value={String(incompleteCount)} tone={incompleteCount > 0 ? "warn" : "neutral"} meta="missing tools / checks" />
        <StatCard label="Created" value={String(createdCount)} meta="generated / linked" />
      </div>

      {workTasks.length === 0 ? null : (
        <div className="space-y-5">
          {orderedZoneKeys.map((zoneKey) => {
            const zone = zoneKey === UNZONED_KEY ? undefined : zoneById.get(zoneKey);
            const zoneTasks = grouped.get(zoneKey) ?? [];
            return (
              <section key={zoneKey} className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="ui-setup-section-title">{zone ? zone.name : "Unzoned"}</h3>
                  <span className="ui-section-subtitle">
                    {zoneTasks.length} task{zoneTasks.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-line">
                  {zoneTasks.map((task, index) => {
                    const status = statusOf(task);
                    return (
                      <div
                        key={task.id}
                        className={`flex w-full items-center gap-3 px-3 transition hover:bg-surface-raised ${
                          index > 0 ? "border-t border-line" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onOpenTask(task.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                        >
                          <span className="ui-mono-label w-32 shrink-0 truncate text-ink-secondary">
                            {task.manufacturingCode || "Uncoded"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{task.name}</span>
                          <span className="flex shrink-0 items-center gap-2 text-ink-tertiary">
                            <span
                              title={hasTools(task) ? "Tools assigned" : "No tools assigned"}
                              className={hasTools(task) ? "text-ink-secondary" : "opacity-30"}
                            >
                              <Wrench size={13} strokeWidth={1.75} />
                            </span>
                            <span
                              title={hasChecks(task) ? "Checks assigned" : "No checks assigned"}
                              className={hasChecks(task) ? "text-ink-secondary" : "opacity-30"}
                            >
                              <ListChecks size={13} strokeWidth={1.75} />
                            </span>
                          </span>
                          <span className={`ui-chip shrink-0 ${status.className}`}>
                            {status.label}
                          </span>
                        </button>
                        {projectId ? (
                          <button
                            type="button"
                            onClick={() => setPreviewSelection({ taskIds: [task.id], scenarioId: task.scenarioId })}
                            className="ui-btn-ghost h-7 shrink-0 gap-1.5 px-2 text-xs"
                            title={`Preview the work instruction for ${task.name}`}
                          >
                            <Eye size={13} />
                            Preview
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {projectId && previewSelection ? (
        <WorkInstructionPrintPreview
          projectId={projectId}
          taskIds={previewSelection.taskIds}
          scenarioId={previewSelection.scenarioId}
          initialPlannerState={
            previewSelection.taskIds.every((taskId) => hydratedTaskIds?.has(taskId))
              ? initialPlannerState
              : undefined
          }
          onClose={() => setPreviewSelection(null)}
        />
      ) : null}
    </div>
  );
}

export function NomenclatureSetupPanel({
  product,
  zones,
  tasks,
  components,
  documentTypes,
  onProductText,
  onUpdateZone,
  onAddComponent,
  onUpdateComponent,
  onDeleteComponent,
  onAddDocumentType,
  onUpdateDocumentType,
  onDeleteDocumentType,
  onAddMissingDefaultDocumentTypes,
}: {
  product: Product;
  zones: Zone[];
  tasks: Task[];
  components: ManufacturingComponent[];
  documentTypes: DocumentTypeCode[];
  onProductText: (field: ProductTextField, value: string) => void;
  onUpdateZone: (zoneId: string, patch: Partial<Zone>) => void;
  onAddComponent: () => void;
  onUpdateComponent: (componentId: string, patch: Partial<ManufacturingComponent>) => void;
  onDeleteComponent: (componentId: string) => void;
  onAddDocumentType: () => void;
  onUpdateDocumentType: (documentTypeId: string, patch: Partial<DocumentTypeCode>) => void;
  onDeleteDocumentType: (documentTypeId: string) => void;
  onAddMissingDefaultDocumentTypes: () => void;
}) {
  const duplicateCodeEntries = Array.from(
    tasks.reduce((codeMap, task) => {
      const code = task.manufacturingCode?.trim();
      if (!code) {
        return codeMap;
      }

      codeMap.set(code, [...(codeMap.get(code) ?? []), task]);
      return codeMap;
    }, new Map<string, Task[]>()),
  ).filter(([, codedTasks]) => codedTasks.length > 1);
  const uncodedTaskCount = tasks.filter((task) => !task.manufacturingCode?.trim()).length;

  const programCode = product.productCode?.trim().toUpperCase() || "FB-V2";
  const exampleComponent = components.find((component) => component.code?.trim())?.code?.trim().toUpperCase() || "CLU";
  const exampleZone = zones.find((zone) => zone.code?.trim())?.code?.trim().toUpperCase() || "SUB";
  const exampleDocType =
    documentTypes.find((documentType) => documentType.active && documentType.code?.trim())?.code?.trim().toUpperCase() ||
    documentTypes.find((documentType) => documentType.code?.trim())?.code?.trim().toUpperCase() ||
    "WI";
  const exampleDocName =
    documentTypes.find((documentType) => documentType.code?.trim().toUpperCase() === exampleDocType)?.name?.trim() || "Work Instruction";
  const nomenclatureSegments = [
    { value: exampleComponent, label: "Component", means: "Which system / assembly the work is on", source: "Component Codes (below)" },
    { value: exampleZone, label: "Zone", means: "Major process area — the middle segment", source: "Zone Codes (below)" },
    { value: "10", label: "Task #", means: "Sequential number for the task", source: "Auto-assigned in the Gantt" },
    { value: `${exampleDocType}1`, label: "Document", means: `${exampleDocName} + document number`, source: "Document Types (below)" },
    { value: "S10", label: "Step", means: "Step number inside the document", source: "Procedure tab" },
  ];

  return (
    <section className="ui-product-setup">
      <div className="ui-product-setup-head">
        <div>
          <h2 className="ui-section-title">Document Control</h2>
          <div className="ui-section-subtitle">Map product, zone, component, task, and document codes</div>
        </div>
      </div>

      <div className="ui-product-setup-body">
        <div className="ui-nomenclature-legend">
          <div className="ui-nomenclature-legend-head">
            <span className="ui-nomenclature-legend-eyebrow">Code anatomy</span>
            <span className="ui-nomenclature-legend-program">Program · {programCode}</span>
          </div>
          <div className="ui-nomenclature-legend-code" aria-hidden="true">
            {nomenclatureSegments.flatMap((segment, index) => {
              const token = (
                <span className="ui-nomenclature-seg" key={segment.label}>
                  <span className="ui-nomenclature-seg-value">{segment.value}</span>
                  <span className="ui-nomenclature-seg-label">{segment.label}</span>
                </span>
              );
              return index === 0
                ? [token]
                : [
                    <span className="ui-nomenclature-legend-sep" key={`sep-${segment.label}`}>
                      –
                    </span>,
                    token,
                  ];
            })}
          </div>
          <dl className="ui-nomenclature-legend-list">
            {nomenclatureSegments.map((segment, index) => (
              <div className="ui-nomenclature-legend-item" key={segment.label}>
                <span className="ui-nomenclature-legend-num">{index + 1}</span>
                <div className="min-w-0">
                  <dt className="ui-nomenclature-legend-term">
                    <span className="ui-nomenclature-legend-chip">{segment.value}</span>
                    {segment.label}
                  </dt>
                  <dd className="ui-nomenclature-legend-desc">
                    {segment.means}
                    <span className="ui-nomenclature-legend-source">{segment.source}</span>
                  </dd>
                </div>
              </div>
            ))}
          </dl>

          <p className="ui-nomenclature-legend-note">
            <span className="ui-nomenclature-legend-note-label">Where this code shows up</span>
            Printed on work instructions, travelers, and QC sheets — and used as the export file path, e.g.{" "}
            <code className="ui-nomenclature-legend-path">
              {programCode}/{exampleComponent}-{exampleZone}-10-{exampleDocType}1-S10
            </code>
          </p>
        </div>

        {duplicateCodeEntries.length || uncodedTaskCount ? (
          <div className="rounded border border-warn/35 bg-warn-muted px-3 py-2 text-sm font-semibold text-ink">
            {duplicateCodeEntries.length ? (
              <div>
                Duplicate task codes:{" "}
                {duplicateCodeEntries
                  .slice(0, 4)
                  .map(([code, codedTasks]) => `${code} (${codedTasks.length})`)
                  .join(", ")}
              </div>
            ) : null}
            {uncodedTaskCount ? <div>{uncodedTaskCount} task{uncodedTaskCount === 1 ? "" : "s"} still uncoded.</div> : null}
          </div>
        ) : null}

        <SetupFieldGroup title="Product Code" description="Top-level program code used in exports and document paths">
          <label className="block max-w-xs">
            <span className="ui-field-label">Product ID</span>
            <input
              className="ui-field-standalone font-mono uppercase"
              value={product.productCode ?? ""}
              onChange={(event) =>
                onProductText("productCode", event.target.value.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "").slice(0, 20))
              }
              placeholder="FB-V2"
            />
          </label>
        </SetupFieldGroup>

        <SetupFieldGroup title="Zone Codes" description="Major process zones used as the middle segment of task codes">
          <div className="overflow-hidden rounded border border-line bg-surface">
            <div className="grid grid-cols-[90px_minmax(180px,1fr)_minmax(220px,1.4fr)] gap-2 border-b border-line bg-surface-sunken px-3 py-2 ui-mono-label">
              <span>Code</span>
              <span>Zone</span>
              <span>Description</span>
            </div>
            {zones.map((zone) => (
              <div key={zone.id} className="grid grid-cols-[90px_minmax(180px,1fr)_minmax(220px,1.4fr)] gap-2 border-b border-line px-3 py-2 last:border-b-0">
                <input
                  className="ui-field-standalone h-8 font-mono uppercase"
                  value={zone.code ?? ""}
                  onChange={(event) => onUpdateZone(zone.id, { code: normalizeCode(event.target.value) })}
                  placeholder="SUB"
                />
                <input
                  className="ui-field-standalone h-8"
                  value={zone.name}
                  onChange={(event) => onUpdateZone(zone.id, { name: event.target.value })}
                />
                <input
                  className="ui-field-standalone h-8"
                  value={zone.description ?? ""}
                  onChange={(event) => onUpdateZone(zone.id, { description: event.target.value })}
                  placeholder="Optional description"
                />
              </div>
            ))}
            {zones.length === 0 ? <div className="px-3 py-3 text-sm font-semibold text-ink-secondary">Add zones in the Gantt before assigning zone codes.</div> : null}
          </div>
        </SetupFieldGroup>

        <SetupFieldGroup title="Component Codes" description="Reusable system/component codes assigned to tasks">
          <div className="overflow-hidden rounded border border-line bg-surface">
            <div className="grid grid-cols-[90px_minmax(180px,1fr)_54px] gap-2 border-b border-line bg-surface-sunken px-3 py-2 ui-mono-label">
              <span>Code</span>
              <span>Component</span>
              <span />
            </div>
            {components.map((component) => (
              <div key={component.id} className="grid grid-cols-[90px_minmax(180px,1fr)_54px] gap-2 border-b border-line px-3 py-2 last:border-b-0">
                <input
                  className="ui-field-standalone h-8 font-mono uppercase"
                  value={component.code}
                  onChange={(event) => onUpdateComponent(component.id, { code: normalizeCode(event.target.value) })}
                  placeholder="CLU"
                />
                <input
                  className="ui-field-standalone h-8"
                  value={component.name}
                  onChange={(event) => onUpdateComponent(component.id, { name: event.target.value })}
                  placeholder="Clutch Assembly"
                />
                <button
                  type="button"
                  onClick={() => onDeleteComponent(component.id)}
                  className="inline-flex h-8 items-center justify-center rounded border border-line bg-surface text-ink-secondary hover:border-danger hover:text-danger"
                  title="Delete component"
                  aria-label={`Delete ${component.name || component.code || "component"}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {components.length === 0 ? <div className="px-3 py-3 text-sm font-semibold text-ink-secondary">Add component codes such as CLU, ALT, BAT, or PNL.</div> : null}
          </div>
          <button type="button" onClick={onAddComponent} className="ui-btn-ghost mt-3 h-9 gap-2">
            <Plus size={14} />
            Component
          </button>
        </SetupFieldGroup>

        <SetupFieldGroup title="Document Types" description="Suffix codes for task documents and work instructions">
          <div className="overflow-hidden rounded border border-line bg-surface">
            <div className="grid grid-cols-[90px_minmax(180px,1fr)_54px] gap-2 border-b border-line bg-surface-sunken px-3 py-2 ui-mono-label">
              <span>Code</span>
              <span>Document Type</span>
              <span />
            </div>
            {documentTypes.map((documentType) => (
              <div key={documentType.id} className="grid grid-cols-[90px_minmax(180px,1fr)_54px] gap-2 border-b border-line px-3 py-2 last:border-b-0">
                <input
                  className="ui-field-standalone h-8 font-mono uppercase"
                  value={documentType.code}
                  onChange={(event) => onUpdateDocumentType(documentType.id, { code: normalizeCode(event.target.value) })}
                  placeholder="WI"
                />
                <input
                  className="ui-field-standalone h-8"
                  value={documentType.name}
                  onChange={(event) => onUpdateDocumentType(documentType.id, { name: event.target.value })}
                  placeholder="Work Instruction"
                />
                <button
                  type="button"
                  onClick={() => onDeleteDocumentType(documentType.id)}
                  className="inline-flex h-8 items-center justify-center rounded border border-line bg-surface text-ink-secondary hover:border-danger hover:text-danger"
                  title="Delete document type"
                  aria-label={`Delete ${documentType.name || documentType.code || "document type"}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onAddDocumentType} className="ui-btn-ghost h-9 gap-2">
              <Plus size={14} />
              Document Type
            </button>
            <button type="button" onClick={onAddMissingDefaultDocumentTypes} className="ui-btn-ghost h-9 gap-2">
              Defaults
            </button>
          </div>
        </SetupFieldGroup>
      </div>
    </section>
  );
}
