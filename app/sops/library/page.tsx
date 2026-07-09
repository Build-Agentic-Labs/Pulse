import { redirect } from "next/navigation";

// The Effective library is a tab inside the persistent SOP workspace; keep the old path working.
export default function SopLibraryPage() {
  redirect("/sops?tab=library");
}
