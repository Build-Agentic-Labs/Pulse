"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NothingLoadingBlock } from "@/components/nothing-ui";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import { WORK_ORDER_TYPE_LABELS, WORK_ORDER_TYPES, suggestOrderNo, type WorkOrderType } from "@/domain/work-orders";
import {
  createWorkOrder,
  getTemplate,
  listTemplates,
  listWorkOrders,
  type TemplateDetail,
  type TemplateSummary,
  type WorkOrderLine,
} from "@/lib/planning/store";
import { PlanningShell } from "./planning-shell";
import { usePlanningWorkspace } from "./planning-workspace-provider";

const BLANK_SELECTION = "__blank__";

const TYPE_OPTIONS: ThemedSelectOption[] = WORK_ORDER_TYPES.map((type) => ({
  value: type,
  label: WORK_ORDER_TYPE_LABELS[type],
}));

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type FormState = {
  customer: string;
  model: string;
  orderType: WorkOrderType;
  orderDate: string;
  notes: string;
};

function blankForm(): FormState {
  return { customer: "", model: "", orderType: WORK_ORDER_TYPES[0], orderDate: todayIso(), notes: "" };
}

function formFromTemplate(template: TemplateDetail): FormState {
  return {
    customer: template.customer,
    model: template.model,
    orderType: template.orderType,
    orderDate: todayIso(),
    notes: template.notesDefault,
  };
}

/** Template lines become order lines: fresh fulfillment, no assembly/pull refs or shipped qty yet. */
function linesFromTemplate(template: TemplateDetail): Array<Omit<WorkOrderLine, "id">> {
  return template.lines.map((line) => ({
    itemNo: line.itemNo,
    description: line.description,
    buildQty: line.buildQty,
    shippedQty: null,
    fulfillment: "assembly",
    assemblyOrderNo: "",
    pullFromRef: "",
  }));
}

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

/** The selected template's lazily-fetched detail: idle while blank, loading/error/ready otherwise. */
type SelectedDetailState =
  | { status: "idle" }
  | { status: "loading"; templateId: string }
  | { status: "error"; templateId: string }
  | { status: "ready"; templateId: string; detail: TemplateDetail };

/**
 * Single-screen "new work order" flow: a searchable template picker on the left (grouped by
 * model, plus a "Start blank" row) and the create form on the right. Picking a template
 * prefills the form and carries its lines into the new order; picking blank starts empty.
 * Row line counts come from `TemplateSummary.lineCount` (one bulk query inside `listTemplates`);
 * the full template detail is fetched lazily, only for the picked template.
 */
export function WorkOrderNew() {
  const router = useRouter();
  const { workspaceId, canWrite } = usePlanningWorkspace();

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templatesStatus, setTemplatesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [existingOrderNos, setExistingOrderNos] = useState<string[]>([]);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(BLANK_SELECTION);
  const [selectedDetail, setSelectedDetail] = useState<SelectedDetailState>({ status: "idle" });
  const [form, setForm] = useState<FormState>(blankForm());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Stale-response guards: same idiom as work-order-board.tsx's loadSeqRef. `detailSeqRef`
  // covers the lazy per-selection template fetch, so a slow response for an earlier pick can
  // never prefill the form after the user has moved on to another template (or to blank).
  const loadSeqRef = useRef(0);
  const detailSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!workspaceId) {
      setTemplates([]);
      setTemplatesStatus("ready");
      return;
    }
    setTemplatesStatus("loading");
    setError("");
    try {
      const [templateList, orders] = await Promise.all([listTemplates(workspaceId), listWorkOrders(workspaceId)]);
      if (seq !== loadSeqRef.current) return;
      setTemplates(templateList);
      setExistingOrderNos(orders.map((order) => order.orderNo));
      setTemplatesStatus("ready");
    } catch (caught) {
      if (seq !== loadSeqRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load templates.");
      setTemplatesStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    return () => {
      loadSeqRef.current += 1;
      detailSeqRef.current += 1;
    };
  }, [refresh]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? templates.filter(
          (template) =>
            template.name.toLowerCase().includes(needle) ||
            template.customer.toLowerCase().includes(needle) ||
            template.model.toLowerCase().includes(needle),
        )
      : templates;
    return groupByModel(matching);
  }, [templates, query]);

  /**
   * Select a picker row. For a template this always (re)fetches its detail — re-clicking a row
   * whose fetch failed is the retry path — and the prefill is applied when the detail arrives,
   * guarded by `detailSeqRef` so only the latest selection may write the form. The prefill lands
   * exactly once per selection (on arrival), so later user edits are never re-clobbered.
   */
  function selectTemplate(id: string) {
    const seq = ++detailSeqRef.current;
    setSelectedId(id);
    setError("");

    if (id === BLANK_SELECTION) {
      setSelectedDetail({ status: "idle" });
      setForm(blankForm());
      return;
    }

    setSelectedDetail({ status: "loading", templateId: id });
    getTemplate(workspaceId, id)
      .then((detail) => {
        if (seq !== detailSeqRef.current) return;
        if (!detail) {
          setSelectedDetail({ status: "error", templateId: id });
          setError("This template no longer exists. Pick another or start blank.");
          return;
        }
        setSelectedDetail({ status: "ready", templateId: id, detail });
        setForm(formFromTemplate(detail));
      })
      .catch((caught) => {
        if (seq !== detailSeqRef.current) return;
        setSelectedDetail({ status: "error", templateId: id });
        setError(caught instanceof Error ? caught.message : "Could not load the template.");
      });
  }

  const selectedTemplateSummary = selectedId === BLANK_SELECTION ? null : templates.find((t) => t.id === selectedId);
  const readyDetail = selectedDetail.status === "ready" ? selectedDetail.detail : null;

  const suggestedOrderNo = useMemo(
    () => suggestOrderNo(existingOrderNos, form.orderDate),
    [existingOrderNos, form.orderDate],
  );

  const lineCountLabel =
    selectedId === BLANK_SELECTION
      ? "Blank order — no lines yet."
      : selectedDetail.status === "loading"
        ? "Loading template lines…"
        : selectedDetail.status === "error"
          ? "Could not load this template — click its row to retry."
          : readyDetail
            ? `${readyDetail.lines.length} line${readyDetail.lines.length === 1 ? "" : "s"} from template.`
            : "";

  const canSubmit =
    canWrite &&
    Boolean(workspaceId) &&
    form.customer.trim() !== "" &&
    form.orderDate.trim() !== "" &&
    !saving &&
    (selectedId === BLANK_SELECTION || Boolean(readyDetail));

  async function handleCreate() {
    if (!workspaceId || !canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const lines = readyDetail ? linesFromTemplate(readyDetail) : [];
      const id = await createWorkOrder(workspaceId, {
        templateId: selectedId === BLANK_SELECTION ? null : selectedId,
        customer: form.customer.trim(),
        model: form.model.trim(),
        orderType: form.orderType,
        orderDate: form.orderDate,
        notes: form.notes,
        lines,
      });
      router.push(`/planning/work-orders/${id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the work order.");
      setSaving(false);
    }
  }

  return (
    <PlanningShell title="New work order" backHref="/planning">
      <div className="space-y-5">
        <div>
          <h1 className="ui-section-title">New work order</h1>
          <p className="ui-section-subtitle">Start from a template or build a blank order.</p>
        </div>

        {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section className="ui-panel flex max-h-[640px] flex-col overflow-hidden">
            <div className="border-b border-line p-3">
              <input
                type="search"
                className="ui-field-standalone w-full"
                placeholder="Search templates"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={templatesStatus !== "ready"}
              />
            </div>

            {/* min-h-0 lets this flex child shrink below its content height — without it the
                list grows past the panel's max-h, gets clipped, and can never scroll. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {templatesStatus === "loading" ? (
                <div className="px-4 py-10">
                  <NothingLoadingBlock title="Loading templates" />
                </div>
              ) : templatesStatus === "error" ? (
                <div className="px-4 py-10 text-center">
                  <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load templates."}</p>
                  <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refresh()}>
                    Retry
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-line">
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-hover ${
                      selectedId === BLANK_SELECTION ? "ui-state-selected" : ""
                    }`}
                    onClick={() => selectTemplate(BLANK_SELECTION)}
                  >
                    <span className="text-sm font-medium text-ink">Start blank</span>
                    <span className="ui-mono-label ml-auto text-ink-tertiary">No template</span>
                  </button>

                  {groups.length === 0 ? (
                    <div className="px-4 py-10 text-center">
                      <p className="ui-section-subtitle text-ink-tertiary">
                        {templates.length === 0 ? "No templates yet." : `No templates match “${query.trim()}”.`}
                      </p>
                    </div>
                  ) : (
                    groups.map((group) => (
                      <div key={group.model}>
                        <div className="ui-mono-label bg-surface-muted px-4 py-1.5 text-ink-tertiary">
                          {group.model}
                        </div>
                        {group.templates.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-surface-hover ${
                              selectedId === template.id ? "ui-state-selected" : ""
                            }`}
                            onClick={() => selectTemplate(template.id)}
                          >
                            <span className="truncate text-sm font-medium text-ink">{template.name}</span>
                            <span className="ui-mono-label truncate text-ink-tertiary">
                              {[
                                template.customer || "—",
                                WORK_ORDER_TYPE_LABELS[template.orderType],
                                `${template.lineCount} line${template.lineCount === 1 ? "" : "s"}`,
                              ].join(" · ")}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="ui-panel space-y-4 p-5">
            {!canWrite ? (
              <div className="ui-notice ui-notice-warn px-3 py-2 ui-section-subtitle">
                You have read-only access to Planning; ask an editor to create this order.
              </div>
            ) : null}

            <div>
              <label className="ui-mono-label" htmlFor="wo-new-customer">
                Customer
              </label>
              <input
                id="wo-new-customer"
                type="text"
                className="ui-input"
                value={form.customer}
                onChange={(event) => setForm((current) => ({ ...current, customer: event.target.value }))}
                disabled={!canWrite || saving}
              />
            </div>

            <div>
              <label className="ui-mono-label" htmlFor="wo-new-model">
                Model
              </label>
              <input
                id="wo-new-model"
                type="text"
                className="ui-input"
                value={form.model}
                onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                disabled={!canWrite || saving}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="ui-mono-label">Type</label>
                <ThemedSelect
                  value={form.orderType}
                  onChange={(value) => setForm((current) => ({ ...current, orderType: value as WorkOrderType }))}
                  options={TYPE_OPTIONS}
                  ariaLabel="Work order type"
                  disabled={!canWrite || saving}
                  className="mt-1 w-full"
                />
              </div>

              <div>
                <label className="ui-mono-label" htmlFor="wo-new-date">
                  Order date
                </label>
                <input
                  id="wo-new-date"
                  type="date"
                  className="ui-input"
                  value={form.orderDate}
                  onChange={(event) => setForm((current) => ({ ...current, orderDate: event.target.value }))}
                  disabled={!canWrite || saving}
                />
              </div>
            </div>

            <div>
              <label className="ui-mono-label" htmlFor="wo-new-notes">
                Notes
              </label>
              <textarea
                id="wo-new-notes"
                className="ui-input resize-none"
                rows={3}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                disabled={!canWrite || saving}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <div>
                <div className="ui-mono-label text-ink-tertiary">Order no. (suggested)</div>
                <div className="font-mono text-sm text-ink">{suggestedOrderNo}</div>
              </div>
              <div className="text-right">
                <p className="ui-section-subtitle text-ink-tertiary">
                  {selectedTemplateSummary ? `From “${selectedTemplateSummary.name}”` : "No template selected"}
                </p>
                <p className="ui-section-subtitle text-ink-tertiary">{lineCountLabel}</p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="ui-btn-primary h-9 gap-1.5 px-4 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!canSubmit}
                onClick={() => void handleCreate()}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {saving ? "Creating…" : "Create work order"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </PlanningShell>
  );
}
