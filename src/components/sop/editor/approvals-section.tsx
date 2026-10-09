import { Loader2 } from "lucide-react";
import type { Department, DeptRole } from "@/domain/departments";
import type { Sop } from "@/domain/sop/schema";
import type { SopReviewSeat } from "@/lib/sop/review";
import type { RefreshOptions } from "@/lib/coalesced-refresh";
import { SopRosterEditor } from "../sop-roster-editor";

export function SopApprovalsSection({
  approvalRoutingError,
  approvalRoutingLoading,
  hasPersistedSop,
  canEdit,
  sop,
  approvalAuthorId,
  approvalDepartments,
  approvalSeats,
  approvalMyDeptRoles,
  selectedDepartmentId,
  handleMapApproval,
  refreshApprovalRouting,
}: {
  approvalRoutingError: string;
  approvalRoutingLoading: boolean;
  hasPersistedSop: boolean;
  canEdit: boolean;
  sop: Sop;
  approvalAuthorId: string | null;
  approvalDepartments: Department[];
  approvalSeats: SopReviewSeat[];
  approvalMyDeptRoles: Map<string, DeptRole>;
  selectedDepartmentId: string;
  handleMapApproval: (index: number, departmentCode: string) => Promise<void>;
  refreshApprovalRouting: (options: RefreshOptions) => Promise<void>;
}) {
  return (
    <>
      {approvalRoutingError ? (
        <div className="ui-notice ui-notice-warn px-4 py-3 text-xs">
          {approvalRoutingError}
        </div>
      ) : null}
      {approvalRoutingLoading ? (
        <section className="ui-panel flex min-h-32 items-center justify-center">
          <Loader2 size={18} className="animate-spin text-ink-tertiary" />
        </section>
      ) : hasPersistedSop && canEdit ? (
        <SopRosterEditor
          sopId={sop.id}
          authorId={approvalAuthorId ?? undefined}
          departments={approvalDepartments}
          seats={approvalSeats}
          myDeptRoles={approvalMyDeptRoles}
          owningDepartmentId={selectedDepartmentId || undefined}
          convertedApprovals={
            sop.source === "converted" ? sop.approvals : undefined
          }
          onMapApproval={handleMapApproval}
          onChanged={() =>
            refreshApprovalRouting({ background: true, force: true })
          }
        />
      ) : (
        <section className="ui-panel overflow-hidden">
          <div className="border-b border-line px-4 py-3 ui-mono-label text-ink-tertiary">
            Approval routing
          </div>
          <div className="divide-y divide-line">
            {approvalSeats.length ? (
              approvalSeats.map((seat) => {
                const department = approvalDepartments.find(
                  (item) => item.id === seat.departmentId,
                );
                return (
                  <div
                    key={seat.departmentId}
                    className="flex items-center gap-3 px-4 py-3 text-sm"
                  >
                    <span className="ui-chip">{department?.code ?? "—"}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {department?.name ?? "Unknown department"}
                    </span>
                    <span className="ui-mono-label text-ink-tertiary">
                      Required approval
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="px-4 py-8 text-center text-xs text-ink-tertiary">
                {hasPersistedSop
                  ? "No department routing configured."
                  : "Save the draft to configure department routing."}
              </p>
            )}
          </div>
        </section>
      )}
    </>
  );
}
