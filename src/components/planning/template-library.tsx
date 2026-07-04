"use client";

import { ChevronDown, ChevronRight, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { NothingLoadingBlock } from "@/components/nothing-ui";
import type { FeedbackToast } from "@/components/themed-feedback";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import { WORK_ORDER_TYPE_LABELS, WORK_ORDER_TYPES, type WorkOrderType } from "@/domain/work-orders";
import type { ParsedTemplateSheet } from "@/lib/planning/parse-workbook";
import {
  getTemplate,
  importTemplates,
  listTemplates,
  retireTemplate,
  saveTemplate,
  type TemplateDetail,
  type TemplateSummary,
} from "@/lib/planning/store";
import { usePlanningWorkspace } from "./planning-workspace-provider";

const TYPE_OPTIONS: ThemedSelectOption[] = WORK_ORDER_TYPES.map((type) => ({
  value: type,
  label: WORK_ORDER_TYPE_LABELS[type],
}));

type TemplateGroup = { model: string; templates: TemplateSummary[] };

function groupByModel(templates: TemplateSummary[]): TemplateGroup[] {
  const byModel = new Map<string, TemplateSummary[]>();
  for (const template of templates) {
    const key = template.model || "—";
    const bucket = byModel.get(key);
    if (bucket) {
      bucket.push(template);
    } else {
      byModel.set(key, [template]);
    }
  }
  return Array.from(byModel.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, group]) => ({
      model,
      templates: [...group].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/** One line of the expanded editor: build qty stays a text buffer, same idiom as `WorkOrderLineRow`. */
type TemplateLineDraft = {
  id: string;
  itemNo: string;
  description: string;
  buildQty: string;
};

type TemplateEditDraft = {
  name: string;
  customer: string;
  model: string;
  orderType: WorkOrderType;
  notesDefault: string;
  lines: TemplateLineDraft[];
};

function draftFromDetail(detail: TemplateDetail): TemplateEditDraft {
  return {
    name: detail.name,
    customer: detail.customer,
    model: detail.model,
    orderType: detail.orderType,
    notesDefault: detail.notesDefault,
    lines: detail.lines.map((line) => ({
      id: line.id,
      itemNo: line.itemNo,
      description: line.description,
      buildQty: String(line.buildQty),
    })),
  };
}

function draftChanged(detail: TemplateDetail, draft: TemplateEditDraft): boolean {
  if (
    draft.name.trim() !== detail.name ||
    draft.customer.trim() !== detail.customer ||
    draft.model.trim() !== detail.model ||
    draft.orderType !== detail.orderType ||
    draft.notesDefault !== detail.notesDefault ||
    draft.lines.length !== detail.lines.length
  ) {
    return true;
  }
  return draft.lines.some((line, index) => {
    const original = detail.lines[index];
    if (!original || line.id !== original.id) return true;
    const parsedQty = Math.max(0, Number(line.buildQty) || 0);
    return (
      line.itemNo.trim() !== original.itemNo ||
      line.description.trim() !== original.description ||
      parsedQty !== original.buildQty
    );
  });
}

let tempLineSeq = 0;

/**
 * Template library grouped by model: name/customer/type/line count/retired chip, with inline
 * edit (line table minus A#/shipped — those are work-order-only fields), duplicate, and
 * retire/unretire. Always fetches with `includeRetired: true` so retired templates stay visible
 * and reversible here even though `listTemplates`'s default (used by the Task 8 picker) hides them.
 */
export function TemplateLibrary({
  reloadToken,
  onNotify,
}: {
  reloadToken: number;
  onNotify: (toast: Omit<FeedbackToast, "id">) => void;
}) {
  const confirm = useConfirm();
  const { workspaceId, canWrite } = usePlanningWorkspace();

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedStatus, setExpandedStatus] = useState<"loading" | "error" | "ready">("loading");
  const [expandedError, setExpandedError] = useState("");
  const [expandedDetail, setExpandedDetail] = useState<TemplateDetail | null>(null);
  const [expandedDraft, setExpandedDraft] = useState<TemplateEditDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [retiringId, setRetiringId] = useState<string | null>(null);

  const loadSeqRef = useRef(0);
  const expandSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!workspaceId) {
      setTemplates([]);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const next = await listTemplates(workspaceId, { includeRetired: true });
      if (seq !== loadSeqRef.current) return;
      setTemplates(next);
      setStatus("ready");
    } catch (caught) {
      if (seq !== loadSeqRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load templates.");
      setStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    return () => {
      loadSeqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloadToken is a deliberate re-fetch trigger, not a value read below.
  }, [refresh, reloadToken]);

  const groups = useMemo(() => groupByModel(templates), [templates]);

  async function toggleExpand(template: TemplateSummary) {
    if (expandedId === template.id) {
      expandSeqRef.current += 1;
      setExpandedId(null);
      setExpandedDetail(null);
      setExpandedDraft(null);
      return;
    }

    const seq = ++expandSeqRef.current;
    setExpandedId(template.id);
    setExpandedDetail(null);
    setExpandedDraft(null);
    setExpandedStatus("loading");
    setExpandedError("");
    try {
      const detail = await getTemplate(workspaceId, template.id);
      if (seq !== expandSeqRef.current) return;
      if (!detail) {
        setExpandedStatus("error");
        setExpandedError("This template no longer exists.");
        return;
      }
      setExpandedDetail(detail);
      setExpandedDraft(draftFromDetail(detail));
      setExpandedStatus("ready");
    } catch (caught) {
      if (seq !== expandSeqRef.current) return;
      setExpandedStatus("error");
      setExpandedError(caught instanceof Error ? caught.message : "Could not load the template.");
    }
  }

  function updateDraft(patch: Partial<Omit<TemplateEditDraft, "lines">>) {
    setExpandedDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function updateLine(lineId: string, patch: Partial<Omit<TemplateLineDraft, "id">>) {
    setExpandedDraft((current) =>
      current ? { ...current, lines: current.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)) } : current,
    );
  }

  function addLine() {
    tempLineSeq += 1;
    setExpandedDraft((current) =>
      current
        ? { ...current, lines: [...current.lines, { id: `new-${tempLineSeq}`, itemNo: "", description: "", buildQty: "1" }] }
        : current,
    );
  }

  function removeLine(lineId: string) {
    setExpandedDraft((current) =>
      current ? { ...current, lines: current.lines.filter((line) => line.id !== lineId) } : current,
    );
  }

  function cancelDraft() {
    if (expandedDetail) {
      setExpandedDraft(draftFromDetail(expandedDetail));
    }
  }

  async function handleSaveDraft() {
    if (!expandedDetail || !expandedDraft || saving || !draftChanged(expandedDetail, expandedDraft)) return;
    setSaving(true);
    try {
      const nextDetail: TemplateDetail = {
        ...expandedDetail,
        name: expandedDraft.name.trim(),
        customer: expandedDraft.customer.trim(),
        model: expandedDraft.model.trim(),
        orderType: expandedDraft.orderType,
        notesDefault: expandedDraft.notesDefault,
        lines: expandedDraft.lines.map((line, index) => ({
          id: line.id,
          itemNo: line.itemNo.trim(),
          description: line.description.trim(),
          buildQty: Math.max(0, Number(line.buildQty) || 0),
          position: index,
        })),
      };
      await saveTemplate(workspaceId, nextDetail);
      const refreshed = await getTemplate(workspaceId, nextDetail.id);
      if (refreshed) {
        setExpandedDetail(refreshed);
        setExpandedDraft(draftFromDetail(refreshed));
        setTemplates((current) =>
          current.map((t) =>
            t.id === refreshed.id
              ? {
                  ...t,
                  name: refreshed.name,
                  customer: refreshed.customer,
                  model: refreshed.model,
                  orderType: refreshed.orderType,
                  lineCount: refreshed.lines.length,
                }
              : t,
          ),
        );
      }
      onNotify({ title: "Template saved", tone: "success" });
    } catch (caught) {
      onNotify({
        title: "Save failed",
        body: caught instanceof Error ? caught.message : "Could not save the template.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate(template: TemplateSummary) {
    const ok = await confirm({
      title: `Duplicate "${template.name}"?`,
      body: `Creates a copy named "${template.name} (copy)".`,
      tone: "neutral",
      confirmLabel: "Duplicate",
    });
    if (!ok) return;

    setDuplicatingId(template.id);
    try {
      const detail = expandedId === template.id && expandedDetail ? expandedDetail : await getTemplate(workspaceId, template.id);
      if (!detail) {
        onNotify({ title: "Duplicate failed", body: "This template no longer exists.", tone: "danger" });
        return;
      }
      const copyName = `${detail.name} (copy)`;
      const sheet: ParsedTemplateSheet = {
        sheetName: copyName,
        templateName: copyName,
        customer: detail.customer,
        model: detail.model,
        orderType: detail.orderType,
        notes: detail.notesDefault,
        lines: detail.lines.map((line, index) => ({
          itemNo: line.itemNo,
          description: line.description,
          buildQty: line.buildQty,
          position: index,
        })),
        warnings: [],
      };
      const { imported, failed } = await importTemplates(workspaceId, [sheet]);
      if (imported === 1) {
        onNotify({ title: "Template duplicated", body: `Created "${copyName}".`, tone: "success" });
        await refresh();
      } else {
        onNotify({
          title: "Duplicate failed",
          body: failed[0]?.message ?? "Could not duplicate the template.",
          tone: "danger",
        });
      }
    } catch (caught) {
      onNotify({
        title: "Duplicate failed",
        body: caught instanceof Error ? caught.message : "Could not duplicate the template.",
        tone: "danger",
      });
    } finally {
      setDuplicatingId(null);
    }
  }

  async function handleRetireToggle(template: TemplateSummary) {
    const nextRetired = !template.retiredAt;
    const ok = await confirm({
      title: nextRetired ? `Retire "${template.name}"?` : `Restore "${template.name}"?`,
      body: nextRetired
        ? "Retired templates are hidden from the new-work-order picker but stay in this library."
        : "This template becomes available again in the new-work-order picker.",
      tone: nextRetired ? "danger" : "neutral",
      confirmLabel: nextRetired ? "Retire" : "Restore",
    });
    if (!ok) return;

    setRetiringId(template.id);
    try {
      await retireTemplate(workspaceId, template.id, nextRetired);
      setTemplates((current) =>
        current.map((t) => (t.id === template.id ? { ...t, retiredAt: nextRetired ? new Date().toISOString() : null } : t)),
      );
      onNotify({ title: nextRetired ? "Template retired" : "Template restored", tone: "success" });
    } catch (caught) {
      onNotify({
        title: "Update failed",
        body: caught instanceof Error ? caught.message : "Could not update the template.",
        tone: "danger",
      });
    } finally {
      setRetiringId(null);
    }
  }

  return (
    <section className="ui-panel overflow-hidden">
      <div className="border-b border-line p-4">
        <div className="ui-setup-section-title">Template library</div>
        <p className="ui-setup-section-desc">
          {templates.length} template{templates.length === 1 ? "" : "s"}, grouped by model.
        </p>
      </div>

      {status === "loading" ? (
        <div className="px-4 py-10">
          <NothingLoadingBlock title="Loading templates" />
        </div>
      ) : status === "error" ? (
        <div className="px-4 py-10 text-center">
          <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load templates."}</p>
          <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : templates.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="ui-section-subtitle text-ink-tertiary">No templates yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {groups.map((group) => (
            <div key={group.model}>
              <div className="ui-mono-label bg-surface-muted px-4 py-1.5 text-ink-tertiary">{group.model}</div>
              {group.templates.map((template) => {
                const expanded = expandedId === template.id;
                return (
                  <div key={template.id} className="border-t border-line/60 first:border-t-0">
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <button
                        type="button"
                        className="ui-btn-ghost h-7 w-7 shrink-0 px-0"
                        aria-label={expanded ? `Collapse ${template.name}` : `Expand ${template.name}`}
                        aria-expanded={expanded}
                        onClick={() => void toggleExpand(template)}
                      >
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink">{template.name}</span>
                          {template.retiredAt ? <span className="ui-chip">Retired</span> : null}
                        </div>
                        <span className="ui-mono-label truncate text-ink-tertiary">
                          {[
                            template.customer || "—",
                            WORK_ORDER_TYPE_LABELS[template.orderType],
                            `${template.lineCount} line${template.lineCount === 1 ? "" : "s"}`,
                          ].join(" · ")}
                        </span>
                      </div>
                      {canWrite ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className="ui-btn-ghost h-8 gap-1.5 px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={duplicatingId === template.id}
                            onClick={() => void handleDuplicate(template)}
                          >
                            {duplicatingId === template.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Copy size={12} />
                            )}
                            Duplicate
                          </button>
                          <button
                            type="button"
                            className={`ui-btn-ghost h-8 gap-1.5 px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                              template.retiredAt ? "" : "hover:text-danger"
                            }`}
                            disabled={retiringId === template.id}
                            onClick={() => void handleRetireToggle(template)}
                          >
                            {retiringId === template.id ? <Loader2 size={12} className="animate-spin" /> : null}
                            {template.retiredAt ? "Restore" : "Retire"}
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {expanded ? (
                      <div className="border-t border-line/60 bg-surface-muted/40 px-4 py-4">
                        {expandedStatus === "loading" ? (
                          <NothingLoadingBlock title="Loading template" />
                        ) : expandedStatus === "error" ? (
                          <p className="ui-section-subtitle text-ink-tertiary">{expandedError}</p>
                        ) : expandedDetail && expandedDraft ? (
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              <label className="block min-w-0">
                                <span className="ui-field-label">Name</span>
                                <input
                                  className="ui-input"
                                  value={expandedDraft.name}
                                  disabled={!canWrite}
                                  onChange={(event) => updateDraft({ name: event.target.value })}
                                />
                              </label>
                              <label className="block min-w-0">
                                <span className="ui-field-label">Customer</span>
                                <input
                                  className="ui-input"
                                  value={expandedDraft.customer}
                                  disabled={!canWrite}
                                  onChange={(event) => updateDraft({ customer: event.target.value })}
                                />
                              </label>
                              <label className="block min-w-0">
                                <span className="ui-field-label">Model</span>
                                <input
                                  className="ui-input"
                                  value={expandedDraft.model}
                                  disabled={!canWrite}
                                  onChange={(event) => updateDraft({ model: event.target.value })}
                                />
                              </label>
                              <label className="block min-w-0">
                                <span className="ui-field-label">Type</span>
                                <ThemedSelect
                                  value={expandedDraft.orderType}
                                  onChange={(value) => updateDraft({ orderType: value as WorkOrderType })}
                                  options={TYPE_OPTIONS}
                                  ariaLabel="Template type"
                                  className="mt-1 w-full"
                                  disabled={!canWrite}
                                />
                              </label>
                            </div>

                            <div className="overflow-x-auto rounded-md border border-line">
                              <table className="w-full min-w-[560px] border-collapse text-sm">
                                <thead>
                                  <tr>
                                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">
                                      Item no
                                    </th>
                                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">
                                      Description
                                    </th>
                                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">
                                      Build qty
                                    </th>
                                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">
                                      Position
                                    </th>
                                    {canWrite ? (
                                      <th className="border-b border-line px-3 py-2" aria-hidden="true" />
                                    ) : null}
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedDraft.lines.length === 0 ? (
                                    <tr>
                                      <td colSpan={canWrite ? 5 : 4} className="px-3 py-6 text-center">
                                        <p className="ui-section-subtitle text-ink-tertiary">No lines yet.</p>
                                      </td>
                                    </tr>
                                  ) : (
                                    expandedDraft.lines.map((line, index) => (
                                      <tr key={line.id} className="border-b border-line/60 last:border-b-0">
                                        <td className="px-3 py-2">
                                          <input
                                            type="text"
                                            className="ui-input"
                                            value={line.itemNo}
                                            disabled={!canWrite}
                                            onChange={(event) => updateLine(line.id, { itemNo: event.target.value })}
                                          />
                                        </td>
                                        <td className="px-3 py-2">
                                          <input
                                            type="text"
                                            className="ui-input"
                                            value={line.description}
                                            disabled={!canWrite}
                                            onChange={(event) => updateLine(line.id, { description: event.target.value })}
                                          />
                                        </td>
                                        <td className="w-24 px-3 py-2">
                                          <input
                                            type="number"
                                            className="ui-input"
                                            min={0}
                                            value={line.buildQty}
                                            disabled={!canWrite}
                                            onChange={(event) => updateLine(line.id, { buildQty: event.target.value })}
                                          />
                                        </td>
                                        <td className="ui-mono-label w-20 px-3 py-2 text-ink-tertiary">{index + 1}</td>
                                        {canWrite ? (
                                          <td className="px-3 py-2">
                                            <button
                                              type="button"
                                              className="ui-btn-ghost h-8 w-8 shrink-0 px-0 text-ink-tertiary hover:text-danger"
                                              aria-label="Remove line"
                                              title="Remove line"
                                              onClick={() => removeLine(line.id)}
                                            >
                                              <Trash2 size={13} />
                                            </button>
                                          </td>
                                        ) : null}
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>

                            {canWrite ? (
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <button
                                  type="button"
                                  className="ui-btn-ghost h-8 gap-1.5 px-3"
                                  onClick={addLine}
                                >
                                  <Plus size={13} />
                                  Add line
                                </button>
                                <div className="flex items-center gap-2">
                                  <button type="button" className="ui-btn-ghost h-8 px-3" onClick={cancelDraft} disabled={saving}>
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="ui-btn-primary h-8 gap-1.5 px-3 disabled:cursor-not-allowed disabled:opacity-40"
                                    disabled={saving || !draftChanged(expandedDetail, expandedDraft)}
                                    onClick={() => void handleSaveDraft()}
                                  >
                                    {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                                    {saving ? "Saving…" : "Save changes"}
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
