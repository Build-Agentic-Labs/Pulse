import { SopControlClient } from "@/components/sop/sop-approval-panel";
import { SopWorkspaceProvider } from "@/components/sop/sop-workspace-provider";

export const metadata = {
  title: "SOP control | Pulse",
};

export default function SopControlPage() {
  return (
    <SopWorkspaceProvider>
      <SopControlClient />
    </SopWorkspaceProvider>
  );
}
