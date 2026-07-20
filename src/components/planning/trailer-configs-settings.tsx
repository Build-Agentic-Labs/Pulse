"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { NothingLoadingBlock } from "@/components/nothing-ui";
import type { FeedbackToast } from "@/components/themed-feedback";
import { deleteTrailerConfig, listTrailerConfigs, saveTrailerConfig, type TrailerConfig } from "@/lib/planning/store";
import { usePlanningWorkspace } from "./planning-workspace-provider";

/**
 * One editable catalog row. Name is a controlled input resynced from `config.name` so a failed
 * save that reverts via a re-fetch — or an external change — is reflected.
 */
function TrailerConfigRow({
  config,
  canWrite,
  busy,
  onSaveName,
  onDelete,
}: {
  config: TrailerConfig;
  canWrite: boolean;
  busy: boolean;
  onSaveName: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(config.name);
  useEffect(() => setName(config.name), [config.name]);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center text-[13px] font-semibold text-ink">
        {config.letter}
      </span>
      <input
        className="ui-input min-w-[180px] flex-1"
        value={name}
        disabled={!canWrite || busy}
        placeholder="Configuration name"
        aria-label={`Name for configuration ${config.letter}`}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const trimmed = name.trim();
          if (trimmed !== config.name) {
            onSaveName(trimmed);
          }
        }}
      />
      {canWrite ? (
        <button
          type="button"
          className="ui-btn-ghost h-9 w-9 px-0 text-ink-tertiary hover:text-danger disabled:opacity-40"
          disabled={busy}
          aria-label={`Delete configuration ${config.letter}`}
          onClick={onDelete}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Trailer supermarket catalog: each single letter (E, S, …) names a standard trailer configuration.
 * Generators reference these letters; final assembly matches the letter printed on the Main.
 * No linked "trailer work-order template" — MTS sheet clones are not catalog source of truth.
 */
export function TrailerConfigsSettings({
  onNotify,
}: {
  onNotify: (toast: Omit<FeedbackToast, "id">) => void;
}) {
  const confirm = useConfirm();
  const { workspaceId, canWrite } = usePlanningWorkspace();

  const [configs, setConfigs] = useState<TrailerConfig[]>([]);
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
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const nextConfigs = await listTrailerConfigs(workspaceId);
      if (seq !== loadSeqRef.current) return;
      setConfigs(nextConfigs);
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

  async function persist(config: TrailerConfig, successTitle: string) {
    setBusyLetter(config.letter);
    try {
      await saveTrailerConfig(workspaceId, config);
      setConfigs((current) => {
        const without = current.filter((existing) => existing.letter !== config.letter);
        return [...without, config].sort((a, b) => a.letter.localeCompare(b.letter));
      });
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
      body: "Generators that reference this letter keep it, but it will no longer appear in pickers.",
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusyLetter(config.letter);
    try {
      await deleteTrailerConfig(workspaceId, config.letter);
      setConfigs((current) => current.filter((existing) => existing.letter !== config.letter));
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
    <section className="ui-settings-section">
      <h3 className="ui-settings-section-title">Trailer configurations</h3>
      <p className="ui-settings-section-desc">
        Each letter is a standard trailer configuration for the supermarket. Generators reference a letter; final
        assembly matches it on the printed Main sheet.
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
              <TrailerConfigRow
                key={config.letter}
                config={config}
                canWrite={canWrite}
                busy={busyLetter === config.letter}
                onSaveName={(name) => void persist({ ...config, name }, "")}
                onDelete={() => void handleDelete(config)}
              />
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
                placeholder="Configuration name (e.g. Electric, Surge / Hydraulic)"
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
