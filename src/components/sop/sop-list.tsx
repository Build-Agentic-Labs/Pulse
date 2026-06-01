"use client";

import { FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Sop } from "@/domain/sop/schema";
import type { ExtractedSop } from "@/domain/sop/extraction";
import { deleteSop, listSops, saveSop, sopFromExtraction } from "@/lib/sop/store";
import { SopConvertOverlay, type ConvertPhase } from "./sop-convert-overlay";
import { SopShell } from "./sop-shell";

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export function SopList() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sops, setSops] = useState<Sop[]>([]);
  const [convert, setConvert] = useState<{ fileName: string; phase: ConvertPhase } | null>(null);
  const [error, setError] = useState("");
  const converting = convert !== null;

  useEffect(() => {
    setSops(listSops());
  }, []);

  async function handleUpload(file: File) {
    setConvert({ fileName: file.name, phase: "working" });
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
      // Flip the overlay to its completed state for a beat before opening the editor.
      setConvert((current) => (current ? { ...current, phase: "done" } : current));
      await new Promise((resolve) => setTimeout(resolve, 700));
      router.push(`/sops/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversion failed.");
      setConvert(null);
    }
  }

  function handleDelete(id: string) {
    deleteSop(id);
    setSops(listSops());
  }

  const sidebar = (
    <>
      <div className="ui-nav-section">SOPs</div>
      <div className="space-y-0.5">
        <Link href="/sops" className="ui-nav-item ui-nav-item-active">
          <FileText size={15} strokeWidth={1.75} />
          <span>All SOPs</span>
        </Link>
        <Link href="/sops/new" className="ui-nav-item ui-nav-item-idle">
          <Plus size={15} strokeWidth={1.75} />
          <span>New SOP</span>
        </Link>
        <button
          type="button"
          className="ui-nav-item ui-nav-item-idle w-full disabled:opacity-50"
          disabled={converting}
          onClick={() => fileInputRef.current?.click()}
        >
          {converting ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} strokeWidth={1.75} />}
          <span>{converting ? "Converting…" : "Convert old SOP"}</span>
        </button>
      </div>
    </>
  );

  return (
    <SopShell sidebar={sidebar} back={{ href: "/", label: "Back to planner" }}>
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
    </SopShell>
  );
}
