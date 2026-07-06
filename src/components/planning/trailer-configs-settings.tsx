"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { NothingLoadingBlock } from "@/components/nothing-ui";
import type { FeedbackToast } from "@/components/themed-feedback";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import {
  deleteTrailerConfig,
  listTemplates,
  listTrailerConfigs,
  saveTrailerConfig,
  type TemplateSummary,
  type TrailerConfig,
} from "@/lib/planning/store";
import { usePlanningWorkspace } from "./planning-workspace-provider";

const NO_TEMPLATE = "";

/**
 * Trailer supermarket catalog: each single letter (A, B, …) names a standard trailer configuration
 * and optionally links the trailer template that builds it. Generators reference these letters as
 * their default; final assembly matches the letter printed on the Main. Editor-gated (`canWrite`);
 * bumps `onChanged` after any mutation so the template library's default-letter picker refreshes.
 */
export function TrailerConfigsSettings({
  onNotify,
  onChanged,
}: {
  onNotify: (toast: Omit<FeedbackToast, "id">) => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const { workspaceId, canWrite } = usePlanningWorkspace();

  const [configs, setConfigs] = useState<TrailerConfig[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const [newLetter, setNewLetter] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyLetter, setBusyLetter] = useState<string | null>(null);

  const loadSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!workspaceId) {
      setConfigs([]);
      setTemplates([]);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const [nextConfigs, nextTemplates] = await Promise.all([
        listTrailerConfigs(workspaceId),
        listTemplates(workspaceId),
      ]);
      if (seq !== loadSeqRef.current) return;
      setConfigs(nextConfigs);
      setTemplates(nextTemplates);
      setStatus("ready");
    } catch (caught) {
      if (seq !== loadSeqRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load trailer configurations.");
      setStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [refresh]);

  const trailerTemplateOptions = useMemo<ThemedSelectOption[]>(
    () => [
      { value: NO_TEMPLATE, label: "No template" },
      ...templates
        .filter((template) => template.orderType === "trailer")
        .map((template) => ({ value: template.id, label: template.name })),
    ],
    [templates],
  );

  async function persist(config: TrailerConfig, successTitle: string) {
    setBusyLetter(config.letter);
    try {
      await saveTrailerConfig(workspaceId, config);
      // Merge locally so inline edits don't flash while the whole list re-fetches.
      setConfigs((current) => {
        const without = current.filter((existing) => existing.letter !== config.letter);
        return [...without, config].sort((a, b) => a.letter.localeCompare(b.letter));
      });
      onChanged();
      if (successTitle) onNotify({ title: successTitle, tone: "success" });
    } catch (caught) {
      onNotify({
        title: "Could not save configuration",
        body: caught instanceof Error ? caught.message : "Unexpected error.",
        tone: "danger",
      });
      void refresh();
    } finally {
      setBusyLetter(null);
    }
  }

  async function handleAdd() {
    const letter = newLetter.trim().toUpperCase();
    if (!/^[A-Z]$/.test(letter)) {
      onNotify({ title: "Enter a single letter A–Z", tone: "warning" });
      return;
    }
    if (configs.some((config) => config.letter === letter)) {
      onNotify({ title: `Configuration ${letter} already exists`, tone: "warning" });
      return;
    }
    setAdding(true);
    try {
      await saveTrailerConfig(workspaceId, {
        letter,
        name: newName.trim(),
        trailerTemplateId: null,
        updatedAt: "",
      });
      setNewLetter("");
      setNewName("");
      onChanged();
      onNotify({ title: `Added trailer configuration ${letter}`, tone: "success" });
      await refresh();
    } catch (caught) {
      onNotify({
        title: "Could not add configuration",
        body: caught instanceof Error ? caught.message : "Unexpected error.",
        tone: "danger",
      });
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(config: TrailerConfig) {
    const ok = await confirm({
      title: `Delete trailer configuration ${config.letter}?`,
      body: "Generators that default to this letter keep it, but it will no longer appear in pickers.",
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusyLetter(config.letter);
    try {
      await deleteTrailerConfig(workspaceId, config.letter);
      setConfigs((current) => current.filter((existing) => existing.letter !== config.letter));
      onChanged();
      onNotify({ title: `Deleted configuration ${config.letter}`, tone: "success" });
    } catch (caught) {
      onNotify({
        title: "Could not delete configuration",
        body: caught instanceof Error ? caught.message : "Unexpected error.",
        tone: "danger",
      });
    } finally {
      setBusyLetter(null);
    }
  }

  return (
    <section className="ui-panel p-5">
      <div className="ui-setup-section-title">Trailer configurations</div>
      <p className="ui-setup-section-desc">
        Each letter is a standard trailer configuration for the supermarket. Generators reference a letter; final
        assembly matches it.
      </p>

      {status === "loading" ? (
        <div className="mt-4">
          <NothingLoadingBlock title="Loading configurations" />
        </div>
      ) : status === "error" ? (
        <div className="mt-4 ui-notice ui-notice-bad px-4 py-3 ui-section-subtitle">
          {error}
          <button type="button" className="ui-btn-ghost ml-3 inline-flex h-8 px-3" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {configs.length === 0 ? (
            <p className="ui-section-subtitle text-ink-tertiary">No configurations yet.</p>
          ) : (
            configs.map((config) => (
              <div key={config.letter} className="flex flex-wrap items-center gap-3 rounded-md border border-line p-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface-muted font-mono text-lg font-bold text-ink">
                  {config.letter}
                </span>
                <input
                  className="ui-input min-w-[180px] flex-1"
                  defaultValue={config.name}
                  disabled={!canWrite || busyLetter === config.letter}
                  placeholder="Configuration name"
                  aria-label={`Name for configuration ${config.letter}`}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name !== config.name) {
                      void persist({ ...config, name }, "");
                    }
                  }}
                />
                <ThemedSelect
                  value={config.trailerTemplateId ?? NO_TEMPLATE}
                  onChange={(value) =>
                    void persist({ ...config, trailerTemplateId: value === NO_TEMPLATE ? null : value }, "")
                  }
                  options={trailerTemplateOptions}
                  ariaLabel={`Trailer template for configuration ${config.letter}`}
                  disabled={!canWrite || busyLetter === config.letter}
                  className="w-56"
                />
                {canWrite ? (
                  <button
                    type="button"
                    className="ui-btn-ghost h-9 w-9 px-0 text-ink-tertiary hover:text-danger disabled:opacity-40"
                    disabled={busyLetter === config.letter}
                    aria-label={`Delete configuration ${config.letter}`}
                    onClick={() => void handleDelete(config)}
                  >
                    {busyLetter === config.letter ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                ) : null}
              </div>
            ))
          )}

          {canWrite ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <input
                className="ui-input w-16 text-center font-mono uppercase"
                value={newLetter}
                maxLength={1}
                placeholder="A"
                aria-label="New configuration letter"
                onChange={(event) => setNewLetter(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
              />
              <input
                className="ui-input min-w-[180px] flex-1"
                value={newName}
                placeholder="Configuration name (e.g. Dual axle · electric brakes)"
                aria-label="New configuration name"
                onChange={(event) => setNewName(event.target.value)}
              />
              <button
                type="button"
                className="ui-btn-ghost h-9 gap-1.5 px-3 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={adding || !/^[A-Z]$/.test(newLetter)}
                onClick={() => void handleAdd()}
              >
                {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Add configuration
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
