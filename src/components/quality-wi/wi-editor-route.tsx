"use client";
import { useEffect, useState } from "react";
import type { QualityWi } from "@/domain/quality-wi/schema";
import { listMyDepartments } from "@/lib/departments/store";
import { loadQualityWi, signWiImages } from "@/lib/quality-wi/read-store";
import { useSopWorkspace } from "@/components/sop/sop-workspace-provider";
import { SopShell } from "@/components/sop/sop-shell";
import { SopTabNav } from "@/components/sop/sop-tab-nav";
import { useWiIdentity } from "./use-wi-identity";
import { QualitySkeleton } from "@/components/sop/quality-skeleton";
import { WiEditor } from "./wi-editor";
import "./quality-wi.css";
export function WiEditorRoute({
  id,
  initialWorkspaceId,
  initialUserId,
  initialDocument,
  initialCanEdit,
}: {
  id: string;
  initialWorkspaceId?: string;
  initialUserId?: string;
  initialDocument?: QualityWi;
  initialCanEdit?: boolean;
}) {
  const { workspaceId, role, canEditSops } = useSopWorkspace();
  const userId = useWiIdentity(initialUserId);
  const [loaded, setLoaded] = useState<{
    scope: string;
    document: QualityWi;
    canEdit: boolean;
  } | null>(() => initialDocument && initialCanEdit !== undefined && initialUserId === userId && initialWorkspaceId === workspaceId
    ? { scope: `${userId}:${workspaceId}:${id}`, document: initialDocument, canEdit: initialCanEdit }
    : null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!workspaceId || !userId) return;
    if (initialDocument && initialCanEdit !== undefined && initialUserId === userId && initialWorkspaceId === workspaceId) {
      setLoaded((current) => current?.scope === `${userId}:${workspaceId}:${id}` ? current : {
        scope: `${userId}:${workspaceId}:${id}`, document: initialDocument, canEdit: initialCanEdit,
      });
      return;
    }
    let active = true;
    setError("");
    const scope = `${userId}:${workspaceId}:${id}`;
    Promise.all([
      loadQualityWi(workspaceId, id),
      listMyDepartments(workspaceId),
    ])
      .then(async ([document, departments]) => {
        const signed = await signWiImages(document);
        if (active)
          setLoaded({
            scope,
            document: signed,
            canEdit:
              canEditSops &&
              (role === "owner" ||
                role === "admin" ||
                departments.some((d) => d.id === document.departmentId)),
          });
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load the work instruction.",
          );
      });
    return () => {
      active = false;
    };
  }, [
    id,
    workspaceId,
    userId,
    role,
    canEditSops,
    initialDocument,
    initialWorkspaceId,
    initialUserId,
    initialCanEdit,
  ]);
  if (userId && loaded?.scope === `${userId}:${workspaceId}:${id}`)
    return (
      <WiEditor
        key={loaded.scope}
        initial={loaded.document}
        userId={userId}
        canEdit={loaded.canEdit}
        manage={role === "owner" || role === "admin"}
      />
    );
  return (
    <SopShell
      sidebar={
        <SopTabNav
          active="work-instructions"
          manage={role === "owner" || role === "admin"}
        />
      }
      crumb="Quality / Work instruction"
    >
      <div className="mx-auto max-w-5xl p-6">
        {error ? <p role="alert">{error}</p> : <QualitySkeleton variant="form" label="Opening work instruction" />}
      </div>
    </SopShell>
  );
}
