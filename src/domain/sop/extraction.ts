/**
 * Shared definitions for converting a legacy SOP's raw text into a structured
 * `Sop` via Claude. The server route (`app/api/sops/extract/route.ts`) feeds the
 * extracted document text to Claude and forces it to call the tool below, so the
 * response is already shaped like our schema — no brittle text parsing.
 */

import type { RasicCode, SopShape } from "./schema";

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
    activities: Array<{
      step: number;
      shape?: SopShape;
      input: string;
      description: string;
      detail?: string;
      output: string;
      /** 1-based destination steps for decisions; null means the process ends. */
      decisionBranches?: {
        yesTargetStep?: number | null;
        noTargetStep?: number | null;
      };
      assignments: Record<string, RasicCode>;
    }>;
  };
  annexes: Array<{ label: string; description: string }>;
  changeHistory: Array<{
    version: string;
    changes: string;
    createdByName: string;
    createdByPosition: string;
    createdByDate: string;
  }>;
  approvals: Array<{ role: string; name: string; position: string; date: string; department: string }>;
}

export const SOP_SYSTEM_PROMPT = `You convert legacy Standard Operating Procedures (SOPs) into a company's standardized structure.

You will receive the content of an old SOP: either the original PDF, or text/HTML extracted from a Word file (HTML markup preserves the source's tables and lists). Embedded images from the source document may be attached alongside the text — these are typically the process flowchart; use them to inform the procedure's steps, flow order, and decision branches. Map the content into the standardized schema by calling the \`emit_sop\` tool exactly once.

Rules:
- Preserve the original wording of the content; reorganize, do not rewrite or summarize, except where a field calls for a short value (e.g. the flowchart \`description\` label — keep the full text in \`detail\`).
- If a section is absent in the source, return an empty string / empty array for it. Never invent content.
- Dates: output ISO format YYYY-MM-DD when a date is clearly present; otherwise leave the string empty.
- "Definitions" are term/definition pairs (acronyms, standards, etc.).
- "Responsible Persons" are the functions/roles accountable for the process, one per array item.
- "Measurements" are KPI lines.
- The Procedure may contain a RASIC responsibility matrix. RASIC means Responsible, Approve, Support, Inform, Consult. If you can identify activities and the roles responsible, populate \`procedure.roles\` with the column role names and give each activity an \`assignments\` map of role-name -> one of R, A, S, I, C. If there is no matrix, leave roles/assignments empty and capture the steps as activity descriptions in order. Assign RASIC by who actually acts on THAT specific step — do not copy every role onto every step. Most steps have a single Responsible plus only the Approve / Support / Inform / Consult roles that genuinely apply. Assign Approve (A) ONLY on the step where approval is actually granted (typically the decision / approval step); a later step that merely acts on or communicates an already-made decision uses R / S / I, not A.
- Each activity is one process step. \`description\` is a SHORT action label for the flowchart box — an imperative phrase of roughly 6-14 words (e.g. "Assess urgency and impact of last-minute order"), never a full paragraph. Put the step's full explanation / procedure wording in \`detail\` (preserve the source text); if the step is already short, \`detail\` may be empty.
- Capture each step's \`input\` (what it needs / consumes to start) and \`output\` (what it produces / hands to the next step) as concise, meaningful business objects, records, decisions, or triggers. Use the source's explicit Input/Output columns when present; otherwise infer a concise phrase. Prefer a clear record / decision name over repeating the previous row's output verbatim. Leave empty only when there is genuinely nothing.
- Set each activity's \`shape\`: "decision" for a yes/no question or a compliance / approval / quality check (often ending in "?"). Use "terminator" ONLY for a pure start- or end-state milestone written as a short noun phrase (e.g. "Order received", "SOP released") — never for an action. If a step is itself an action (receive, assess, communicate, document, notify), it is a "process" step. Everything else is "process".
- For a decision, populate \`decisionBranches\` when the source makes the paths clear. Use the destination activity's 1-based \`step\` for \`yesTargetStep\` and \`noTargetStep\`; use null when that outcome ends the process. Leave a destination omitted rather than guessing. Do not add \`decisionBranches\` to non-decision activities.
- Bracket the flow with terminators: when the process has a clear trigger and a clear final outcome, add a short Start terminator at the very beginning (the triggering event, e.g. "Order request received") and a short End terminator at the very end (the final outcome, e.g. "Escalation record archived"), in addition to the action steps. Terminators are flow markers only — they are NOT numbered in the written procedure list, so every real action must stay a "process" (or "decision") step and never be collapsed into a terminator.
- "Annexes" are appendices / attached forms (label + description).
- Capture any change-history table rows and approval-table rows you find.
- For each approval row set \`department\` to the department that approver signs for, worded as the source document words it. Leave it empty rather than guessing — an empty value is handled, a wrong one has to be undone by hand.
- Line breaks in long fields (\`purpose\`, \`scope\`, \`detail\`, \`procedure.processFlowDescription\`) must be real line breaks in the string value. Never write the two characters backslash-n to mean a new line — that reaches the printed document as literal \\n text rather than a paragraph break.
- In \`procedure.processFlowDescription\`, preserve the source's internal structure as clean text: keep each numbered sub-heading (e.g. "4.4 Document Creation") on its own line exactly as written; render every list item from the source as its own line starting with "• " (bullet + space), regardless of the source's list glyphs; separate paragraphs with a blank line as the source does.`;

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
          sopNumber: { type: "string", description: 'e.g. "SOP-QAS-001"' },
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
              required: ["step", "shape", "input", "description", "detail", "output", "assignments"],
              properties: {
                step: { type: "number" },
                shape: {
                  type: "string",
                  enum: ["terminator", "process", "decision"],
                  description: "Flowchart shape: terminator (first/last step), decision (yes/no or compliance check), or process (normal step)",
                },
                input: { type: "string", description: "Input(s) the step needs; infer a concise phrase, empty only if truly none" },
                description: { type: "string", description: "SHORT action label for the box (~6-14 words), not a paragraph" },
                detail: { type: "string", description: "Full explanation / procedure wording for this step; empty if already captured by description" },
                output: { type: "string", description: "Output(s) the step produces; infer a concise phrase, empty only if truly none" },
                decisionBranches: {
                  type: "object",
                  additionalProperties: false,
                  description: "Optional Yes / No destinations for a decision, using 1-based activity step numbers; null ends the process",
                  properties: {
                    yesTargetStep: {
                      anyOf: [{ type: "number" }, { type: "null" }],
                    },
                    noTargetStep: {
                      anyOf: [{ type: "number" }, { type: "null" }],
                    },
                  },
                },
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
          required: ["role", "name", "position", "date", "department"],
          properties: {
            role: { type: "string" },
            name: { type: "string" },
            position: { type: "string" },
            date: { type: "string" },
            department: {
              type: "string",
              description:
                "The department this approver signs for, named as the source document writes it. Empty when the document does not say and it cannot be inferred with confidence.",
            },
          },
        },
      },
    },
  },
} as const;
