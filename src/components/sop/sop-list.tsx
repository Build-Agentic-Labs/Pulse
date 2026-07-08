"use client";

import { Building2, FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { SOP_STATUS_LABELS, type Sop } from "@/domain/sop/schema";
import type { ExtractedSop } from "@/domain/sop/extraction";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import {
  deleteSop,
  listSops,
  readLegacyLocalSops,
  saveSop,
  sopFromExtraction,
  type SopListItem,
} from "@/lib/sop/store";
import { SopConvertOverlay, type ConvertPhase } from "./sop-convert-overlay";
import { SopShell } from "./sop-shell";
import { canEdit, canManage, SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function importDoneKey(workspaceId: string): string {
  return `pulse:sops:import-done:${workspaceId}`;
}

function isImportDone(workspaceId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(importDoneKey(workspaceId)) === "1";
  } catch {
    return true;
  }
}

function markImportDone(workspaceId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(importDoneKey(workspaceId), "1");
  } catch {
    // Ignore storage failures in private browsing.
  }
}

export function SopList() {
  const router = useRouter();
  const confirm = useConfirm();
  const { workspaceId, role } = useSopWorkspace();
  const editable = canEdit(role);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "error">("loading");
  const [convert, setConvert] = useState<{ fileName: string; phase: ConvertPhase } | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [pendingImport, setPendingImport] = useState<Sop[]>([]);
  const [importing, setImporting] = useState(false);
  const converting = convert !== null;

  const refreshList = useCallback(async () => {
    if (!workspaceId) {
      setSops([]);
      setListStatus("ready");
      return [] as SopListItem[];
    }
    setListStatus("loading");
    setError("");
    try {
      const next = await listSops(workspaceId);
      setSops(next);
      setListStatus("ready");
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load SOPs.");
      setListStatus("error");
      return [] as SopListItem[];
    }
  }, [workspaceId]);

  const visibleSops = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return sops;
    }
    return sops.filter(
      (sop) => sop.title.toLowerCase().includes(needle) || sop.sopNumber.toLowerCase().includes(needle),
    );
  }, [sops, query]);

  // Load the workspace's SOPs, then surface any legacy localStorage SOPs not yet in this
  // workspace as a one-time import offer (id-deduped; skipped once dismissed/imported).
  useEffect(() => {
    let active = true;
    void refreshList().then((loaded) => {
      if (!active || !workspaceId) return;
      if (!editable || isImportDone(workspaceId)) {
        setPendingImport([]);
        return;
      }
      const existingIds = new Set(loaded.map((sop) => sop.id));
      setPendingImport(readLegacyLocalSops().filter((sop) => !existingIds.has(sop.id)));
    });
    return () => {
      active = false;
    };
  }, [refreshList, workspaceId, editable]);

  async function handleUpload(file: File) {
    if (!workspaceId) return;
    setConvert({ fileName: file.name, phase: "working" });
    setError("");
    try {
      const supabase = createPlannerSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Sign in before converting SOPs.");
      }

      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/sops/extract", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body,
      });
      const payload = (await response.json()) as { sop?: ExtractedSop; error?: string };
      if (!response.ok || !payload.sop) {
        throw new Error(payload.error || "Conversion failed.");
      }
      const created = sopFromExtraction(payload.sop);
      await saveSop(created, workspaceId);
      // Flip the overlay to its completed state for a beat before opening the editor.
      setConvert((current) => (current ? { ...current, phase: "done" } : current));
      await new Promise((resolve) => setTimeout(resolve, 700));
      router.push(`/sops/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversion failed.");
      setConvert(null);
    }
  }

  async function handleDelete(sop: SopListItem) {
    if (!workspaceId) return;
    const label = sop.title || sop.sopNumber || "this SOP";
    // Soft delete under the hood (deleted_at), but it still leaves the list immediately --
    // confirm so a misclick on the row's trash icon can't silently remove a document.
    const ok = await confirm({
      title: `Delete "${label}"?`,
      body: "It will be removed from the SOP list.",
      tone: "danger",
      confirmLabel: "Delete SOP",
    });
    if (!ok) {
      return;
    }
    const previous = sops;
    setSops((current) => current.filter((entry) => entry.id !== sop.id));
    try {
      await deleteSop(sop.id);
    } catch (caught) {
      setSops(previous);
      setError(caught instanceof Error ? caught.message : "Could not delete SOP.");
    }
  }

  async function handleImport() {
    if (!workspaceId || pendingImport.length === 0) return;
    setImporting(true);
    setError("");
    try {
      for (const sop of pendingImport) {
        await saveSop(sop, workspaceId);
      }
      markImportDone(workspaceId);
      setPendingImport([]);
      await refreshList();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  function handleDismissImport() {
    if (workspaceId) {
      markImportDone(workspaceId);
    }
    setPendingImport([]);
  }

  const sidebar = (
    <>
      <div className="ui-nav-section">SOPs</div>
      <div className="space-y-0.5">
        <Link href="/sops" className="ui-nav-item ui-nav-item-active">
          <FileText size={15} strokeWidth={1.75} />
          <span>All SOPs</span>
        </Link>
        {editable ? (
          <>
            <Link href="/sops/new" className="ui-nav-item ui-nav-item-idle">
              <Plus size={15} strokeWidth={1.75} />
              <span>New SOP</span>
            </Link>
            <button
              type="button"
              className="ui-nav-item ui-nav-item-idle w-full disabled:opacity-50"
              disabled={converting || !workspaceId}
              onClick={() => fileInputRef.current?.click()}
            >
              {converting ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} strokeWidth={1.75} />}
              <span>{converting ? "Converting…" : "Convert old SOP"}</span>
            </button>
          </>
        ) : null}
      </div>
      {canManage(role) ? (
        <>
          <div className="ui-nav-section mt-3">Manage</div>
          <div className="space-y-0.5">
            <Link href="/sops/departments" className="ui-nav-item ui-nav-item-idle">
              <Building2 size={15} strokeWidth={1.75} />
              <span>Departments</span>
            </Link>
          </div>
        </>
      ) : null}
      <SopWorkspaceSwitcher />
    </>
  );

  return (
    <SopShell sidebar={sidebar}>
      {convert ? <SopConvertOverlay fileName={convert.fileName} phase={convert.phase} /> : null}

      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleUpload(file);
        }}
      />

      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="ui-section-title">SOPs</h1>
          <p className="ui-section-subtitle">Create standardized SOPs, or convert an old document into the new format.</p>
        </div>

        {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

        {listStatus === "ready" && sops.length > 0 ? (
          <input
            type="search"
            className="ui-field-standalone w-full"
            placeholder="Search by SOP number or title"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : null}

        {editable && pendingImport.length > 0 ? (
          <div className="ui-notice ui-notice-warn flex flex-wrap items-center gap-3 px-4 py-3">
            <p className="ui-section-subtitle min-w-0 flex-1 text-ink-secondary">
              Import {pendingImport.length} local SOP{pendingImport.length === 1 ? "" : "s"} into this organization?
            </p>
            <button
              type="button"
              className="ui-btn-primary h-8 gap-1.5 px-3 disabled:opacity-50"
              onClick={() => void handleImport()}
              disabled={importing}
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {importing ? "Importing…" : "Import"}
            </button>
            <button type="button" className="ui-btn-ghost h-8 px-3" onClick={handleDismissImport} disabled={importing}>
              Dismiss
            </button>
          </div>
        ) : null}

        <section className="ui-panel divide-y divide-line overflow-hidden">
          {listStatus === "loading" ? (
            <div className="flex items-center justify-center px-4 py-10">
              <Loader2 size={18} className="animate-spin text-ink-tertiary" />
            </div>
          ) : listStatus === "error" ? (
            <div className="px-4 py-10 text-center">
              <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load SOPs."}</p>
              <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refreshList()}>
                Retry
              </button>
            </div>
          ) : sops.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <FileText size={20} className="mx-auto text-ink-tertiary" />
              <p className="mt-2 ui-section-subtitle text-ink-tertiary">
                No SOPs yet. {editable ? "Create one or convert an existing .docx / .pdf." : "Ask an editor to add one."}
              </p>
            </div>
          ) : visibleSops.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="ui-section-subtitle text-ink-tertiary">No SOPs match &ldquo;{query.trim()}&rdquo;.</p>
            </div>
          ) : (
            visibleSops.map((sop) => (
              // The row is a Link (the whole card navigates) with a real sibling delete
              // button -- never a button nested in a button, which is invalid interactive
              // markup and swallows keyboard activation.
              <div
                key={sop.id}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
              >
                <Link
                  href={`/sops/${sop.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <FileText size={15} className="shrink-0 text-ink-tertiary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {sop.title || sop.sopNumber || "Untitled SOP"}
                    </div>
                    <div className="ui-mono-label mt-0.5 truncate text-ink-tertiary">
                      {[sop.sopNumber, sop.version ? `v${sop.version}` : "", sop.source === "converted" ? "converted" : "authored"]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span
                    className={`ui-chip shrink-0 ${
                      sop.status === "approved"
                        ? "border-accent text-accent"
                        : sop.status === "obsolete"
                          ? "border-danger text-danger"
                          : ""
                    }`}
                  >
                    {SOP_STATUS_LABELS[sop.status]}
                  </span>
                  {formatDate(sop.updatedAt) ? (
                    <span className="hidden ui-mono-label text-ink-tertiary sm:inline">{formatDate(sop.updatedAt)}</span>
                  ) : null}
                </Link>
                {editable ? (
                  <button
                    type="button"
                    className="ui-btn-ghost h-8 w-8 shrink-0 px-0 text-ink-tertiary hover:text-danger"
                    title="Delete SOP"
                    onClick={() => void handleDelete(sop)}
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </section>
      </div>
    </SopShell>
  );
}
