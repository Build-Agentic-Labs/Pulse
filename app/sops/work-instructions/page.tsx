import { WiLibrary } from "@/components/quality-wi/wi-library";
import { listQualityWis } from "@/lib/quality-wi/read-store";
import { wiServerSeed } from "@/lib/quality-wi/server-seed";
import { loadWiLibraryDepartments } from "@/lib/quality-wi/library-departments";
export const metadata = { title: "Work Instruction Builder | Pulse" };
export default async function WorkInstructionsPage() {
  if (process.env.NEXT_PUBLIC_QUALITY_WI_BUILDER_ENABLED === "0")
    return (
      <div className="p-6">
        The work instruction builder is not enabled in this environment.
      </div>
    );
  const seed = await wiServerSeed(async (workspaceId, client, userId) => {
    const [rows, departments] = await Promise.all([
      listQualityWis(workspaceId, client),
      loadWiLibraryDepartments(workspaceId, userId, client),
    ]);
    return { rows, departments };
  });
  return (
    <WiLibrary key="drafts"
      initialWorkspaceId={seed?.workspaceId}
      initialUserId={seed?.userId}
      initialRows={seed?.value.rows}
      initialDepartments={seed?.value.departments}
    />
  );
}
