import { SopList } from "@/components/sop/sop-list";
import { SopWorkspaceProvider } from "@/components/sop/sop-workspace-provider";

export const metadata = {
  title: "SOPs | Pulse",
  description: "Create standardized SOPs and convert legacy documents.",
};

export default function SopsPage() {
  return (
    <SopWorkspaceProvider>
      <SopList />
    </SopWorkspaceProvider>
  );
}
