"use client";

import { ChevronDown, ChevronRight, FileSpreadsheet, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import type { MasterBom } from "@/domain/master-bom";
import {
  buildProjectPartCatalog,
  buildProjectToolCatalog,
  groupToolCatalogByType,
  planToolNameTidy,
  type ProjectPartCatalogEntry,
  type ProjectToolCatalogEntry,
} from "@/domain/project-catalog";
import type { ToolLibraryItem } from "@/domain/supabase-planner";
import { formatToolName } from "@/domain/tool-name-format";
import type { ProjectToolDefinition } from "@/domain/tool-registry";
import { TOOL_TYPE_OPTIONS, type ToolTypeValue } from "@/domain/tool-types";
import type { Task } from "@/domain/types";
import { parseBomFile } from "@/lib/parse-bom";
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

function MasterBomPanel({
  masterBom,
  onChange,
  onConfirmAction,
}: {
  masterBom?: MasterBom;
  onChange: (bom: MasterBom | undefined) => void;
  onConfirmAction: (message: FeedbackConfirm) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();

  async function ingest(file: File) {
    setError(undefined);
    setUploading(true);
    try {
      const parsed = await parseBomFile(file);
      if (parsed.columns.length === 0) {
        setError("No columns found in that file.");
        return;
      }
      onChange(parsed);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Could not read that file.");
    } finally {
      setUploading(false);
    }
  }

  function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    if (masterBom) {
      onConfirmAction({
        title: "Replace master BOM?",
        body: `This replaces the current BOM (${masterBom.rows.length} row${masterBom.rows.length === 1 ? "" : "s"}) with “${file.name}”.`,
        tone: "danger",
        confirmLabel: "Replace",
        onConfirm: () => void ingest(file),
      });
    } else {
      void ingest(file);
    }
  }

  function requestClear() {
    onConfirmAction({
      title: "Remove master BOM?",
      body: "This clears the uploaded BOM from this product.",
      tone: "danger",
      confirmLabel: "Remove",
      onConfirm: () => onChange(undefined),
    });
  }

  const uploadedLabel = masterBom?.uploadedAt ? new Date(masterBom.uploadedAt).toLocaleDateString() : undefined;

  return (
    <section className="mb-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="ui-setup-section-title block">Master BOM</span>
          <span className="ui-setup-section-desc block">
            {masterBom
              ? `${masterBom.fileName ?? "BOM"} · ${masterBom.rows.length} part${masterBom.rows.length === 1 ? "" : "s"}${
                  uploadedLabel ? ` · uploaded ${uploadedLabel}` : ""
                }`
              : "Upload a bill of materials (.xlsx or .csv) to use when assigning parts."}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {masterBom ? (
            <button type="button" onClick={requestClear} className="ui-btn-ghost h-9 gap-2 px-2 text-xs">
              <Trash2 size={14} />
              Clear
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="ui-btn-ghost h-9 gap-2"
          >
            <Upload size={15} />
            {uploading ? "Reading…" : masterBom ? "Replace" : "Upload BOM"}
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileSelected} />

      {error ? (
        <div className="mb-3 rounded border border-danger/40 bg-danger-muted px-3 py-2 text-xs font-semibold text-ink">{error}</div>
      ) : null}

      {masterBom ? (
        <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: "28rem" }}>
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-surface-raised">
              <tr>
                {masterBom.columns.map((column) => (
                  <th
                    key={column}
                    className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left text-ink-secondary"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {masterBom.rows.map((row, index) => (
                <tr key={index} className="border-b border-line/60 last:border-b-0 hover:bg-surface-raised/50">
                  {masterBom.columns.map((column) => (
                    <td key={column} className="max-w-[22rem] truncate px-3 py-1.5 text-ink" title={row[column]}>
                      {row[column]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ui-procedure-empty flex items-center gap-2">
          <FileSpreadsheet size={15} className="shrink-0 text-ink-tertiary" />
          No BOM uploaded yet.
        </div>
      )}
    </section>
  );
}

export function ProjectCatalogSetupPanel({
  tasks,
  projectToolRegistry,
  toolLibraryItems = [],
  section = "all",
  masterBom,
  onMasterBomChange,
  onSaveTool,
  onDeleteTool,
  onTidyToolNames,
  onSavePart,
  onDeletePart,
  onConfirmAction,
}: {
  tasks: Task[];
  projectToolRegistry: Map<string, ProjectToolDefinition>;
  toolLibraryItems?: ToolLibraryItem[];
  section?: "tools" | "parts" | "all";
  masterBom?: MasterBom;
  onMasterBomChange?: (bom: MasterBom | undefined) => void;
  onSaveTool: (entry: ProjectToolCatalogEntry, draft: ToolDraft) => Promise<void>;
  onDeleteTool: (entry: ProjectToolCatalogEntry) => Promise<void>;
  onTidyToolNames?: (plan: Array<{ from: string; to: string }>) => Promise<void>;
  onSavePart: (entry: ProjectPartCatalogEntry, draft: PartDraft) => Promise<void>;
  onDeletePart: (entry: ProjectPartCatalogEntry) => Promise<void>;
  onConfirmAction: (message: FeedbackConfirm) => void;
}) {
  const showTools = section !== "parts";
  const showParts = section !== "tools";
  const toolCatalog = useMemo(
    () => buildProjectToolCatalog(tasks, projectToolRegistry, toolLibraryItems),
    [projectToolRegistry, tasks, toolLibraryItems],
  );
  const toolGroups = useMemo(() => groupToolCatalogByType(toolCatalog), [toolCatalog]);
  const tidyPlan = useMemo(() => planToolNameTidy(toolCatalog), [toolCatalog]);
  const partCatalog = useMemo(() => buildProjectPartCatalog(tasks), [tasks]);
  const [toolDrafts, setToolDrafts] = useState<Record<string, ToolDraft>>({});
  const [partDrafts, setPartDrafts] = useState<Record<string, PartDraft>>({});
  const [savingToolKey, setSavingToolKey] = useState<string>();
  const [savingPartKey, setSavingPartKey] = useState<string>();
  const [tidying, setTidying] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [partsCollapsed, setPartsCollapsed] = useState(false);

  async function handleTidyToolNames() {
    if (!onTidyToolNames || tidyPlan.length === 0 || tidying) {
      return;
    }
    setTidying(true);
    try {
      await onTidyToolNames(tidyPlan);
    } finally {
      setTidying(false);
    }
  }

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
    return formatToolName(draft.name) !== entry.name || draft.category !== entry.category;
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
    if (!nextDraft || savingToolKey === entry.key) {
      return;
    }

    const formattedName = formatToolName(nextDraft.name);

    // Reject a blank edit: revert the field to the current name and stop.
    if (!formattedName) {
      updateToolDraft(entry.key, { name: entry.name });
      return;
    }

    if (!toolDraftChanged(entry, nextDraft)) {
      // No semantic change — still snap the field to its canonical form.
      if (nextDraft.name !== formattedName) {
        updateToolDraft(entry.key, { name: formattedName });
      }
      return;
    }

    setSavingToolKey(entry.key);
    try {
      await onSaveTool(entry, {
        name: formattedName,
        category: nextDraft.category,
      });
      updateToolDraft(entry.key, { name: formattedName });
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

  function renderToolRow(entry: ProjectToolCatalogEntry) {
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
  }

  return (
    <div className="ui-procedure-catalog mx-auto max-w-[1500px] space-y-5">
      {showTools ? (
      <section>
        <div className="mb-3 flex items-start gap-2">
          <button
            type="button"
            className="ui-catalog-collapse-trigger flex-1"
            onClick={() => setToolsCollapsed((collapsed) => !collapsed)}
            aria-expanded={!toolsCollapsed}
          >
            <span className="min-w-0">
              <span className="ui-setup-section-title block">Tools</span>
              <span className="ui-setup-section-desc block">
                {toolCatalog.length} tool{toolCatalog.length === 1 ? "" : "s"} in this build, grouped by type. IDs and colors stay stable across tasks.
              </span>
            </span>
            <span className="ui-catalog-collapse-meta">
              {toolCatalog.length}
              {toolsCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
          {onTidyToolNames && tidyPlan.length > 0 ? (
            <button
              type="button"
              onClick={handleTidyToolNames}
              disabled={tidying}
              className="ui-btn-ghost h-9 shrink-0 gap-2 self-center px-2.5 text-xs disabled:opacity-60"
              title={`Clean up casing and spacing on ${tidyPlan.length} tool name${tidyPlan.length === 1 ? "" : "s"}. Letters are never changed.`}
            >
              <Sparkles size={14} />
              {tidying ? "Tidying…" : `Tidy names (${tidyPlan.length})`}
            </button>
          ) : null}
        </div>

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
              {toolGroups.map((group) => (
                <tbody key={group.type} className="ui-procedure-tool-table-group">
                  <tr className="ui-procedure-tool-table-subhead">
                    <th scope="colgroup" colSpan={6} className="ui-procedure-tool-table-subhead-cell">
                      {group.label}
                      <span className="ui-procedure-tool-table-subhead-count">{group.count}</span>
                    </th>
                  </tr>
                  {group.entries.map((entry) => renderToolRow(entry))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>
      ) : null}

      {showParts ? (
      <>
      {onMasterBomChange ? (
        <MasterBomPanel masterBom={masterBom} onChange={onMasterBomChange} onConfirmAction={onConfirmAction} />
      ) : null}
      <section>
        <button
          type="button"
          className="ui-catalog-collapse-trigger mb-3"
          onClick={() => setPartsCollapsed((collapsed) => !collapsed)}
          aria-expanded={!partsCollapsed}
        >
          <span className="min-w-0">
            <span className="ui-setup-section-title block">Parts in use</span>
            <span className="ui-setup-section-desc block">
              {partCatalog.length} part{partCatalog.length === 1 ? "" : "s"} referenced on tasks.
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
      </>
      ) : null}
    </div>
  );
}
