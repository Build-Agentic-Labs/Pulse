"use client";

import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Sop } from "@/domain/sop/schema";
import { getSop } from "@/lib/sop/store";
import { SopEditor } from "./sop-editor";
import { SopShell } from "./sop-shell";

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
  </>
);

export function SopDetailClient() {
  const params = useParams<{ sopId: string }>();
  const [state, setState] = useState<{ status: "pending" | "loaded" | "missing"; sop?: Sop }>({ status: "pending" });

  useEffect(() => {
    const sop = getSop(params.sopId);
    setState(sop ? { status: "loaded", sop } : { status: "missing" });
  }, [params.sopId]);

  if (state.sop) {
    return <SopEditor key={state.sop.id} initial={state.sop} />;
  }

  if (state.status === "missing") {
    return (
      <SopShell sidebar={browseSidebar} back={{ href: "/", label: "Back to planner" }}>
        <div className="flex h-full items-center justify-center p-4">
          <div className="text-center">
            <p className="ui-section-subtitle text-ink-tertiary">This SOP could not be found.</p>
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
