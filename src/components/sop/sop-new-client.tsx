"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { Department } from "@/domain/departments";
import { createEmptySop } from "@/domain/sop/schema";
import { listMyDepartments } from "@/lib/departments/store";
import { newSopId } from "@/lib/sop/store";
import { SopEditor } from "./sop-editor";
import { SopShell } from "./sop-shell";
import { useSopWorkspace } from "./sop-workspace-provider";

/** Shell-wrapped centered message used for the empty / loading / blocked states. */
function NewSopNotice({ children }: { children: ReactNode }) {
  return (
    <SopShell sidebar={<div className="ui-nav-section">SOPs</div>} back={{ href: "/sops", label: "All SOPs" }}>
      <div className="flex h-full items-center justify-center p-4">
        <div className="max-w-md text-center">{children}</div>
      </div>
    </SopShell>
  );
}

export function SopNewClient() {
  const { workspaceId, canEditSops } = useSopWorkspace();
  // Build the blank SOP once, client-side (needs crypto + Date).
  const [initial] = useState(() => createEmptySop(newSopId(), new Date().toISOString()));
  // undefined = not loaded yet; [] = loaded, user is in no department.
  const [myDepartments, setMyDepartments] = useState<Department[] | undefined>(undefined);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setMyDepartments(undefined);
    setLoadError("");
    listMyDepartments(workspaceId)
      .then((rows) => {
        if (active) setMyDepartments(rows);
      })
      .catch((caught) => {
        if (active) setLoadError(caught instanceof Error ? caught.message : "Could not load your departments.");
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  if (!workspaceId) {
    return (
      <NewSopNotice>
        <p className="ui-section-subtitle text-ink-tertiary">Create or select an organization before adding a SOP.</p>
        <Link href="/sops" className="ui-btn-ghost mt-3 inline-flex h-9 px-3">
          Back to SOPs
        </Link>
      </NewSopNotice>
    );
  }

  if (loadError) {
    return (
      <NewSopNotice>
        <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{loadError}</div>
      </NewSopNotice>
    );
  }

  if (myDepartments === undefined) {
    return (
      <NewSopNotice>
        <p className="ui-section-subtitle text-ink-tertiary">Loading your departments…</p>
      </NewSopNotice>
    );
  }

  if (myDepartments.length === 0) {
    return (
      <NewSopNotice>
        <p className="text-sm font-medium text-ink">You’re not in a department yet</p>
        <p className="ui-section-subtitle mt-1 text-ink-secondary">
          SOPs are owned by a department. Ask an organization admin to add you to one, then you can create SOPs.
        </p>
        <Link href="/sops" className="ui-btn-ghost mt-3 inline-flex h-9 px-3">
          Back to SOPs
        </Link>
      </NewSopNotice>
    );
  }

  // isNew keeps autosave off until the first (INSERT) save — without it the editor issues a
  // guarded UPDATE against a row that doesn't exist yet and throws SopConflictError.
  return (
    <SopEditor
      initial={initial}
      workspaceId={workspaceId}
      canEdit={canEditSops}
      isNew
      authoringDepartments={myDepartments}
    />
  );
}
