import { ReviewQueue } from "@/components/sop/review-queue";
import { SopWorkspaceProvider } from "@/components/sop/sop-workspace-provider";

export const metadata = {
  title: "Review queue | Pulse",
  description: "SOPs awaiting review and approval.",
};

export default function SopReviewPage() {
  return (
    <SopWorkspaceProvider>
      <ReviewQueue />
    </SopWorkspaceProvider>
  );
}
