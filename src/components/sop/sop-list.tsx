"use client";

import { FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Sop } from "@/domain/sop/schema";
import type { ExtractedSop } from "@/domain/sop/extraction";
import { deleteSop, listSops, saveSop, sopFromExtraction } from "@/lib/sop/store";
import { SopChrome } from "./sop-chrome";

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export function SopList() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sops, setSops] = useState<Sop[]>([]);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSops(listSops());
  }, []);

  async function handleUpload(file: File) {
    setConverting(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/sops/extract", { method: "POST", body });
      const payload = (await response.json()) as { sop?: ExtractedSop; error?: string };
      if (!response.ok || !payload.sop) {
        throw new Error(payload.error || "Conversion failed.");
      }
      const created = sopFromExtraction(payload.sop);
      saveSop(created);
      router.push(`/sops/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversion failed.");
      setConverting(false);
    }
  }

  function handleDelete(id: string) {
    deleteSop(id);
    setSops(listSops());
  }

  return (
    <div className="fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-canvas text-ink">
      <SopChrome />

      <main className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="ui-section-title">SOPs</h1>
              <p className="ui-section-subtitle">Create standardized SOPs, or convert an old document into the new format.</p>
            </div>
            <div className="flex items-center gap-2">
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
              <button
                type="button"
                className="ui-btn-ghost h-9 gap-1.5 px-3 disabled:opacity-50"
                disabled={converting}
                onClick={() => fileInputRef.current?.click()}
              >
                {converting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {converting ? "Converting…" : "Convert old SOP"}
              </button>
              <button
                type="button"
                className="ui-btn-ghost h-9 gap-1.5 px-3"
                onClick={() => router.push("/sops/new")}
              >
                <Plus size={14} />
                New SOP
              </button>
            </div>
          </div>

          {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

          <section className="ui-panel divide-y divide-line overflow-hidden">
            {sops.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <FileText size={20} className="mx-auto text-ink-tertiary" />
                <p className="mt-2 ui-section-subtitle text-ink-tertiary">
                  No SOPs yet. Create one or convert an existing .docx / .pdf.
                </p>
              </div>
            ) : (
              sops.map((sop) => (
                <button
                  key={sop.id}
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
                  onClick={() => router.push(`/sops/${sop.id}`)}
                >
                  <FileText size={15} className="shrink-0 text-ink-tertiary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {sop.meta.title || sop.meta.sopNumber || "Untitled SOP"}
                    </div>
                    <div className="ui-mono-label mt-0.5 truncate text-ink-tertiary">
                      {[sop.meta.sopNumber, `v${sop.meta.version}`, sop.source === "converted" ? "converted" : "authored"]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  {formatDate(sop.updatedAt) ? (
                    <span className="hidden ui-mono-label text-ink-tertiary sm:inline">{formatDate(sop.updatedAt)}</span>
                  ) : null}
                  <span
                    role="button"
                    tabIndex={0}
                    className="ui-btn-ghost h-8 w-8 shrink-0 px-0 text-ink-tertiary hover:text-danger"
                    title="Delete SOP"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDelete(sop.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.stopPropagation();
                        handleDelete(sop.id);
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </span>
                </button>
              ))
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
