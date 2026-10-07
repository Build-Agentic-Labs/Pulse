import { WiLibrary } from "@/components/quality-wi/wi-library";
import { listQualityWis } from "@/lib/quality-wi/read-store";
import { wiServerSeed } from "@/lib/quality-wi/server-seed";
export const metadata = { title: "Work instructions | Pulse" };
export default async function WorkInstructionsPage() {
  if (process.env.NEXT_PUBLIC_QUALITY_WI_BUILDER_ENABLED === "0")
    return (
      <div className="p-6">
        The work instruction builder is not enabled in this environment.
      </div>
    );
  const seed = await wiServerSeed(listQualityWis);
  return (
    <WiLibrary
      initialWorkspaceId={seed?.workspaceId}
      initialUserId={seed?.userId}
      initialRows={seed?.value}
    />
  );
}
