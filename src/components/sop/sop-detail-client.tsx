"use client";

import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Department } from "@/domain/departments";
import { listDepartments, listMyDepartments } from "@/lib/departments/store";
import type { SopDetailInitialData } from "@/lib/sop/detail-data";
import { getSop, type SopRecord } from "@/lib/sop/store";
import { SopDetailLoadingState } from "./sop-detail-loading-state";
import { SopEditor, type SopEditorInitialView } from "./sop-editor";
import { SopShell } from "./sop-shell";
import { SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

const browseSidebar = (
  <>
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
  | { status: "loaded"; record: SopRecord; department?: Department; myDepartmentIds: string[] }
  | { status: "missing" }
  | { status: "error"; message: string };

export function SopDetailClient({
  initial,
  initialView,
}: {
  initial?: SopDetailInitialData;
  initialView?: SopEditorInitialView;
}) {
  const params = useParams<{ sopId: string }>();
  const searchParams = useSearchParams();
  const { canEditSops, workspaceId } = useSopWorkspace();
  const [state, setState] = useState<DetailState>(() => initial
    ? {
        status: "loaded",
        record: initial.record,
        department: initial.department,
        myDepartmentIds: initial.myDepartmentIds,
      }
    : { status: "pending" });

  useEffect(() => {
    if (initial) return;
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
          myDepartmentIds: myDepartments.map((item) => item.id),
        });
      })
      .catch((error) => {
        if (!active) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Could not load this SOP." });
      });
    return () => {
      active = false;
    };
  }, [params.sopId, initial]);

  if (state.status === "loaded") {
    return (
      <SopEditor
        key={state.record.sop.id}
        initial={state.record.sop}
        workspaceId={state.record.workspaceId}
        owningDepartment={state.department}
        canEdit={
          workspaceId === state.record.workspaceId &&
          canEditSops &&
          (!state.record.departmentId || state.myDepartmentIds.includes(state.record.departmentId))
        }
        initialApprovalRouting={initial?.approval}
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

  return <SopDetailLoadingState initialView={initialView} fromReviewQueue={searchParams.get("via") === "review"} />;
}
