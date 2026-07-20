import { redirect } from "next/navigation";

// Department and SOP-access administration now lives in the system Settings space.
export default function DepartmentsPage() {
  redirect("/settings?section=quality");
}
