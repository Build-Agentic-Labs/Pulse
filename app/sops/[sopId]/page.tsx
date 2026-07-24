import { SopDetailClient } from "@/components/sop/sop-detail-client";
import type { SopEditorInitialView } from "@/components/sop/sop-editor";
import { fetchSopDetailInitialData } from "@/lib/sop/detail-data.server";

export const metadata = {
  title: "Edit SOP | Pulse",
};

export default async function SopDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sopId: string }>;
  searchParams: Promise<{ preview?: string; step?: string }>;
}) {
  const [{ sopId }, query] = await Promise.all([params, searchParams]);
  const initialView: SopEditorInitialView | undefined = query.preview === "pdf"
    ? "pdf"
    : query.step === "draft-review" || query.step === "final-approval" || query.step === "quality-approval"
      ? query.step
      : undefined;
  let initial;
  try {
    initial = await fetchSopDetailInitialData(sopId);
  } catch {
    // Preserve the existing client fallback for expired sessions or transient
    // reads while keeping the normal path server-composed.
  }
  return <SopDetailClient key={sopId} initial={initial} initialView={initialView} />;
}
