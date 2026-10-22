import { createEmptySop, RASIC_CODES, SOP_STATUSES, type RasicCode, type Sop } from "./schema";

/** Read-side repair only. Never writes to the stored document or invents procedure content. */
export function normalizeSopDocument(value: unknown, id: string, now: string): { sop: Sop; recovered: boolean } {
  let recovered = false;
  const object = (item: unknown): Record<string, unknown> => {
    if (item && typeof item === "object" && !Array.isArray(item)) return item as Record<string, unknown>;
    recovered = true; return {};
  };
  const text = (item: unknown, fallback = ""): string => {
    if (typeof item === "string") return item;
    recovered = true; return fallback;
  };
  const array = (item: unknown): unknown[] => {
    if (Array.isArray(item)) return item;
    recovered = true; return [];
  };
  const strings = (item: unknown): string[] => array(item).map(entry => text(entry));
  const rows = (item: unknown) => array(item).map(entry => object(entry));
  const blank = createEmptySop(id, now);
  const source = object(value);
  const meta = object(source.meta);
  const procedure = object(source.procedure);
  const sop: Sop = {
    ...source,
    id, createdAt: text(source.createdAt, now), updatedAt: text(source.updatedAt, now),
    status: SOP_STATUSES.includes(source.status as Sop["status"]) ? source.status as Sop["status"] : "draft",
    source: source.source === "converted" ? "converted" : "authored",
    meta: { ...meta, sopNumber: text(meta.sopNumber), title: text(meta.title), version: text(meta.version, "1.0"), revisionDate: text(meta.revisionDate), effectiveDate: text(meta.effectiveDate) },
    purpose: text(source.purpose), scope: text(source.scope),
    definitions: rows(source.definitions).map(row => ({ ...row, term: text(row.term), definition: text(row.definition) })),
    responsiblePersons: strings(source.responsiblePersons), references: strings(source.references), measurements: strings(source.measurements),
    linkedSops: rows(source.linkedSops).map(row => ({ ...row, sopId: text(row.sopId), sopNumber: text(row.sopNumber), title: text(row.title) })),
    referenceDocs: rows(source.referenceDocs).map(row => ({ ...row, id: text(row.id), name: text(row.name) })),
    annexes: rows(source.annexes).map(row => ({ ...row, ...(typeof row.id === "string" ? { id: row.id } : { id: undefined }), label: text(row.label), description: text(row.description) })),
    changeHistory: rows(source.changeHistory).map(row => ({ ...row, version: text(row.version), changes: text(row.changes), createdByName: text(row.createdByName), createdByPosition: text(row.createdByPosition), createdByDate: text(row.createdByDate) })),
    approvals: source.approvals === undefined ? blank.approvals : rows(source.approvals).map(row => ({ ...row, role: text(row.role), name: text(row.name), position: text(row.position), date: text(row.date), ...(typeof row.departmentCode === "string" ? { departmentCode: row.departmentCode } : { departmentCode: undefined }) })),
    procedure: {
      ...procedure, processFlowDescription: text(procedure.processFlowDescription), roles: strings(procedure.roles),
      ...(typeof procedure.processFlowImageKey === "string" ? { processFlowImageKey: procedure.processFlowImageKey } : { processFlowImageKey: undefined }),
      activities: rows(procedure.activities).map((row, index) => {
        const assignments = object(row.assignments);
        const branches = row.decisionBranches == null ? undefined : object(row.decisionBranches);
        return {
          ...row, id: text(row.id, `recovered-step-${index + 1}`) || `recovered-step-${index + 1}`,
          step: typeof row.step === "number" && Number.isFinite(row.step) ? row.step : index + 1,
          shape: row.shape === "decision" || row.shape === "terminator" ? row.shape : "process",
          input: row.input === undefined ? "" : text(row.input), description: text(row.description),
          detail: row.detail === undefined ? "" : text(row.detail), output: row.output === undefined ? "" : text(row.output),
          assignments: Object.fromEntries(Object.entries(assignments).filter(([, code]) => RASIC_CODES.includes(code as RasicCode))) as Record<string, RasicCode>,
          decisionBranches: branches ? { yesTargetActivityId: typeof branches.yesTargetActivityId === "string" ? branches.yesTargetActivityId : null, noTargetActivityId: typeof branches.noTargetActivityId === "string" ? branches.noTargetActivityId : null } : undefined,
        };
      }),
    },
  };
  return { sop, recovered };
}
