import { DepartmentsAdmin } from "@/components/sop/departments-admin";
import { SopWorkspaceProvider } from "@/components/sop/sop-workspace-provider";

export const metadata = {
  title: "Departments | Pulse",
  description: "Manage SOP departments, their members, and the independent Quality gate.",
};

export default function DepartmentsPage() {
  return (
    <SopWorkspaceProvider>
      <DepartmentsAdmin />
    </SopWorkspaceProvider>
  );
}
