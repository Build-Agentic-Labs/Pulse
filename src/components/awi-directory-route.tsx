"use client";

import Link from "next/link";
import { effectiveProductAccess, productAuthorRole } from "@/domain/product-access";
import type { WorkspaceProjectGroup } from "@/domain/types";
import type { AwiMaster } from "@/lib/awi/store";
import { AuthProjectGate } from "./auth-project-gate";
import { AwiDirectory } from "./awi-directory";
import { AwiDirectoryShell } from "./awi-directory-shell";

export function AwiDirectoryRoute({ initialGroups, initialMasters, initialWorkspaceId, requestedWorkspaceId }: {
  initialGroups?: WorkspaceProjectGroup[];
  initialMasters?: AwiMaster[];
  initialWorkspaceId?: string;
  requestedWorkspaceId?: string;
}) {
  return <AuthProjectGate initialGroups={initialGroups} directoryScope="product" renderHome={({ groups }) => {
    const group = requestedWorkspaceId
      ? groups.find((item) => item.workspace.id === requestedWorkspaceId)
      : groups.find((item) => effectiveProductAccess(item) !== "none") ?? groups[0];
    if (!group || effectiveProductAccess(group) === "none") {
      return <AwiDirectoryShell groups={groups}>
        <h1 className="ui-section-title">Product access required</h1>
        <p className="mt-3 text-sm text-ink-secondary">Ask an organization owner or admin for Product access.</p>
        <Link className="ui-btn-ghost mt-4 inline-flex" href="/">Go to home</Link>
      </AwiDirectoryShell>;
    }
    const product = group.projects.find((item) => item.status === "active" && !item.isAwiMaster);
    return <AwiDirectory key={group.workspace.id} groups={groups} workspaceId={group.workspace.id}
      initialMasters={initialWorkspaceId === group.workspace.id ? initialMasters : undefined}
      project={product ? { projectId: product.id, projectName: product.name, workspaceId: group.workspace.id,
        workspaceName: group.workspace.name, role: productAuthorRole(group), accessLevel: effectiveProductAccess(group) } : undefined} />;
  }}>{() => null}</AuthProjectGate>;
}
