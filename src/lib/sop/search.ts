import {
  linkedSopLabel,
  SOP_STATUS_LABELS,
  type Sop,
} from "@/domain/sop/schema";

export type SopSearchStepId = "document" | "overview" | "procedure" | "annexes" | "approvals";

export type SopSearchResult = {
  id: string;
  stepId: SopSearchStepId;
  section: string;
  label: string;
  value: string;
};

type SearchEntry = Omit<SopSearchResult, "value"> & { value: string | undefined };

function searchEntries(sop: Sop): SearchEntry[] {
  const entries: SearchEntry[] = [
    { id: "document-number", stepId: "document", section: "Document", label: "SOP number", value: sop.meta.sopNumber },
    { id: "document-title", stepId: "document", section: "Document", label: "Title", value: sop.meta.title },
    { id: "document-version", stepId: "document", section: "Document", label: "Version", value: sop.meta.version },
    { id: "document-status", stepId: "document", section: "Document", label: "Status", value: SOP_STATUS_LABELS[sop.status] },
    { id: "document-revision-date", stepId: "document", section: "Document", label: "Revision date", value: sop.meta.revisionDate },
    { id: "document-effective-date", stepId: "document", section: "Document", label: "Effective date", value: sop.meta.effectiveDate },
    { id: "overview-purpose", stepId: "overview", section: "Overview", label: "Purpose", value: sop.purpose },
    { id: "overview-scope", stepId: "overview", section: "Overview", label: "Scope", value: sop.scope },
    ...sop.definitions.flatMap((row, index) => [
      {
        id: `definition-${index}-term`,
        stepId: "overview" as const,
        section: "Overview",
        label: `Definition ${index + 1} · Term`,
        value: row.term,
      },
      {
        id: `definition-${index}-definition`,
        stepId: "overview" as const,
        section: "Overview",
        label: `Definition ${index + 1}`,
        value: row.definition,
      },
    ]),
    ...sop.references.map((value, index) => ({
      id: `reference-${index}`,
      stepId: "overview" as const,
      section: "Overview",
      label: `Reference ${index + 1}`,
      value,
    })),
    ...sop.linkedSops.map((link, index) => ({
      id: `linked-sop-${index}`,
      stepId: "overview" as const,
      section: "Overview",
      label: `Linked SOP ${index + 1}`,
      value: linkedSopLabel(link),
    })),
    ...sop.referenceDocs.map((doc, index) => ({
      id: `reference-document-${index}`,
      stepId: "overview" as const,
      section: "Overview",
      label: `Reference document ${index + 1}`,
      value: doc.name,
    })),
    ...sop.responsiblePersons.map((value, index) => ({
      id: `responsible-person-${index}`,
      stepId: "procedure" as const,
      section: "Procedure",
      label: `Responsible person ${index + 1}`,
      value,
    })),
    ...sop.measurements.map((value, index) => ({
      id: `measurement-${index}`,
      stepId: "procedure" as const,
      section: "Procedure",
      label: `Measurement ${index + 1}`,
      value,
    })),
    {
      id: "process-flow-description",
      stepId: "procedure",
      section: "Procedure",
      label: "Process flow description",
      value: sop.procedure.processFlowDescription,
    },
    ...sop.procedure.roles.map((value, index) => ({
      id: `process-role-${index}`,
      stepId: "procedure" as const,
      section: "Procedure",
      label: `RASIC role ${index + 1}`,
      value,
    })),
    ...sop.procedure.activities.flatMap((activity) => [
      {
        id: `activity-${activity.id}-description`,
        stepId: "procedure" as const,
        section: "Procedure",
        label: `Activity ${activity.step}`,
        value: activity.description,
      },
      {
        id: `activity-${activity.id}-detail`,
        stepId: "procedure" as const,
        section: "Procedure",
        label: `Activity ${activity.step} · Detail`,
        value: activity.detail,
      },
      {
        id: `activity-${activity.id}-input`,
        stepId: "procedure" as const,
        section: "Procedure",
        label: `Activity ${activity.step} · Input`,
        value: activity.input,
      },
      {
        id: `activity-${activity.id}-output`,
        stepId: "procedure" as const,
        section: "Procedure",
        label: `Activity ${activity.step} · Output`,
        value: activity.output,
      },
      ...Object.entries(activity.assignments).map(([role, code]) => ({
        id: `activity-${activity.id}-assignment-${role}`,
        stepId: "procedure" as const,
        section: "Procedure",
        label: `Activity ${activity.step} · RASIC`,
        value: `${code}: ${role}`,
      })),
    ]),
    ...sop.annexes.flatMap((annex, index) => [
      {
        id: `annex-${index}-label`,
        stepId: "annexes" as const,
        section: "Annexes & history",
        label: `Annex ${index + 1} · Label`,
        value: annex.label,
      },
      {
        id: `annex-${index}-description`,
        stepId: "annexes" as const,
        section: "Annexes & history",
        label: `Annex ${index + 1}`,
        value: annex.description,
      },
    ]),
    ...sop.changeHistory.flatMap((entry, index) => [
      {
        id: `history-${index}-version`,
        stepId: "annexes" as const,
        section: "Annexes & history",
        label: `Change history ${index + 1} · Version`,
        value: entry.version,
      },
      {
        id: `history-${index}-changes`,
        stepId: "annexes" as const,
        section: "Annexes & history",
        label: `Change history ${index + 1}`,
        value: entry.changes,
      },
      {
        id: `history-${index}-author`,
        stepId: "annexes" as const,
        section: "Annexes & history",
        label: `Change history ${index + 1} · Author`,
        value: [entry.createdByName, entry.createdByPosition, entry.createdByDate].filter(Boolean).join(" · "),
      },
    ]),
    ...sop.approvals.flatMap((approval, index) => [
      {
        id: `approval-${index}-role`,
        stepId: "approvals" as const,
        section: "Approvals",
        label: `Approval ${index + 1} · Role`,
        value: approval.role,
      },
      {
        id: `approval-${index}-person`,
        stepId: "approvals" as const,
        section: "Approvals",
        label: `Approval ${index + 1}`,
        value: [approval.name, approval.position, approval.date].filter(Boolean).join(" · "),
      },
    ]),
  ];

  return entries;
}

export function searchSop(sop: Sop, query: string): SopSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  return searchEntries(sop)
    .filter((entry): entry is SopSearchResult => Boolean(entry.value?.trim()))
    .filter((entry) => entry.value.toLocaleLowerCase().includes(needle));
}
