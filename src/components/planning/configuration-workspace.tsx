"use client";

import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import { ThemedFeedbackLayer, type FeedbackToast } from "@/components/themed-feedback";
import { WORK_ORDER_TYPE_LABELS } from "@/domain/work-orders";
import {
  getConfig,
  listConfigs,
  retireConfig,
  saveConfig,
  type ConfigDetail,
  type ConfigLine,
  type ConfigSummary,
} from "@/lib/planning/config-store";
import { listTrailerConfigs, type TrailerConfig } from "@/lib/planning/store";
import { PlanningPartSearch, type PartSelection } from "./planning-part-search";
import { usePlanningWorkspace } from "./planning-workspace-provider";
import "./configuration-workspace.css";

/**
 * Product configuration: assign a BOM parts list to a finished-goods or accessory SKU.
 *
 * The SKU is the KEY the schedule importer resolves against — one SKU means one BOM, and a
 * different customer means a different SKU, so the customer never has to be inferred from the
 * sheet. A line the importer flags as `sku-not-configured` is fixed here, which is what turns a
 * blocked import row from a dead end into a one-click task.
 */

/** Only these types are configurable products; the rest are one-off order kinds. */
const CONFIGURABLE_TYPES = ["head_unit", "power_module", "accessories", "trailer"] as const;

const TYPE_OPTIONS: ThemedSelectOption[] = CONFIGURABLE_TYPES.map((type) => ({
  value: type,
  label: WORK_ORDER_TYPE_LABELS[type],
}));

/** Draft shape while editing — lines carry an optional id (absent = new). */
type EditorLine = Omit<ConfigLine, "id"> & { id?: string; key: string };

type EditorState = {
  id?: string;
  sku: string;
  name: string;
  orderType: string;
  model: string;
  customer: string;
  pmConfigId: string | null;
  defaultTrailerLetter: string;
  notesDefault: string;
  lines: EditorLine[];
};

/** Monotonic toast id source — module-scoped, matching planning-settings.tsx's counter. */
let toastSeq = 0;

let lineKeySeq = 0;
function nextLineKey(): string {
  lineKeySeq += 1;
  return `new-${lineKeySeq}`;
}

function emptyEditor(): EditorState {
  return {
    sku: "",
    name: "",
    orderType: "head_unit",
    model: "",
    customer: "",
    pmConfigId: null,
    defaultTrailerLetter: "",
    notesDefault: "",
    lines: [],
  };
}

function editorFromDetail(detail: ConfigDetail): EditorState {
  return {
    id: detail.id,
    sku: detail.sku,
    name: detail.name,
    orderType: detail.orderType,
    model: detail.model,
    customer: detail.customer,
    pmConfigId: detail.pmConfigId,
    defaultTrailerLetter: detail.defaultTrailerLetter,
    notesDefault: detail.notesDefault,
    lines: detail.lines.map((line) => ({ ...line, key: line.id })),
  };
}

export function ConfigurationWorkspace() {
  const confirm = useConfirm();
  const { workspaceId, canWrite } = usePlanningWorkspace();

  const [configs, setConfigs] = useState<ConfigSummary[]>([]);
  const [trailers, setTrailers] = useState<TrailerConfig[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<FeedbackToast[]>([]);

  const notify = useCallback((toast: Omit<FeedbackToast, "id">) => {
    toastSeq += 1;
    setToasts((current) => [...current, { ...toast, id: toastSeq }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [nextConfigs, nextTrailers] = await Promise.all([
        listConfigs(workspaceId),
        listTrailerConfigs(workspaceId),
      ]);
      setConfigs(nextConfigs);
      setTrailers(nextTrailers);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load product configurations.");
      setStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openConfig(id: string) {
    if (!workspaceId) return;
    try {
      const detail = await getConfig(workspaceId, id);
      if (detail) setEditor(editorFromDetail(detail));
    } catch (cause) {
      notify({ tone: "danger", title: cause instanceof Error ? cause.message : "Could not open it." });
    }
  }

  async function submit() {
    if (!workspaceId || !editor) return;
    setSaving(true);
    try {
      await saveConfig(workspaceId, {
        id: editor.id,
        sku: editor.sku,
        name: editor.name,
        orderType: editor.orderType,
        model: editor.model,
        customer: editor.customer,
        pmConfigId: editor.pmConfigId,
        defaultTrailerLetter: editor.defaultTrailerLetter,
        notesDefault: editor.notesDefault,
        // Position is row order, renumbered on save so gaps from removed rows never persist.
        lines: editor.lines.map((line, index) => ({
          id: line.id,
          itemNo: line.itemNo,
          description: line.description,
          buildQty: line.buildQty,
          position: index + 1,
        })),
      });
      notify({ tone: "success", title: `Saved ${editor.sku.trim()}.` });
      setEditor(null);
      await refresh();
    } catch (cause) {
      notify({ tone: "danger", title: cause instanceof Error ? cause.message : "Could not save it." });
    } finally {
      setSaving(false);
    }
  }

  async function retire(config: ConfigSummary) {
    if (!workspaceId) return;
    const ok = await confirm({
      title: `Retire ${config.sku}?`,
      body: "Work orders already built from this configuration keep it as their record. The SKU becomes free for a new configuration.",
      confirmLabel: "Retire",
    });
    if (!ok) return;
    try {
      await retireConfig(workspaceId, config.id);
      notify({ tone: "success", title: `Retired ${config.sku}.` });
      await refresh();
    } catch (cause) {
      notify({ tone: "danger", title: cause instanceof Error ? cause.message : "Could not retire it." });
    }
  }

  const pmOptions: ThemedSelectOption[] = [
    { value: "", label: "No paired power module" },
    ...configs
      .filter((config) => config.orderType === "power_module")
      .map((config) => ({ value: config.id, label: `${config.sku} — ${config.name || "Unnamed"}` })),
  ];

  const trailerOptions: ThemedSelectOption[] = [
    { value: "", label: "No default trailer" },
    ...trailers.map((trailer) => ({
      value: trailer.letter,
      label: `${trailer.letter} — ${trailer.name || "Unnamed"}`,
    })),
  ];

  if (status === "loading") {
    return <div className="ui-panel p-5 text-sm text-ink-secondary">Loading product configurations…</div>;
  }

  if (status === "error") {
    return (
      <section className="ui-panel p-5">
        <div className="ui-mono-label">Could not load</div>
        <p className="mt-3 text-sm text-danger">{error}</p>
      </section>
    );
  }

  if (editor) {
    return (
      <>
        <ConfigEditor
          editor={editor}
          setEditor={setEditor}
          workspaceId={workspaceId ?? ""}
          canWrite={canWrite}
          saving={saving}
          pmOptions={pmOptions}
          trailerOptions={trailerOptions}
          onSubmit={submit}
          onCancel={() => setEditor(null)}
        />
        <ThemedFeedbackLayer
          toasts={toasts}
          onDismissToast={dismissToast}
          onCancelConfirm={() => undefined}
          onConfirm={() => undefined}
        />
      </>
    );
  }

  return (
    <>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="ui-mono-label text-ink-secondary">
            {configs.length} {configs.length === 1 ? "configuration" : "configurations"}
          </span>
          <span className="flex-1" />
          {canWrite ? (
            <button type="button" className="ui-btn-primary h-9 px-3 text-[12px]" onClick={() => setEditor(emptyEditor())}>
              New configuration
            </button>
          ) : null}
        </div>

        {configs.length === 0 ? (
          <section className="ui-panel p-5">
            <div className="ui-mono-label">No configurations yet</div>
            <p className="mt-3 text-sm text-ink-secondary">
              Add one per finished-goods or accessory SKU. The schedule importer looks a line&apos;s SKU up
              here to fill in its parts list, and flags any SKU it cannot find.
            </p>
          </section>
        ) : (
          <div className="ui-panel overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">SKU</th>
                  <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Name</th>
                  <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Type</th>
                  <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Parts</th>
                  <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Paired PM</th>
                  <th className="border-b border-line px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {configs.map((config) => (
                  <tr key={config.id} className="hover:bg-raised/40">
                    <td className="border-b border-line px-3 py-2.5">
                      <button
                        type="button"
                        className="font-mono text-[12px] text-ink underline-offset-2 hover:underline"
                        onClick={() => void openConfig(config.id)}
                      >
                        {config.sku || "—"}
                      </button>
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-ink-secondary">{config.name || "—"}</td>
                    <td className="border-b border-line px-3 py-2.5 text-ink-secondary">
                      {WORK_ORDER_TYPE_LABELS[config.orderType as keyof typeof WORK_ORDER_TYPE_LABELS] ?? config.orderType}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-ink-secondary">
                      {config.lineCount === 0 ? (
                        <span className="text-danger">no parts</span>
                      ) : (
                        `${config.lineCount} ${config.lineCount === 1 ? "part" : "parts"}`
                      )}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 font-mono text-[12px] text-ink-tertiary">
                      {configs.find((other) => other.id === config.pmConfigId)?.sku ?? "—"}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right">
                      {canWrite ? (
                        <button
                          type="button"
                          className="ui-btn-ghost h-8 px-2 text-[12px] text-ink-tertiary hover:text-danger"
                          onClick={() => void retire(config)}
                        >
                          Retire
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ThemedFeedbackLayer
          toasts={toasts}
          onDismissToast={dismissToast}
          onCancelConfirm={() => undefined}
          onConfirm={() => undefined}
        />
    </>
  );
}

function ConfigEditor({
  editor,
  setEditor,
  workspaceId,
  canWrite,
  saving,
  pmOptions,
  trailerOptions,
  onSubmit,
  onCancel,
}: {
  editor: EditorState;
  setEditor: (next: EditorState) => void;
  workspaceId: string;
  canWrite: boolean;
  saving: boolean;
  pmOptions: ThemedSelectOption[];
  trailerOptions: ThemedSelectOption[];
  onSubmit: () => void;
  onCancel: () => void;
}) {
  function patch(fields: Partial<EditorState>) {
    setEditor({ ...editor, ...fields });
  }

  function addPart(part: PartSelection) {
    patch({
      lines: [
        ...editor.lines,
        { key: nextLineKey(), itemNo: part.itemNo, description: part.description, buildQty: 1, position: 0 },
      ],
    });
  }

  const skuMissing = editor.sku.trim() === "";

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="ui-btn-ghost inline-flex h-8 items-center gap-1.5 px-2 text-[12px]" onClick={onCancel}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back
        </button>
        <span className="ui-mono-label text-ink-secondary">
          {editor.id ? "Edit configuration" : "New configuration"}
        </span>
        <span className="flex-1" />
        {canWrite ? (
          <button
            type="button"
            className="ui-btn-primary inline-flex h-9 items-center gap-2 px-3 text-[12px] disabled:opacity-50"
            disabled={saving || skuMissing}
            onClick={onSubmit}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            Save
          </button>
        ) : null}
      </div>

      <div className="ui-panel space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="ui-mono-label">SKU</span>
            <input
              className="ui-input w-full"
              value={editor.sku}
              disabled={!canWrite}
              placeholder="FG-7040-ES"
              onChange={(event) => patch({ sku: event.target.value })}
            />
            <span className="block text-[11px] text-ink-tertiary">
              The key the schedule importer matches a line against. Required.
            </span>
          </label>

          <label className="space-y-1.5">
            <span className="ui-mono-label">Name</span>
            <input
              className="ui-input w-full"
              value={editor.name}
              disabled={!canWrite}
              placeholder="Head unit 70-40 Equipment Share"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>

          <div className="space-y-1.5">
            <span className="ui-mono-label">Type</span>
            <ThemedSelect
              value={editor.orderType}
              options={TYPE_OPTIONS}
              disabled={!canWrite}
              ariaLabel="Configuration type"
              onChange={(value) => patch({ orderType: value })}
            />
          </div>

          <label className="space-y-1.5">
            <span className="ui-mono-label">Model</span>
            <input
              className="ui-input w-full"
              value={editor.model}
              disabled={!canWrite}
              placeholder="EBOSS70-40"
              onChange={(event) => patch({ model: event.target.value })}
            />
            <span className="block text-[11px] text-ink-tertiary">
              Cross-checked against the sheet&apos;s model text; a disagreement is flagged, not blocked.
            </span>
          </label>

          <div className="space-y-1.5">
            <span className="ui-mono-label">Paired power module</span>
            <ThemedSelect
              value={editor.pmConfigId ?? ""}
              options={pmOptions}
              disabled={!canWrite || editor.orderType !== "head_unit"}
              ariaLabel="Paired power module configuration"
              onChange={(value) => patch({ pmConfigId: value || null })}
            />
          </div>

          <div className="space-y-1.5">
            <span className="ui-mono-label">Default trailer</span>
            <ThemedSelect
              value={editor.defaultTrailerLetter}
              options={trailerOptions}
              disabled={!canWrite}
              ariaLabel="Default trailer configuration"
              onChange={(value) => patch({ defaultTrailerLetter: value })}
            />
            <span className="block text-[11px] text-ink-tertiary">
              Used only when the schedule leaves the trailer type blank.
            </span>
          </div>
        </div>
      </div>

      <div className="ui-panel space-y-3 p-5">
        <div className="flex items-center gap-3">
          <span className="ui-mono-label">Parts list</span>
          <span className="text-[12px] text-ink-tertiary">
            {editor.lines.length} {editor.lines.length === 1 ? "part" : "parts"}
          </span>
        </div>

        {canWrite ? (
          <PlanningPartSearch workspaceId={workspaceId} disabled={saving} onSelect={addPart} />
        ) : null}

        {editor.lines.length === 0 ? (
          <p className="text-sm text-ink-secondary">
            No parts yet. A configuration with no parts creates an empty work order.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="ui-mono-label border-b border-line px-2 py-2 text-left">Item</th>
                  <th className="ui-mono-label border-b border-line px-2 py-2 text-left">Description</th>
                  <th className="ui-mono-label border-b border-line px-2 py-2 text-left">Qty</th>
                  <th className="border-b border-line px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {editor.lines.map((line, index) => (
                  <tr key={line.key}>
                    <td className="border-b border-line px-2 py-2 font-mono text-[12px]">{line.itemNo}</td>
                    <td className="border-b border-line px-2 py-2 text-ink-secondary">{line.description}</td>
                    <td className="border-b border-line px-2 py-2">
                      <input
                        type="number"
                        min={0}
                        className="ui-input w-20"
                        value={line.buildQty}
                        disabled={!canWrite}
                        aria-label={`Quantity for ${line.itemNo}`}
                        onChange={(event) => {
                          const next = [...editor.lines];
                          next[index] = { ...line, buildQty: Number(event.target.value) };
                          patch({ lines: next });
                        }}
                      />
                    </td>
                    <td className="border-b border-line px-2 py-2 text-right">
                      {canWrite ? (
                        <button
                          type="button"
                          className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-danger"
                          aria-label={`Remove ${line.itemNo}`}
                          onClick={() => patch({ lines: editor.lines.filter((other) => other.key !== line.key) })}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
