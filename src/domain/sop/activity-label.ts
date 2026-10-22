export function automaticRoutingDetails(eventType: string, details: unknown): { title: string; reason: string } | null {
  const value = typeof details === "object" && details !== null ? details as Record<string, unknown> : {};
  if (eventType === "final_approval_requested" && value.automatic === true) {
    return { title: "Automatically routed for signatures", reason: "All required approvers returned no comments on the current content." };
  }
  if (eventType === "status_changed" && value.to_status === "approved") {
    return { title: "Automatically routed to Quality", reason: "Every required department signature has been captured." };
  }
  return null;
}
