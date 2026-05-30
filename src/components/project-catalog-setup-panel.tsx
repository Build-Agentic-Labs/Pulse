"use client";

import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  buildProjectPartCatalog,
  buildProjectToolCatalog,
  type ProjectPartCatalogEntry,
  type ProjectToolCatalogEntry,
} from "@/domain/project-catalog";
import type { ProjectToolDefinition } from "@/domain/tool-registry";
import { TOOL_TYPE_OPTIONS, type ToolTypeValue } from "@/domain/tool-types";
import type { Task } from "@/domain/types";
import { ClearableNumberInput } from "./clearable-number-input";
import type { FeedbackConfirm } from "./themed-feedback";
import { ThemedSelect } from "./themed-select";

type ToolDraft = {
  name: string;
  category: ToolTypeValue;
};

type PartDraft = {
  partNumber: string;
  description: string;
  quantity: number;
  disposition: string;
};

function partDraftKey(entry: ProjectPartCatalogEntry) {
  return `${entry.taskId}:${entry.part.id}`;
}

export function ProjectCatalogSetupPanel({
  tasks,
  projectToolRegistry,
  section = "all",
  onSaveTool,
  onDeleteTool,
  onSavePart,
  onDeletePart,
  onConfirmAction,
}: {
  tasks: Task[];
  projectToolRegistry: Map<string, ProjectToolDefinition>;
  section?: "tools" | "parts" | "all";
  onSaveTool: (entry: ProjectToolCatalogEntry, draft: ToolDraft) => Promise<void>;
  onDeleteTool: (entry: ProjectToolCatalogEntry) => Promise<void>;
  onSavePart: (entry: ProjectPartCatalogEntry, draft: PartDraft) => Promise<void>;
  onDeletePart: (entry: ProjectPartCatalogEntry) => Promise<void>;
  onConfirmAction: (message: FeedbackConfirm) => void;
}) {
  const showTools = section !== "parts";
  const showParts = section !== "tools";
  const toolCatalog = useMemo(
    () => buildProjectToolCatalog(tasks, projectToolRegistry),
    [projectToolRegistry, tasks],
  );
  const partCatalog = useMemo(() => buildProjectPartCatalog(tasks), [tasks]);
  const [toolDrafts, setToolDrafts] = useState<Record<string, ToolDraft>>({});
  const [partDrafts, setPartDrafts] = useState<Record<string, PartDraft>>({});
  const [savingToolKey, setSavingToolKey] = useState<string>();
  const [savingPartKey, setSavingPartKey] = useState<string>();
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [partsCollapsed, setPartsCollapsed] = useState(false);

  useEffect(() => {
    setToolDrafts((current) => {
      const next: Record<string, ToolDraft> = {};

      toolCatalog.forEach((entry) => {
        next[entry.key] = current[entry.key] ?? {
          name: entry.name,
          category: entry.category,
        };
      });

      return next;
    });
  }, [toolCatalog]);

  useEffect(() => {
    setPartDrafts((current) => {
      const next: Record<string, PartDraft> = {};

      partCatalog.forEach((entry) => {
        const key = partDraftKey(entry);
        next[key] = current[key] ?? {
          partNumber: entry.part.partNumber,
          description: entry.part.description ?? "",
          quantity: entry.part.quantity ?? 0,
          disposition: entry.part.disposition ?? "",
        };
      });

      return next;
    });
  }, [partCatalog]);

  function updateToolDraft(key: string, patch: Partial<ToolDraft>) {
    setToolDrafts((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...patch,
      },
    }));
  }

  function updatePartDraft(key: string, patch: Partial<PartDraft>) {
    setPartDrafts((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...patch,
      },
    }));
  }

  function toolDraftChanged(entry: ProjectToolCatalogEntry, draft: ToolDraft) {
    return draft.name.trim() !== entry.name || draft.category !== entry.category;
  }

  function partDraftChanged(entry: ProjectPartCatalogEntry, draft: PartDraft) {
    return (
      draft.partNumber.trim() !== entry.part.partNumber ||
      draft.description.trim() !== (entry.part.description ?? "") ||
      draft.quantity !== (entry.part.quantity ?? 0) ||
      draft.disposition.trim() !== (entry.part.disposition ?? "")
    );
  }

  async function commitToolDraft(entry: ProjectToolCatalogEntry, draft?: ToolDraft) {
    const nextDraft = draft ?? toolDrafts[entry.key];
    if (!nextDraft || !toolDraftChanged(entry, nextDraft) || savingToolKey === entry.key) {
      return;
    }

    setSavingToolKey(entry.key);
    try {
      await onSaveTool(entry, {
        name: nextDraft.name.trim(),
        category: nextDraft.category,
      });
    } finally {
      setSavingToolKey(undefined);
    }
  }

  async function commitPartDraft(entry: ProjectPartCatalogEntry, draft?: PartDraft) {
    const key = partDraftKey(entry);
    const nextDraft = draft ?? partDrafts[key];
    if (!nextDraft || !partDraftChanged(entry, nextDraft) || savingPartKey === key) {
      return;
    }

    setSavingPartKey(key);
    try {
      await onSavePart(entry, {
        partNumber: nextDraft.partNumber.trim(),
        description: nextDraft.description.trim(),
        quantity: nextDraft.quantity,
        disposition: nextDraft.disposition.trim(),
      });
    } finally {
      setSavingPartKey(undefined);
    }
  }

  function requestDeleteTool(entry: ProjectToolCatalogEntry) {
    onConfirmAction({
      title: `Remove ${entry.name}?`,
      body: `This removes the tool from ${entry.stepUsageCount} step assignment(s) across ${entry.taskUsageCount} task(s).`,
      tone: "danger",
      confirmLabel: "Remove Tool",
      onConfirm: () => onDeleteTool(entry),
    });
  }

  function requestDeletePart(entry: ProjectPartCatalogEntry) {
    onConfirmAction({
      title: `Remove ${entry.part.partNumber || "this part"}?`,
      body: entry.linkedStepCount
        ? `This unlinks the part from ${entry.linkedStepCount} manufacturing step(s) on ${entry.taskLabel}.`
        : `This removes the part from ${entry.taskLabel}.`,
      tone: "danger",
      confirmLabel: "Remove Part",
      onConfirm: () => onDeletePart(entry),
    });
  }

  return (
    <div className="ui-procedure-catalog mx-auto max-w-[1500px] space-y-5">
      {showTools ? (
      <section>
        <button
          type="button"
          className="ui-catalog-collapse-trigger mb-3"
          onClick={() => setToolsCollapsed((collapsed) => !collapsed)}
          aria-expanded={!toolsCollapsed}
        >
          <span className="min-w-0">
            <span className="ui-setup-section-title block">Tools</span>
            <span className="ui-setup-section-desc block">
              {toolCatalog.length} tool{toolCatalog.length === 1 ? "" : "s"} in this build. IDs and colors stay stable across tasks.
            </span>
          </span>
          <span className="ui-catalog-collapse-meta">
            {toolCatalog.length}
            {toolsCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>

        {toolsCollapsed ? null : toolCatalog.length === 0 ? (
          <div className="ui-procedure-empty">Tools added to procedure steps will appear here for cleanup and renaming.</div>
        ) : (
          <div className="ui-procedure-tool-table-wrap">
            <table className="ui-procedure-tool-table">
              <thead>
                <tr>
                  <th className="ui-procedure-tool-table-head w-[72px]">Tool ID</th>
                  <th className="ui-procedure-tool-table-head">Tool name</th>
                  <th className="ui-procedure-tool-table-head w-[132px]">Type</th>
                  <th className="ui-procedure-tool-table-head w-[132px]">Color</th>
                  <th className="ui-procedure-tool-table-head w-[120px]">Usage</th>
                  <th className="ui-procedure-tool-table-head w-8" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {toolCatalog.map((entry) => {
                  const draft = toolDrafts[entry.key] ?? {
                    name: entry.name,
                    category: entry.category,
                  };

                  return (
                    <tr key={entry.key} className="ui-procedure-tool-table-row group">
                      <td className="ui-procedure-tool-table-cell ui-mono-label tabular-nums text-ink-secondary">
                        {entry.id}
                      </td>
                      <td className="ui-procedure-tool-table-cell">
                        <input
                          className="ui-procedure-step-inline-text w-full min-w-0"
                          value={draft.name}
                          onChange={(event) => updateToolDraft(entry.key, { name: event.target.value })}
                          onBlur={() => void commitToolDraft(entry)}
                          aria-label={`Tool name for ${entry.id}`}
                        />
                      </td>
                      <td className="ui-procedure-tool-table-cell">
                        <ThemedSelect
                          className="w-full min-w-0"
                          triggerClassName="h-8 rounded-none border-0 border-b bg-transparent px-0 text-xs"
                          value={draft.category}
                          options={TOOL_TYPE_OPTIONS}
                          onChange={(value) => {
                            const category = value as ToolTypeValue;
                            const nextDraft = { ...draft, category };
                            updateToolDraft(entry.key, { category });
                            void commitToolDraft(entry, nextDraft);
                          }}
                          aria-label={`Tool type for ${entry.name}`}
                        />
                      </td>
                      <td className="ui-procedure-tool-table-cell">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-line/70"
                            style={{ backgroundColor: entry.color }}
                            aria-hidden="true"
                          />
                          <span className="ui-section-subtitle truncate">{entry.colorLabel}</span>
                        </span>
                      </td>
                      <td className="ui-procedure-tool-table-cell ui-section-subtitle">
                        {entry.stepUsageCount} step{entry.stepUsageCount === 1 ? "" : "s"}
                        <span className="text-ink-tertiary"> · </span>
                        {entry.taskUsageCount} task{entry.taskUsageCount === 1 ? "" : "s"}
                      </td>
                      <td className="ui-procedure-tool-table-cell text-right">
                        <button
                          type="button"
                          onClick={() => requestDeleteTool(entry)}
                          className="ui-procedure-tool-table-remove"
                          aria-label={`Remove ${entry.name}`}
                          title={`Remove ${entry.name}`}
                        >
                          <Trash2 size={10} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      ) : null}

      {showParts ? (
      <section>
        <button
          type="button"
          className="ui-catalog-collapse-trigger mb-3"
          onClick={() => setPartsCollapsed((collapsed) => !collapsed)}
          aria-expanded={!partsCollapsed}
        >
          <span className="min-w-0">
            <span className="ui-setup-section-title block">BOM</span>
            <span className="ui-setup-section-desc block">
              {partCatalog.length} part{partCatalog.length === 1 ? "" : "s"} across all sub-assemblies.
            </span>
          </span>
          <span className="ui-catalog-collapse-meta">
            {partCatalog.length}
            {partsCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>

        {partsCollapsed ? null : partCatalog.length === 0 ? (
          <div className="ui-procedure-empty">Parts added in procedure steps will appear here for cleanup.</div>
        ) : (
          <div className="ui-procedure-part-editor">
            {partCatalog.map((entry) => {
              const key = partDraftKey(entry);
              const draft = partDrafts[key] ?? {
                partNumber: entry.part.partNumber,
                description: entry.part.description ?? "",
                quantity: entry.part.quantity ?? 0,
                disposition: entry.part.disposition ?? "",
              };

              return (
                <div key={key} className="ui-procedure-part-row group">
                  <div className="ui-procedure-catalog-part-meta">
                    <span className="ui-section-subtitle">{entry.taskLabel}</span>
                    <div className="flex items-center gap-3">
                      <span className="ui-metric-card-meta tabular-nums">
                        {entry.linkedStepCount} step{entry.linkedStepCount === 1 ? "" : "s"}
                      </span>
                      <button
                        type="button"
                        onClick={() => requestDeletePart(entry)}
                        className="ui-procedure-tool-table-remove opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Remove ${entry.part.partNumber || "part"}`}
                        title={`Remove ${entry.part.partNumber || "part"}`}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  <label className="block min-w-0">
                    <span className="ui-field-label">Part Number</span>
                    <input
                      className="ui-procedure-step-inline-text w-full min-w-0"
                      value={draft.partNumber}
                      onChange={(event) => updatePartDraft(key, { partNumber: event.target.value })}
                      onBlur={() => void commitPartDraft(entry)}
                      placeholder="Part number"
                    />
                  </label>
                  <label className="block">
                    <span className="ui-field-label">Qty</span>
                    <ClearableNumberInput
                      className="number-input ui-procedure-step-inline-value"
                      value={draft.quantity}
                      min={0}
                      fallbackValue={draft.quantity}
                      precision={0}
                      normalize={Math.round}
                      onValueChange={(value) => {
                        updatePartDraft(key, { quantity: value });
                      }}
                      onBlur={() => void commitPartDraft(entry)}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="ui-field-label">Description</span>
                    <input
                      className="ui-procedure-step-inline-text w-full min-w-0"
                      value={draft.description}
                      onChange={(event) => updatePartDraft(key, { description: event.target.value })}
                      onBlur={() => void commitPartDraft(entry)}
                      placeholder="Description"
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="ui-field-label">Disposition / Note</span>
                    <input
                      className="ui-procedure-step-inline-text w-full min-w-0"
                      value={draft.disposition}
                      onChange={(event) => updatePartDraft(key, { disposition: event.target.value })}
                      onBlur={() => void commitPartDraft(entry)}
                      placeholder="Note"
                    />
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </section>
      ) : null}
    </div>
  );
}
