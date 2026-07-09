import { EffectiveLibrary } from "@/components/sop/effective-library";
import { SopWorkspaceProvider } from "@/components/sop/sop-workspace-provider";

export const metadata = {
  title: "Effective library | Pulse",
  description: "The single approved, in-force version of every SOP.",
};

export default function SopLibraryPage() {
  return (
    <SopWorkspaceProvider>
      <EffectiveLibrary />
    </SopWorkspaceProvider>
  );
}
