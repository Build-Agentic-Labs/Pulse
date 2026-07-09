import { redirect } from "next/navigation";

// The Review queue is a tab inside the persistent SOP workspace; keep the old path working.
export default function SopReviewPage() {
  redirect("/sops?tab=review");
}
