import { SopDetailClient } from "@/components/sop/sop-detail-client";
import type { SopEditorInitialView } from "@/components/sop/sop-editor";

export const metadata = {
  title: "Edit SOP | Pulse",
};

export default async function SopDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; step?: string }>;
}) {
  const query = await searchParams;
  const initialView: SopEditorInitialView | undefined = query.preview === "pdf"
    ? "pdf"
    : query.step === "draft-review" || query.step === "final-approval" || query.step === "quality-approval"
      ? query.step
      : undefined;
  return <SopDetailClient initialView={initialView} />;
}
