/**
 * Sample SOP content for previewing the editor and DOCX export without hand-typing
 * every field. Modeled on the company template's own example (the QMS process map,
 * the ISO 9001 / QMS / SOP definitions, and the standard approval rows).
 */

import type { Sop } from "./schema";

const ROLES = ["Quality", "PJ Mgr / Operations", "HoD"];

const ACTIVITIES: Array<{
  input: string;
  description: string;
  detail?: string;
  output: string;
  shape?: "terminator" | "process" | "decision";
  assignments: Record<string, "R" | "A" | "S" | "I" | "C">;
}> = [
  { input: "", description: "QMS plan", output: "", shape: "terminator", assignments: {} },
  {
    input: "ISO 9001 requirements",
    description: "Define the L1 process map",
    detail: "Define the Level 1 process map covering the Management, Operations, and Support processes, aligned to ISO 9001.",
    output: "ISO 9001-compliant L1 process map",
    assignments: { Quality: "R", "PJ Mgr / Operations": "S" },
  },
  {
    input: "L1 process map",
    description: "Build the L1 process list",
    detail: "Build the ISO 9001-compliant Level 1 process list from the approved process map.",
    output: "ISO 9001-compliant process list",
    assignments: { Quality: "R", "PJ Mgr / Operations": "S" },
  },
  {
    input: "Departmental processes",
    description: "List each department's processes",
    detail: "List the processes of each department to produce the Level 2 process map.",
    output: "Process map L2",
    assignments: { Quality: "R", HoD: "S" },
  },
  {
    input: "SOP template",
    description: "Draft the SOP from the template",
    detail: "Describe the process using the standard SOP template; use addenda for Work Instructions.",
    output: "Process draft",
    assignments: { Quality: "R", HoD: "S" },
  },
  {
    input: "SOP proposal",
    description: "ISO 9001 compliant?",
    detail: "Confirm the SOP's structure and content are aligned with ISO 9001 requirements.",
    output: "Compliance decision",
    shape: "decision",
    assignments: { Quality: "R" },
  },
  {
    input: "Compliant SOP",
    description: "Obtain approval signatures",
    detail: "Obtain signatures from the approval list for SOP approval and release.",
    output: "Approved SOP",
    assignments: { HoD: "A", Quality: "S" },
  },
  {
    input: "Approved SOP",
    description: "Place SOP under document control",
    detail: "Document control: archive, inform, and ensure availability to all interested parties.",
    output: "Officially released SOP",
    assignments: { Quality: "R", HoD: "I" },
  },
  { input: "", description: "QMS documented", output: "", shape: "terminator", assignments: {} },
];

/** Return a copy of `sop` with every section populated with realistic sample data. */
export function applySampleData(sop: Sop): Sop {
  return {
    ...sop,
    meta: {
      sopNumber: "SOP-QA-001",
      title: "QMS",
      version: "1.0",
      revisionDate: "",
      effectiveDate: "",
    },
    purpose:
      "Define and standardize the process for creating, reviewing, approving, and controlling Standard Operating Procedures across the organization in alignment with ISO 9001:2015.",
    scope:
      "Applies to all SOPs and Work Instructions created for Management, Operations, and Support processes across every department.",
    definitions: [
      {
        term: "ISO 9001:2015",
        definition:
          "International standard that defines requirements for a quality management system to help organizations consistently deliver products and services that meet customer and regulatory requirements.",
      },
      { term: "QMS", definition: "Quality Management System." },
      { term: "SOP", definition: "Standard Operating Procedure." },
      { term: "WI", definition: "Work Instruction; a detailed addendum that supports an SOP." },
      { term: "HoD", definition: "Head of Department." },
    ],
    responsiblePersons: ["Quality Manager", "Department Managers / Heads of Department", "Process Owners"],
    references: ["ISO 9001:2015", "Quality Manual QM-01"],
    measurements: ["% of released SOPs", "Average SOP approval cycle time (days)"],
    procedure: {
      processFlowDescription:
        "Starting from the QMS plan, define the process map and process list, author each process with the standard SOP template, verify ISO 9001 compliance, obtain approvals, and place the released SOP under document control.",
      roles: ROLES,
      activities: ACTIVITIES.map((activity, index) => ({
        id: `${sop.id}-sample-${index}`,
        step: index + 1,
        shape: activity.shape,
        input: activity.input,
        description: activity.description,
        detail: activity.detail,
        output: activity.output,
        assignments: activity.assignments,
      })),
    },
    annexes: [
      {
        id: `${sop.id}-annex-sample-0`,
        label: "Appendix A",
        description: "Required information for the document header and footer.",
      },
      {
        id: `${sop.id}-annex-sample-1`,
        label: "Appendix B",
        description: "Work Instruction attributes and template proposal across teams.",
      },
    ],
    changeHistory: [
      {
        version: "1.0",
        changes: "Initial release of the standardized SOP for QMS document control.",
        createdByName: "Robbie Miller",
        createdByPosition: "Quality Manager",
        createdByDate: "2026-05-01",
      },
    ],
    approvals: [
      { role: "Reviewed By", name: "Robbie Miller", position: "Quality Manager", date: "2026-05-03" },
      { role: "Department Manager Release", name: "Dana Cho", position: "Operations Manager", date: "2026-05-08" },
      { role: "Associated Department", name: "Luis Ortega", position: "Engineering Lead", date: "2026-05-09" },
      { role: "Associated Department", name: "Priya Nair", position: "Supply Chain Lead", date: "2026-05-09" },
      { role: "Quality Approval", name: "Sara Whitfield", position: "Director of Quality", date: "2026-05-12" },
    ],
    source: "authored",
  };
}
