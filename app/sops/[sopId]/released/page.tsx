import { ReleasedSopViewer } from "@/components/sop/released-sop-viewer";
export default async function ReleasedSopPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  return <ReleasedSopViewer sopId={sopId} />;
}
