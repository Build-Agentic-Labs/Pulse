"use client";

import { FileText, Loader2, Plus, Search, ShieldCheck, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import type { Department } from "@/domain/departments";
import { SOP_STATUS_LABELS, type Sop } from "@/domain/sop/schema";
import type { ExtractedSop } from "@/domain/sop/extraction";
import { listDepartments } from "@/lib/departments/store";
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
import { canEdit, useSopWorkspace } from "./sop-workspace-provider";

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/** Periodic-review flag for a next-review date: overdue (past) or due soon (within 30 days). */
function reviewFlag(iso: string | null): { label: string; className: string } | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: "overdue", className: "text-danger" };
  if (days <= 30) return { label: "due soon", className: "text-warn" };
  return null;
}

/** Stable soft accent for a department code so filters read as distinct, not identical pills. */
function departmentAccent(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i += 1) {
    hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  }
  const hues = [208, 162, 28, 286, 338, 188, 48, 132, 304, 12, 248];
  const hue = hues[hash % hues.length];
  return `hsl(${hue} 42% 40%)`;
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
  const [departments, setDepartments] = useState<Department[]>([]);
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

  const filteredSops = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sops;
    return sops.filter(
      (sop) => sop.title.toLowerCase().includes(needle) || sop.sopNumber.toLowerCase().includes(needle),
    );
  }, [sops, query]);

  const groups = useMemo(() => {
    const byDept = new Map<string, SopListItem[]>();
    const unassigned: SopListItem[] = [];
    for (const sop of filteredSops) {
      if (!sop.departmentId) {
        unassigned.push(sop);
        continue;
      }
      const list = byDept.get(sop.departmentId) ?? [];
      list.push(sop);
      byDept.set(sop.departmentId, list);
    }
    const ordered: { key: string; department: Department | null; sops: SopListItem[] }[] = departments.map(
      (department) => ({
        key: department.id,
        department,
        sops: byDept.get(department.id) ?? [],
      }),
    );
    for (const [departmentId, list] of byDept) {
      if (departments.some((dept) => dept.id === departmentId)) continue;
      ordered.push({ key: departmentId, department: null, sops: list });
    }
    if (unassigned.length > 0 || departments.length === 0) {
      ordered.push({ key: "unassigned", department: null, sops: unassigned });
    }
    if (query.trim()) {
      return ordered.filter((group) => group.sops.length > 0);
    }
    return ordered;
  }, [filteredSops, departments, query]);

  // Departments power the grouped sections.
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void listDepartments(workspaceId)
      .then((rows) => {
        if (active) setDepartments(rows);
      })
      .catch(() => {
        /* non-fatal: the list still works without department grouping */
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

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

  return (
    <>
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

      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="ui-section-title">SOPs</h1>
            <p className="ui-section-subtitle">
              Organized by department. Create a new SOP, or convert an old document into the new format.
            </p>
          </div>
          {editable ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="ui-btn-ghost h-9 gap-1.5 px-3 disabled:opacity-50"
                disabled={converting || !workspaceId}
                onClick={() => fileInputRef.current?.click()}
              >
                {converting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {converting ? "Converting…" : "Convert"}
              </button>
              <Link href="/sops/new" className="ui-btn-primary h-9 gap-1.5 px-3">
                <Plus size={14} strokeWidth={2} />
                New SOP
              </Link>
            </div>
          ) : null}
        </div>

        {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

        {listStatus === "ready" && sops.length > 0 ? (
          <div className="flex items-center gap-2 border-b border-line pb-2 focus-within:border-ink/40">
            <Search size={14} className="shrink-0 text-ink-tertiary" strokeWidth={1.75} />
            <input
              type="search"
              className="min-w-0 flex-1 bg-transparent text-[13px] font-normal text-ink outline-none placeholder:text-ink-tertiary"
              placeholder="Search by SOP number or title"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
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

        {listStatus === "loading" ? (
          <section className="ui-panel flex items-center justify-center px-4 py-10">
            <Loader2 size={18} className="animate-spin text-ink-tertiary" />
          </section>
        ) : listStatus === "error" ? (
          <section className="ui-panel px-4 py-10 text-center">
            <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load SOPs."}</p>
            <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refreshList()}>
              Retry
            </button>
          </section>
        ) : sops.length === 0 ? (
          <section className="ui-panel px-4 py-10 text-center">
            <FileText size={20} className="mx-auto text-ink-tertiary" />
            <p className="mt-2 ui-section-subtitle text-ink-tertiary">
              No SOPs yet. {editable ? "Create one or convert an existing .docx / .pdf." : "Ask an editor to add one."}
            </p>
          </section>
        ) : filteredSops.length === 0 ? (
          <section className="ui-panel px-4 py-10 text-center">
            <p className="ui-section-subtitle text-ink-tertiary">No SOPs match &ldquo;{query.trim()}&rdquo;.</p>
          </section>
        ) : (
          <div className="space-y-8">
            {groups.map((group) => {
              const name =
                group.department?.name ?? (group.key === "unassigned" ? "Unassigned" : "Unknown department");
              const accent = departmentAccent(group.department?.code ?? group.key);
              const count = group.sops.length;

              return (
                <section key={group.key} className="space-y-2.5">
                  <div className="flex items-baseline justify-between gap-3 px-0.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: accent }}
                        aria-hidden
                      />
                      <h2 className="truncate text-[15px] font-semibold tracking-tight text-ink">{name}</h2>
                    </div>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-tertiary">
                      {count} {count === 1 ? "SOP" : "SOPs"}
                    </span>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-line bg-surface">
                    <div className="ui-table-scroll">
                      <table className="w-full min-w-[680px] border-collapse text-left">
                        <thead>
                          <tr className="border-b border-line">
                            <th className="w-36 px-5 py-3 text-[11px] font-medium text-ink-secondary">Number</th>
                            <th className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Title</th>
                            <th className="w-32 px-5 py-3 text-[11px] font-medium text-ink-secondary">Status</th>
                            <th className="w-28 px-5 py-3 text-[11px] font-medium text-ink-secondary">Updated</th>
                            <th className="w-24 px-3 py-3"><span className="sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {count === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-5 py-8 text-center text-[13px] text-ink-tertiary">
                                No SOPs yet
                              </td>
                            </tr>
                          ) : (
                            group.sops.map((sop) => {
                              const flag = reviewFlag(sop.nextReviewDate);
                              return (
                                <tr
                                  key={sop.id}
                                  className="group border-b border-line/70 transition-colors last:border-b-0 hover:bg-surface-hover"
                                >
                                <td className="px-5 py-3.5 align-middle">
                                  <Link
                                    href={`/sops/${sop.id}`}
                                    className="font-mono text-[12px] tracking-wide text-ink-secondary hover:text-ink"
                                  >
                                    {sop.sopNumber || "—"}
                                  </Link>
                                </td>
                                <td className="max-w-0 px-5 py-3.5 align-middle">
                                  <Link href={`/sops/${sop.id}`} className="block min-w-0">
                                    <span className="block truncate text-[13px] font-medium leading-snug text-ink">
                                      {sop.title || sop.sopNumber || "Untitled SOP"}
                                    </span>
                                    {flag ? (
                                      <span className={`mt-1 block text-[11px] ${flag.className}`}>{flag.label}</span>
                                    ) : null}
                                  </Link>
                                </td>
                                <td className="px-5 py-3.5 align-middle">
                                  <span
                                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                      sop.status === "approved"
                                        ? "bg-accent/10 text-accent"
                                        : sop.status === "effective"
                                          ? "bg-success/10 text-success"
                                          : sop.status === "obsolete"
                                            ? "bg-danger/10 text-danger"
                                            : "bg-surface-muted text-ink-secondary"
                                    }`}
                                  >
                                    {SOP_STATUS_LABELS[sop.status]}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5 align-middle text-[12px] tabular-nums text-ink-tertiary">
                                  {formatDate(sop.updatedAt) || "—"}
                                </td>
                                <td className="px-2 py-2.5 align-middle">
                                  <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                                    <Link
                                      href={`/sops/${sop.id}/control`}
                                      className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-ink"
                                      title="Document control & approval"
                                    >
                                      <ShieldCheck size={14} />
                                    </Link>
                                    {editable ? (
                                      <button
                                        type="button"
                                        className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-danger"
                                        title="Delete SOP"
                                        onClick={() => void handleDelete(sop)}
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              );
            })}

          </div>
        )}
      </div>
    </>
  );
}
