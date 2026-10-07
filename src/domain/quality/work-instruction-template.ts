/**
 * Content of ANA's general (non-production) work instruction template — the
 * blank Word document any department (Purchasing, Quality, Logistics…) uses
 * to write a procedure.
 *
 * It is the letter-portrait AWI (src/components/work-instruction/
 * work-instruction-document.tsx) with the production language removed: same
 * header, step layout and footer, but no BOM, tools or safety/PPE.
 *
 * Pure data: the renderer (src/lib/quality/work-instruction-template-docx.ts)
 * owns layout; this module owns what the template asks the author for.
 */

export type TemplateSummaryRow = { label: string; prompt: string };

/** Header label above the title — the AWI reads "Work Instruction" too. */
export const WI_TEMPLATE_LABEL = "Work Instruction";
export const WI_TEMPLATE_TITLE_PROMPT = "[Title]";

/** The AWI's Purpose / scope + Safety / PPE band, with Safety swapped out. */
export const WI_TEMPLATE_SUMMARY_ROWS: TemplateSummaryRow[] = [
  { label: "Purpose / scope", prompt: "[Why this procedure exists and who it applies to.]" },
  { label: "Responsibilities", prompt: "[Roles that act in the steps below.]" },
];

/**
 * Blank step slots per page. Page 1 sits under the Purpose / Responsibilities
 * band; page 2 is a steps-only continuation, like the AWI's — authors
 * duplicate it in Word when they need more.
 */
export const WI_TEMPLATE_STEPS_PER_PAGE = [3, 3] as const;
export const WI_TEMPLATE_STEP_TITLE_PROMPT = "[Step title]";
export const WI_TEMPLATE_STEP_PROMPT = "[Describe the action, starting with a verb.]";
export const WI_TEMPLATE_IMAGE_PROMPT = "Image / reference view";

/**
 * Document numbers follow the SOP convention TYPE-DEPT-NNN (formatSopNumber):
 * WI-PUR-001 = Work Instruction · Purchasing · first in that department's
 * sequence. The blank template shows the pattern for the author to fill in.
 */
export const WI_DOCUMENT_TYPE = "WI";
export const WI_TEMPLATE_DOC_NUMBER_PROMPT = `${WI_DOCUMENT_TYPE}-DEPT-###`;

/** Identical to the AWI footer line. */
export const WI_TEMPLATE_CONFIDENTIAL_LINE =
  "ANA INC. CONFIDENTIAL: This copyrighted work and all information is the property of ANA INC. All rights reserved";

// ── Document content ──────────────────────────────────────────────────────────
// One model renders both the blank template and a filled-in instruction, so
// the two can never drift apart in layout.

export type GeneralWorkInstructionStep = {
  title: string;
  instruction: string;
  /** Key into the renderer's image map; absent = "Image / reference view". */
  image?: string;
};

export type GeneralWorkInstruction = {
  title: string;
  documentNumber: string;
  revision: string;
  revisionDate: string;
  revisionDescription: string;
  purpose: string;
  responsibilities: string;
  steps: GeneralWorkInstructionStep[];
};

export function blankGeneralWorkInstruction(): GeneralWorkInstruction {
  const total = WI_TEMPLATE_STEPS_PER_PAGE.reduce((sum, count) => sum + count, 0);
  return {
    title: WI_TEMPLATE_TITLE_PROMPT,
    documentNumber: WI_TEMPLATE_DOC_NUMBER_PROMPT,
    revision: "",
    revisionDate: "",
    revisionDescription: "",
    purpose: WI_TEMPLATE_SUMMARY_ROWS[0].prompt,
    responsibilities: WI_TEMPLATE_SUMMARY_ROWS[1].prompt,
    steps: Array.from({ length: total }, (_, index) => ({
      title: WI_TEMPLATE_STEP_TITLE_PROMPT,
      instruction: index === 0 ? WI_TEMPLATE_STEP_PROMPT : "",
    })),
  };
}

/**
 * Step numbers per page: the first page holds WI_TEMPLATE_STEPS_PER_PAGE[0],
 * every continuation page the second figure, and a document always has at
 * least the template's two pages.
 */
export function paginateGeneralWorkInstruction(stepCount: number): number[][] {
  const [firstPage, perPage] = WI_TEMPLATE_STEPS_PER_PAGE;
  const pages: number[][] = [];
  let next = 1;
  const minimum = firstPage + perPage;
  const total = Math.max(stepCount, minimum);
  while (next <= total) {
    const size = pages.length === 0 ? firstPage : perPage;
    pages.push(Array.from({ length: Math.min(size, total - next + 1) }, (_, i) => next + i));
    next += size;
  }
  return pages;
}
