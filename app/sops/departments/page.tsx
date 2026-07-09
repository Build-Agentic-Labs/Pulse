import { redirect } from "next/navigation";

// Departments is a tab inside the persistent SOP workspace; keep the old path working.
export default function DepartmentsPage() {
  redirect("/sops?tab=departments");
}
