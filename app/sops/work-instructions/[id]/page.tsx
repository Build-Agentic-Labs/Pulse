import { WiEditorRoute } from "@/components/quality-wi/wi-editor-route";
import { loadQualityWi, signWiImages } from "@/lib/quality-wi/read-store";
import { qualityWiClient } from "@/lib/quality-wi/client";
import { wiServerSeed } from "@/lib/quality-wi/server-seed";
export const metadata = { title: "Work instruction builder | Pulse" };
export default async function WorkInstructionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.NEXT_PUBLIC_QUALITY_WI_BUILDER_ENABLED === "0")
    return (
      <div className="p-6">
        The work instruction builder is not enabled in this environment.
      </div>
    );
  const { id } = await params;
  const seed = await wiServerSeed(async (workspace, client) => {
    const document = await signWiImages(await loadQualityWi(workspace, id, client), client);
    const { data: canEdit, error } = await qualityWiClient(client).rpc("can_edit_quality_wi_department", { p_department: document.departmentId });
    if (error) throw error;
    return { document, canEdit: Boolean(canEdit) };
  });
  return (
    <WiEditorRoute
      id={id}
      initialWorkspaceId={seed?.workspaceId}
      initialUserId={seed?.userId}
      initialDocument={seed?.value.document}
      initialCanEdit={seed?.value.canEdit}
    />
  );
}
