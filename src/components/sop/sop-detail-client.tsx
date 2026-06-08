"use client";

import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getSop, type SopRecord } from "@/lib/sop/store";
import { SopEditor } from "./sop-editor";
import { SopShell } from "./sop-shell";
import { canEdit, SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

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
  | { status: "loaded"; record: SopRecord }
  | { status: "missing" }
  | { status: "error"; message: string };

export function SopDetailClient() {
  const params = useParams<{ sopId: string }>();
  const { role } = useSopWorkspace();
  const [state, setState] = useState<DetailState>({ status: "pending" });

  useEffect(() => {
    let active = true;
    setState({ status: "pending" });
    getSop(params.sopId)
      .then((record) => {
        if (!active) return;
        setState(record ? { status: "loaded", record } : { status: "missing" });
      })
      .catch((error) => {
        if (!active) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Could not load this SOP." });
      });
    return () => {
      active = false;
    };
  }, [params.sopId]);

  if (state.status === "loaded") {
    return (
      <SopEditor
        key={state.record.sop.id}
        initial={state.record.sop}
        workspaceId={state.record.workspaceId}
        canEdit={canEdit(role)}
      />
    );
  }

  if (state.status === "missing" || state.status === "error") {
    return (
      <SopShell sidebar={browseSidebar} back={{ href: "/", label: "Back to planner" }}>
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

  return <div className="fixed inset-0 bg-canvas" />;
}
