"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PlanningRoute } from "@/components/planning/planning-route";
import { PlanningShell } from "@/components/planning/planning-shell";
import { usePlanningWorkspace } from "@/components/planning/planning-workspace-provider";
import { NothingLoadingBlock } from "@/components/nothing-ui";
import { getWorkOrder, type WorkOrderDetail } from "@/lib/planning/store";

// Stub detail view: confirms the order was created and is reachable at its id. Task 9 replaces
// this with the full editor (lines, status transitions, etc.).
function WorkOrderDetailStub() {
  const params = useParams<{ id: string }>();
  const { workspaceId } = usePlanningWorkspace();

  const [order, setOrder] = useState<WorkOrderDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "not-found">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!workspaceId || !params.id) {
      return;
    }
    setStatus("loading");
    setError("");
    getWorkOrder(workspaceId, params.id)
      .then((found) => {
        if (!active) return;
        if (!found) {
          setStatus("not-found");
          return;
        }
        setOrder(found);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Could not load the work order.");
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [workspaceId, params.id]);

  return (
    <PlanningShell title={order ? order.orderNo : "Work order"}>
      {status === "loading" ? (
        <NothingLoadingBlock title="Loading work order" />
      ) : status === "not-found" ? (
        <section className="ui-panel p-5">
          <p className="ui-section-subtitle text-ink-tertiary">No work order found for this id.</p>
        </section>
      ) : status === "error" ? (
        <section className="ui-panel p-5">
          <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load the work order."}</p>
        </section>
      ) : (
        <section className="ui-panel p-5">
          <div className="ui-mono-label text-ink-tertiary">Order no.</div>
          <div className="mt-1 font-mono text-lg text-ink">{order?.orderNo}</div>
        </section>
      )}
    </PlanningShell>
  );
}

export default function WorkOrderDetailPage() {
  return (
    <PlanningRoute>
      <WorkOrderDetailStub />
    </PlanningRoute>
  );
}
