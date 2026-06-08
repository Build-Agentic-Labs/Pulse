"use client";

import Link from "next/link";
import { useState } from "react";
import { createEmptySop } from "@/domain/sop/schema";
import { newSopId } from "@/lib/sop/store";
import { SopEditor } from "./sop-editor";
import { SopShell } from "./sop-shell";
import { canEdit, useSopWorkspace } from "./sop-workspace-provider";

export function SopNewClient() {
  const { workspaceId, role } = useSopWorkspace();
  // Build the blank SOP once, client-side (needs crypto + Date).
  const [initial] = useState(() => createEmptySop(newSopId(), new Date().toISOString()));

  if (!workspaceId) {
    return (
      <SopShell sidebar={<div className="ui-nav-section">SOPs</div>} back={{ href: "/sops", label: "All SOPs" }}>
        <div className="flex h-full items-center justify-center p-4">
          <div className="text-center">
            <p className="ui-section-subtitle text-ink-tertiary">Create or select an organization before adding a SOP.</p>
            <Link href="/sops" className="ui-btn-ghost mt-3 inline-flex h-9 px-3">
              Back to SOPs
            </Link>
          </div>
        </div>
      </SopShell>
    );
  }

  return <SopEditor initial={initial} workspaceId={workspaceId} canEdit={canEdit(role)} />;
}
