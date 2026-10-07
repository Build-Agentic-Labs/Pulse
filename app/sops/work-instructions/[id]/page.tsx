import { WiEditorRoute } from "@/components/quality-wi/wi-editor-route";
import { loadQualityWi } from "@/lib/quality-wi/read-store";
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
  const seed = await wiServerSeed((workspace, client) =>
    loadQualityWi(workspace, id, client),
  );
  return (
    <WiEditorRoute
      id={id}
      initialWorkspaceId={seed?.workspaceId}
      initialUserId={seed?.userId}
      initialDocument={seed?.value}
    />
  );
}
