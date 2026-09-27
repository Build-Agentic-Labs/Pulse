"use client";

import { useRouter } from "next/navigation";
import { SopReviewLoading } from "./sop-review-loading";
import { QualitySkeleton } from "./quality-skeleton";
import type { SopEditorInitialView } from "./sop-editor";
import { SopShell } from "./sop-shell";
import { SopStepNavIcon } from "./sop-step-nav-icon";
import { SopTabNav } from "./sop-tab-nav";
import { canManage, useSopWorkspace } from "./sop-workspace-provider";
import { useReviewQueueCount } from "@/lib/sop/review-queue-count";

const BUILDER_STEPS = ["Document", "Overview", "Procedure", "Annexes & history", "Approvals"];

function LoadingNavItem({
  label,
  active = false,
  complete = false,
  pending = false,
}: {
  label: string;
  active?: boolean;
  complete?: boolean;
  pending?: boolean;
}) {
  return (
    <span className={`ui-nav-item w-full ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}>
      <SopStepNavIcon active={active} complete={complete} pending={pending} />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    </span>
  );
}

export function BuilderLoadingSidebar({ initialView }: { initialView?: SopEditorInitialView }) {
  const reviewStep =
    initialView === "draft-review" ||
    initialView === "final-approval" ||
    initialView === "quality-approval";

  return (
    <>
      <div className="ui-nav-section">SOP Builder</div>
      <div className="space-y-0.5">
        {BUILDER_STEPS.map((label, index) => (
          <LoadingNavItem
            key={label}
            label={label}
            active={!reviewStep && index === 0}
            complete={reviewStep}
          />
        ))}
        {reviewStep ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="ui-nav-section">Review</div>
            <LoadingNavItem
              label="Draft Review"
              active={initialView === "draft-review"}
              complete={initialView === "final-approval" || initialView === "quality-approval"}
              pending
            />
            <LoadingNavItem
              label="Final Approval"
              active={initialView === "final-approval"}
              complete={initialView === "quality-approval"}
              pending
            />
            {initialView === "quality-approval" ? <LoadingNavItem label="Quality Approval" active /> : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

export function SopDetailLoadingState({ initialView, fromReviewQueue = false }: { initialView?: SopEditorInitialView; fromReviewQueue?: boolean }) {
  const router = useRouter();
  const { role, workspaceId } = useSopWorkspace();
  const reviewCount = useReviewQueueCount(workspaceId);
  const heading =
    initialView === "draft-review"
      ? "Draft review"
      : initialView === "final-approval"
        ? "Final approval"
        : initialView === "quality-approval"
          ? "Quality approval"
          : "Document";

  return (
    <SopShell
      sidebar={fromReviewQueue ? <SopTabNav active="review" manage={canManage(role)} reviewCount={reviewCount} /> : <BuilderLoadingSidebar initialView={initialView} />}
      back={fromReviewQueue ? undefined : { href: "/sops", label: "All SOPs" }}
      crumb={fromReviewQueue ? "Quality / Review queue" : "SOP"}
    >
      {initialView === "draft-review" || initialView === "final-approval" || initialView === "pdf" ? <SopReviewLoading label={initialView === "draft-review" ? "Address feedback" : heading} onClose={() => router.push(fromReviewQueue ? "/sops?tab=review" : "/sops")} /> : <QualitySkeleton variant="form" label={`Opening ${heading}`} reserveClassName="min-h-[300px]" />}
    </SopShell>
  );
}
