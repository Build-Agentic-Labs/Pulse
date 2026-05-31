"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Sop } from "@/domain/sop/schema";
import { getSop } from "@/lib/sop/store";
import { SopChrome } from "./sop-chrome";
import { SopEditor } from "./sop-editor";

export function SopDetailClient() {
  const params = useParams<{ sopId: string }>();
  const [state, setState] = useState<{ status: "loading" | "missing"; sop?: Sop }>({ status: "loading" });

  useEffect(() => {
    const sop = getSop(params.sopId);
    setState(sop ? { status: "loading", sop } : { status: "missing" });
  }, [params.sopId]);

  if (state.sop) {
    return <SopEditor key={state.sop.id} initial={state.sop} />;
  }

  if (state.status === "missing") {
    return (
      <div className="fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-canvas text-ink">
        <SopChrome />
        <main className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="text-center">
            <p className="ui-section-subtitle text-ink-tertiary">This SOP could not be found.</p>
            <Link href="/sops" className="ui-btn-ghost mt-3 inline-flex h-9 px-3">
              Back to SOPs
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return <div className="fixed inset-0 bg-canvas" />;
}
