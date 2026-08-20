"use client";

import { ChevronDown, ChevronRight, FileSpreadsheet, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { detectBomFieldColumns, type MasterBom } from "@/domain/master-bom";
import {
  buildProjectToolCatalog,
  groupToolCatalogByType,
  planToolNameTidy,
  type ProjectToolCatalogEntry,
} from "@/domain/project-catalog";
import type { ToolLibraryItem } from "@/domain/supabase-planner";
import { formatToolName } from "@/domain/tool-name-format";
import type { ProjectToolDefinition } from "@/domain/tool-registry";
import { TOOL_TYPE_OPTIONS, type ToolTypeValue } from "@/domain/tool-types";
import type { Task } from "@/domain/types";
import { parseBomFile } from "@/lib/parse-bom";
import type { FeedbackConfirm } from "./themed-feedback";
import { ThemedSelect } from "./themed-select";

type ToolDraft = {
  name: string;
  category: ToolTypeValue;
};

const EMPTY_TOOL_LIBRARY_ITEMS: ToolLibraryItem[] = [];

type MasterBomSavePhase = "idle" | "reading" | "saving" | "saved" | "error";

type MasterBomTableColumn =
  | { key: string; kind: "source"; name: string }
  | { key: "allocation"; kind: "allocation" };

function normalizePartNumber(partNumber: string) {
  return partNumber.trim().toLocaleLowerCase();
}

export function MasterBomPanel({
  masterBom,
  tasks = [],
  onChange,
  onConfirmAction,
}: {
  masterBom?: MasterBom;
  tasks?: Task[];
  onChange: (bom: MasterBom | undefined) => Promise<void>;
  onConfirmAction: (message: FeedbackConfirm) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedStatusTimerRef = useRef<number | null>(null);
  const [savePhase, setSavePhase] = useState<MasterBomSavePhase>("idle");
  const [error, setError] = useState<string>();
  const [retryRequest, setRetryRequest] = useState<{ bom: MasterBom | undefined }>();
  const [searchQuery, setSearchQuery] = useState("");

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const hasSearchQuery = normalizedSearchQuery.length > 0;
  const visibleBomColumns = useMemo(
    () => masterBom?.columns.filter((column) => column.trim().toLocaleLowerCase() !== "warning") ?? [],
    [masterBom],
  );
  const bomFieldColumns = useMemo(() => detectBomFieldColumns(masterBom?.columns ?? []), [masterBom]);
  const allocationByPartNumber = useMemo(() => {
    const labelsByPartNumber = new Map<string, Map<string, string>>();

    tasks.forEach((task) => {
      const partById = new Map((task.partReferences ?? []).map((part) => [part.id, part]));
      (task.manufacturingSteps ?? []).forEach((step) => {
        (step.partReferenceIds ?? []).forEach((partReferenceId) => {
          const part = partById.get(partReferenceId);
          const partNumberKey = part ? normalizePartNumber(part.partNumber) : "";
          if (!partNumberKey) {
            return;
          }

          const labels = labelsByPartNumber.get(partNumberKey) ?? new Map<string, string>();
          const stepKey = `${task.id}:${step.id}`;
          const stepName = step.name?.trim();
          labels.set(
            stepKey,
            `${task.wbs} · ${task.name} · Step ${step.sequence}${stepName ? ` · ${stepName}` : ""}`,
          );
          labelsByPartNumber.set(partNumberKey, labels);
        });
      });
    });

    return new Map(
      [...labelsByPartNumber.entries()].map(([partNumber, labels]) => [partNumber, [...labels.values()]] as const),
    );
  }, [tasks]);
  const tableColumns = useMemo<MasterBomTableColumn[]>(() => {
    const columns: MasterBomTableColumn[] = [];
    let allocationInserted = false;

    visibleBomColumns.forEach((column, index) => {
      columns.push({ key: `source-${index}`, kind: "source", name: column });
      if (column === bomFieldColumns.description) {
        columns.push({ key: "allocation", kind: "allocation" });
        allocationInserted = true;
      }
    });

    if (!allocationInserted) {
      columns.push({ key: "allocation", kind: "allocation" });
    }
    return columns;
  }, [bomFieldColumns.description, visibleBomColumns]);
  const filteredBomRows = useMemo(() => {
    if (!masterBom) {
      return [];
    }

    const searchTerms = normalizedSearchQuery ? normalizedSearchQuery.split(/\s+/) : [];
    return masterBom.rows
      .map((row, rowIndex) => {
        const partNumber = bomFieldColumns.partNumber ? row[bomFieldColumns.partNumber] ?? "" : "";
        const allocationLabels = allocationByPartNumber.get(normalizePartNumber(partNumber)) ?? [];
        return { row, rowIndex, allocationLabels };
      })
      .filter(({ row, allocationLabels }) => {
        if (searchTerms.length === 0) {
          return true;
        }
        const searchableText = visibleBomColumns
          .map((column) => row[column] ?? "")
          .concat(allocationLabels.length > 0 ? ["allocated", ...allocationLabels] : ["unassigned"])
          .join("\u0000")
          .toLocaleLowerCase();
        return searchTerms.every((term) => searchableText.includes(term));
      });
  }, [allocationByPartNumber, bomFieldColumns.partNumber, masterBom, normalizedSearchQuery, visibleBomColumns]);

  useEffect(
    () => () => {
      if (savedStatusTimerRef.current) {
        window.clearTimeout(savedStatusTimerRef.current);
      }
    },
    [],
  );

  function clearSavedStatusTimer() {
    if (savedStatusTimerRef.current) {
      window.clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = null;
    }
  }

  async function persistBom(bom: MasterBom | undefined) {
    clearSavedStatusTimer();
    setError(undefined);
    setRetryRequest(undefined);
    setSavePhase("saving");
    try {
      await onChange(bom);
      setSearchQuery("");
      setSavePhase("saved");
      savedStatusTimerRef.current = window.setTimeout(() => {
        setSavePhase("idle");
        savedStatusTimerRef.current = null;
      }, 3200);
    } catch (saveError) {
      setRetryRequest({ bom });
      setError(saveError instanceof Error ? saveError.message : "The master BOM could not be saved.");
      setSavePhase("error");
    }
  }

  async function ingest(file: File) {
    clearSavedStatusTimer();
    setError(undefined);
    setRetryRequest(undefined);
    setSavePhase("reading");
    try {
      const parsed = await parseBomFile(file);
      if (parsed.columns.length === 0) {
        setError("No columns found in that file.");
        setSavePhase("error");
        return;
      }
      await persistBom(parsed);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Could not read that file.");
      setSavePhase("error");
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
      onConfirm: () => void persistBom(undefined),
    });
  }

  const uploadedLabel = masterBom?.uploadedAt ? new Date(masterBom.uploadedAt).toLocaleDateString() : undefined;
  const isBusy = savePhase === "reading" || savePhase === "saving";
  const statusLabel =
    savePhase === "reading" ? "Reading file…" : savePhase === "saving" ? "Saving…" : savePhase === "saved" ? "Saved" : undefined;

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
          {statusLabel ? (
            <span className="px-2 text-xs font-semibold text-ink-secondary" role="status" aria-live="polite">
              {statusLabel}
            </span>
          ) : null}
          {masterBom ? (
            <button type="button" onClick={requestClear} disabled={isBusy} className="ui-btn-ghost h-9 gap-2 px-2 text-xs">
              <Trash2 size={14} />
              Clear
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className="ui-btn-ghost h-9 gap-2"
          >
            <Upload size={15} />
            {savePhase === "reading" ? "Reading…" : savePhase === "saving" ? "Saving…" : masterBom ? "Replace" : "Upload BOM"}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.csv"
        aria-label="Master BOM file"
        className="hidden"
        onChange={handleFileSelected}
      />

      {error ? (
        <div
          className="mb-3 flex items-center justify-between gap-3 rounded border border-danger/40 bg-danger-muted px-3 py-2 text-xs font-semibold text-ink"
          role="alert"
        >
          <span>{error}</span>
          {retryRequest ? (
            <button
              type="button"
              className="ui-btn-ghost h-7 shrink-0 px-2 text-xs"
              onClick={() => void persistBom(retryRequest.bom)}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {masterBom ? (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="relative min-w-[16rem] flex-1 sm:max-w-md">
              <Search
                size={14}
                strokeWidth={1.75}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
                aria-hidden="true"
              />
              <input
                type="text"
                role="searchbox"
                className="ui-field-standalone h-9 w-full pl-9 pr-9 text-xs font-normal"
                placeholder="Search BOM or allocations…"
                aria-label="Search master BOM"
                aria-describedby="master-bom-search-results"
                autoComplete="off"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchQuery("");
                  }
                }}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="ui-btn-ghost absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 justify-center px-0 text-ink-tertiary"
                  aria-label="Clear BOM search"
                  onClick={() => setSearchQuery("")}
                >
                  <X size={13} strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
            <span
              id="master-bom-search-results"
              className="text-xs font-medium tabular-nums text-ink-tertiary"
              aria-live="polite"
            >
              {hasSearchQuery
                ? `${filteredBomRows.length} of ${masterBom.rows.length} rows`
                : `${masterBom.rows.length} row${masterBom.rows.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <div
            className="overflow-auto rounded-lg border border-line"
            style={{ maxHeight: "calc(100dvh - 13.5rem)" }}
          >
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-surface-raised">
                <tr>
                  {tableColumns.map((column) => (
                    <th
                      key={column.key}
                      className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left text-ink-secondary"
                    >
                      {column.kind === "allocation" ? "Allocated" : column.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredBomRows.length > 0 ? (
                  filteredBomRows.map(({ row, rowIndex, allocationLabels }) => (
                    <tr key={rowIndex} className="border-b border-line/60 last:border-b-0 hover:bg-surface-raised/50">
                      {tableColumns.map((column) =>
                        column.kind === "allocation" ? (
                          <td key={column.key} className="whitespace-nowrap px-3 py-1.5">
                            {allocationLabels.length > 0 ? (
                              <span
                                className="inline-flex items-center gap-1.5 font-semibold text-success"
                                title={allocationLabels.join("\n")}
                                aria-label={`${allocationLabels.length} allocated step${allocationLabels.length === 1 ? "" : "s"}`}
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                                {allocationLabels.length} step{allocationLabels.length === 1 ? "" : "s"}
                              </span>
                            ) : (
                              <span className="text-ink-tertiary" title="Not allocated to a procedure step">
                                —
                              </span>
                            )}
                          </td>
                        ) : (
                          <td
                            key={column.key}
                            className="max-w-[22rem] truncate px-3 py-1.5 text-ink"
                            title={row[column.name]}
                          >
                            {row[column.name]}
                          </td>
                        ),
                      )}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={Math.max(tableColumns.length, 1)} className="px-3 py-8 text-center text-sm text-ink-tertiary">
                      No BOM rows match “{searchQuery.trim()}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
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
  toolLibraryItems = EMPTY_TOOL_LIBRARY_ITEMS,
  section = "all",
  masterBom,
  onMasterBomChange,
  onSaveTool,
  onDeleteTool,
  onTidyToolNames,
  onConfirmAction,
}: {
  tasks: Task[];
  projectToolRegistry: Map<string, ProjectToolDefinition>;
  toolLibraryItems?: ToolLibraryItem[];
  section?: "tools" | "parts" | "all";
  masterBom?: MasterBom;
  onMasterBomChange?: (bom: MasterBom | undefined) => Promise<void>;
  onSaveTool: (entry: ProjectToolCatalogEntry, draft: ToolDraft) => Promise<void>;
  onDeleteTool: (entry: ProjectToolCatalogEntry) => Promise<void>;
  onTidyToolNames?: (plan: Array<{ from: string; to: string }>) => Promise<void>;
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
  const [toolDrafts, setToolDrafts] = useState<Record<string, ToolDraft>>({});
  const [savingToolKey, setSavingToolKey] = useState<string>();
  const [tidying, setTidying] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);

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

  function updateToolDraft(key: string, patch: Partial<ToolDraft>) {
    setToolDrafts((current) => ({
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

  function requestDeleteTool(entry: ProjectToolCatalogEntry) {
    onConfirmAction({
      title: `Remove ${entry.name}?`,
      body: `This removes the tool from ${entry.stepUsageCount} step assignment(s) across ${entry.taskUsageCount} task(s).`,
      tone: "danger",
      confirmLabel: "Remove Tool",
      onConfirm: () => onDeleteTool(entry),
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

      {showParts && onMasterBomChange ? (
        <MasterBomPanel
          masterBom={masterBom}
          tasks={tasks}
          onChange={onMasterBomChange}
          onConfirmAction={onConfirmAction}
        />
      ) : null}
    </div>
  );
}
