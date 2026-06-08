import { SopDetailClient } from "@/components/sop/sop-detail-client";
import { SopWorkspaceProvider } from "@/components/sop/sop-workspace-provider";

export const metadata = {
  title: "Edit SOP | Pulse",
};

export default function SopDetailPage() {
  return (
    <SopWorkspaceProvider>
      <SopDetailClient />
    </SopWorkspaceProvider>
  );
}
