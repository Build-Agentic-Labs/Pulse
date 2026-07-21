"use client";

import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { NothingSpinner } from "@/components/nothing-ui";
import type { Department } from "@/domain/departments";
import { listDepartments, listMyDepartments } from "@/lib/departments/store";
import { getSop, type SopRecord } from "@/lib/sop/store";
import { SopEditor, type SopEditorInitialView } from "./sop-editor";
import { SopShell } from "./sop-shell";
import { SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

const browseSidebar = (
  <>
    <div className="ui-nav-section">SOPs</div>
    <div className="space-y-0.5">
      <Link href="/sops" className="ui-nav-item ui-nav-item-idle">
        <FileText size={15} strokeWidth={1.75} />
        <span>All SOPs</span>
      </Link>
      <Link href="/sops/new" className="ui-nav-item ui-nav-item-idle">
        <Plus size={15} strokeWidth={1.75} />
        <span>New SOP</span>
      </Link>
    </div>
    <SopWorkspaceSwitcher />
  </>
);

type DetailState =
  | { status: "pending" }
  | { status: "loaded"; record: SopRecord; department?: Department; canEdit: boolean }
  | { status: "missing" }
  | { status: "error"; message: string };

export function SopDetailClient({ initialView }: { initialView?: SopEditorInitialView }) {
  const params = useParams<{ sopId: string }>();
  const { canEditSops } = useSopWorkspace();
  const [state, setState] = useState<DetailState>({ status: "pending" });

  useEffect(() => {
    let active = true;
    setState({ status: "pending" });
    getSop(params.sopId)
      .then(async (record) => {
        if (!active) return;
        if (!record) {
          setState({ status: "missing" });
          return;
        }
        const [departments, myDepartments] = record.departmentId
          ? await Promise.all([listDepartments(record.workspaceId), listMyDepartments(record.workspaceId)])
          : [[], []];
        if (!active) return;
        setState({
          status: "loaded",
          record,
          department: departments.find((item) => item.id === record.departmentId),
          canEdit:
            canEditSops &&
            record.sop.status === "draft" &&
            (!record.departmentId || myDepartments.some((item) => item.id === record.departmentId)),
        });
      })
      .catch((error) => {
        if (!active) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Could not load this SOP." });
      });
    return () => {
      active = false;
    };
  }, [params.sopId, canEditSops]);

  if (state.status === "loaded") {
    return (
      <SopEditor
        key={state.record.sop.id}
        initial={state.record.sop}
        workspaceId={state.record.workspaceId}
        owningDepartment={state.department}
        canEdit={state.canEdit}
        initialView={initialView}
      />
    );
  }

  if (state.status === "missing" || state.status === "error") {
    return (
      <SopShell sidebar={browseSidebar}>
        <div className="flex h-full items-center justify-center p-4">
          <div className="text-center">
            <p className="ui-section-subtitle text-ink-tertiary">
              {state.status === "error" ? state.message : "This SOP could not be found."}
            </p>
            <Link href="/sops" className="ui-btn-ghost mt-3 inline-flex h-9 px-3">
              Back to SOPs
            </Link>
          </div>
        </div>
      </SopShell>
    );
  }

  // PDF preview entry: render the preview's own backdrop and a blank letter page
  // while the SOP loads, so the document appears in place with no app-shell or
  // spinner flash in between.
  if (initialView === "pdf") {
    return (
      <div className="sop-preview-pending" aria-busy="true" aria-label="Loading document preview">
        <style>{`
          .sop-preview-pending {
            position: fixed; inset: 0; z-index: 60;
            display: flex; flex-direction: column;
            background: rgba(15, 18, 21, 0.62);
          }
          .sop-preview-pending-bar {
            flex: none; height: 57px;
            background: var(--color-surface, #fff);
            border-bottom: 1px solid var(--color-line, #ddd);
          }
          .sop-preview-pending-scroll { flex: 1; overflow: hidden; padding: 24px 16px; }
          .sop-preview-pending-page {
            width: 8.5in; max-width: 100%; height: 11in; margin: 0 auto;
            background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3);
            animation: sop-preview-pending-pulse 1.6s ease-in-out infinite;
          }
          @keyframes sop-preview-pending-pulse { 50% { opacity: .82; } }
          @media (prefers-reduced-motion: reduce) { .sop-preview-pending-page { animation: none; } }
        `}</style>
        <div className="sop-preview-pending-bar" />
        <div className="sop-preview-pending-scroll">
          <div className="sop-preview-pending-page" />
        </div>
      </div>
    );
  }

  // Loading: keep the app frame up (sidebar + chrome) with a centered spinner so opening a
  // SOP doesn't flash a blank white canvas before the editor mounts.
  return (
    <SopShell sidebar={browseSidebar}>
      <div className="flex h-full items-center justify-center p-4">
        <NothingSpinner />
      </div>
    </SopShell>
  );
}
