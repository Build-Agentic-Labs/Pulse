import { WorkOrderNew } from "@/components/planning/work-order-new";

export const metadata = {
  title: "New work order | Pulse",
};

/** Auth, workspace and the access gate come from `app/planning/layout.tsx`. */
export default function NewWorkOrderPage() {
  return <WorkOrderNew />;
}
