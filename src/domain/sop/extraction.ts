/**
 * Shared definitions for converting a legacy SOP's raw text into a structured
 * `Sop` via Claude. The server route (`app/api/sops/extract/route.ts`) feeds the
 * extracted document text to Claude and forces it to call the tool below, so the
 * response is already shaped like our schema — no brittle text parsing.
 */

import type { RasicCode } from "./schema";

/** Default extraction model; override with SOP_EXTRACTION_MODEL in the environment. */
export const DEFAULT_EXTRACTION_MODEL = "claude-sonnet-4-6";

/** The subset of `Sop` that Claude fills in from a legacy document. */
export interface ExtractedSop {
  meta: {
    sopNumber: string;
    title: string;
    version: string;
    revisionDate: string;
    effectiveDate: string;
  };
  purpose: string;
  scope: string;
  definitions: Array<{ term: string; definition: string }>;
  responsiblePersons: string[];
  references: string[];
  measurements: string[];
  procedure: {
    processFlowDescription: string;
    roles: string[];
    activities: Array<{ step: number; description: string; assignments: Record<string, RasicCode> }>;
  };
  annexes: Array<{ label: string; description: string }>;
  changeHistory: Array<{
    version: string;
    changes: string;
    createdByName: string;
    createdByPosition: string;
    createdByDate: string;
  }>;
  approvals: Array<{ role: string; name: string; position: string; date: string }>;
}

export const SOP_SYSTEM_PROMPT = `You convert legacy Standard Operating Procedures (SOPs) into a company's standardized structure.

You will receive the raw text of an old SOP (extracted from a PDF or Word file). Map its content into the standardized schema by calling the \`emit_sop\` tool exactly once.

Rules:
- Preserve the original wording of the content; reorganize, do not rewrite or summarize unless a field clearly calls for a short value.
- If a section is absent in the source, return an empty string / empty array for it. Never invent content.
- Dates: output ISO format YYYY-MM-DD when a date is clearly present; otherwise leave the string empty.
- "Definitions" are term/definition pairs (acronyms, standards, etc.).
- "Responsible Persons" are the functions/roles accountable for the process, one per array item.
- "Measurements" are KPI lines.
- The Procedure may contain a RASIC responsibility matrix. If you can identify activities and the roles responsible, populate \`procedure.roles\` with the column role names and give each activity an \`assignments\` map of role-name -> one of R, A, S, I, C. If there is no matrix, leave roles/assignments empty and capture the steps as activity descriptions in order.
- "Annexes" are appendices / attached forms (label + description).
- Capture any change-history table rows and approval-table rows you find.`;

/** JSON Schema for the Anthropic tool input — mirrors `ExtractedSop`. */
export const SOP_EXTRACTION_TOOL = {
  name: "emit_sop",
  description: "Return the legacy SOP content mapped into the standardized SOP schema.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "meta",
      "purpose",
      "scope",
      "definitions",
      "responsiblePersons",
      "references",
      "measurements",
      "procedure",
      "annexes",
      "changeHistory",
      "approvals",
    ],
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["sopNumber", "title", "version", "revisionDate", "effectiveDate"],
        properties: {
          sopNumber: { type: "string", description: 'e.g. "SOP-QA-001"' },
          title: { type: "string" },
          version: { type: "string" },
          revisionDate: { type: "string", description: "ISO YYYY-MM-DD or empty" },
          effectiveDate: { type: "string", description: "ISO YYYY-MM-DD or empty" },
        },
      },
      purpose: { type: "string" },
      scope: { type: "string" },
      definitions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["term", "definition"],
          properties: { term: { type: "string" }, definition: { type: "string" } },
        },
      },
      responsiblePersons: { type: "array", items: { type: "string" } },
      references: { type: "array", items: { type: "string" } },
      measurements: { type: "array", items: { type: "string" } },
      procedure: {
        type: "object",
        additionalProperties: false,
        required: ["processFlowDescription", "roles", "activities"],
        properties: {
          processFlowDescription: { type: "string" },
          roles: { type: "array", items: { type: "string" } },
          activities: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["step", "description", "assignments"],
              properties: {
                step: { type: "number" },
                description: { type: "string" },
                assignments: {
                  type: "object",
                  additionalProperties: { type: "string", enum: ["R", "A", "S", "I", "C"] },
                },
              },
            },
          },
        },
      },
      annexes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "description"],
          properties: { label: { type: "string" }, description: { type: "string" } },
        },
      },
      changeHistory: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["version", "changes", "createdByName", "createdByPosition", "createdByDate"],
          properties: {
            version: { type: "string" },
            changes: { type: "string" },
            createdByName: { type: "string" },
            createdByPosition: { type: "string" },
            createdByDate: { type: "string" },
          },
        },
      },
      approvals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["role", "name", "position", "date"],
          properties: {
            role: { type: "string" },
            name: { type: "string" },
            position: { type: "string" },
            date: { type: "string" },
          },
        },
      },
    },
  },
} as const;
