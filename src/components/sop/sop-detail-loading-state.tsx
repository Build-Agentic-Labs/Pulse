"use client";

import { QuietLoading } from "@/components/quiet-loading";
import type { SopEditorInitialView } from "./sop-editor";
import { SopShell } from "./sop-shell";

const BUILDER_STEPS = ["Document", "Overview", "Procedure", "Annexes & history", "Approvals"];

function LoadingNavItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <span className={`ui-nav-item w-full ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {active ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    </span>
  );
}

function BuilderLoadingSidebar({ initialView }: { initialView?: SopEditorInitialView }) {
  const reviewStep =
    initialView === "draft-review" ||
    initialView === "final-approval" ||
    initialView === "quality-approval";

  return (
    <>
      <div className="ui-nav-section">SOP Builder</div>
      <div className="space-y-0.5">
        {BUILDER_STEPS.map((label, index) => (
          <LoadingNavItem key={label} label={label} active={!reviewStep && index === 0} />
        ))}
        {reviewStep ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="ui-nav-section">Review</div>
            <LoadingNavItem label="Draft Review" active={initialView === "draft-review"} />
            <LoadingNavItem label="Final Approval" active={initialView === "final-approval"} />
            {initialView === "quality-approval" ? <LoadingNavItem label="Quality Approval" active /> : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

export function SopDetailLoadingState({ initialView }: { initialView?: SopEditorInitialView }) {
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
      sidebar={<BuilderLoadingSidebar initialView={initialView} />}
      back={{ href: "/sops", label: "All SOPs" }}
      crumb="SOP"
    >
      <QuietLoading label={`Opening ${heading}`} reserveClassName="min-h-[300px]" />
    </SopShell>
  );
}
