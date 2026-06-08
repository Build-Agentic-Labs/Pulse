import { SopNewClient } from "@/components/sop/sop-new-client";
import { SopWorkspaceProvider } from "@/components/sop/sop-workspace-provider";

export const metadata = {
  title: "New SOP | Pulse",
};

export default function NewSopPage() {
  return (
    <SopWorkspaceProvider>
      <SopNewClient />
    </SopWorkspaceProvider>
  );
}
