/**
 * Renders ANA's blank general work instruction template as a Word document.
 *
 * Reproduces the letter-portrait AWI (markup in work-instruction-document.tsx,
 * metrics in work-instruction-letter-styles.ts; reference render
 * public/templates/work-instruction-letter-template.pdf):
 *   header  logo + label/title | Rev · Date · Description, framed in #737779
 *   body    label rows (`.wil-summary`), then image | numbered step (`.wil-step`)
 *   footer  document no. ··· Rev. · Page X of Y, then the 6pt line
 *
 * No browser APIs: the caller supplies the logo bytes, so the same builder
 * serves a client download and a Node script.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ITableCellBorders,
  type ParagraphChild,
} from "docx";
import {
  WI_TEMPLATE_CONFIDENTIAL_LINE,
  WI_TEMPLATE_DOC_NUMBER_PROMPT,
  WI_TEMPLATE_IMAGE_PROMPT,
  WI_TEMPLATE_LABEL,
  WI_TEMPLATE_SUMMARY_ROWS,
  blankGeneralWorkInstruction,
  paginateGeneralWorkInstruction,
  type GeneralWorkInstruction,
  type GeneralWorkInstructionStep,
} from "@/domain/quality/work-instruction-template";

/** A step image: PNG bytes plus pixel size, so it can be fitted to its slot. */
export type WorkInstructionImage = { data: Uint8Array; width: number; height: number };
export type WorkInstructionImages = Record<string, WorkInstructionImage>;

// Palette mirrors LETTER_TEMPLATE_STYLES.
const FONT = "Arial";
const INK = "202428";
const LABEL = "62666A";
const PROMPT = "8A8E91";
const FRAME = "737779";
const RULE = "96999B";
const REV_RULE = "B8BABB";
const FOOTNOTE = "777777";

// Twips (1in = 1440); font sizes are half-points (9pt = 18).
const INCH = 1440;
const PX = 15; // one CSS px at 96dpi
const PAGE = { width: 12240, height: 15840 };
const EDGE = Math.round(0.4 * INCH); // .wil-sheet padding
const CONTENT = PAGE.width - EDGE * 2;
const HEADER_HEIGHT = Math.round(0.78 * INCH);
const REVISION_COLUMN = Math.round(2.35 * INCH);
const LOGO_COLUMN = Math.round(1.1 * INCH);
const SUMMARY_LABEL = Math.round(1.05 * INCH);
const IMAGE_COLUMN = Math.round((CONTENT * 2) / 3); // .wil-step 2fr | 1fr
// Page 1 shares its height with the summary band; the continuation page's
// steps grow to fill the sheet.
const STEP_HEIGHT = Math.round(2.55 * INCH);
const CONTINUATION_STEP_HEIGHT = Math.round(2.85 * INCH);

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];
type VAlign = typeof VerticalAlign.TOP | typeof VerticalAlign.CENTER;
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const rule = (color: string) => ({ style: BorderStyle.SINGLE, size: 6, color });
const borders = (edges: Partial<ITableCellBorders> = {}): ITableCellBorders => ({
  top: NONE, bottom: NONE, left: NONE, right: NONE, ...edges,
});
const box = (color: string): ITableCellBorders => ({ top: rule(color), bottom: rule(color), left: rule(color), right: rule(color) });

/** Bracketed prompts print grey italic so an author sees what to replace. */
function text(value: string, size: number, opts: { bold?: boolean; color?: string; spacing?: number; caps?: boolean } = {}): TextRun {
  const prompt = value.startsWith("[");
  return new TextRun({
    text: value,
    font: FONT,
    size,
    bold: opts.bold,
    italics: prompt && !opts.bold,
    allCaps: opts.caps,
    color: prompt ? PROMPT : (opts.color ?? INK),
    characterSpacing: opts.spacing,
  });
}

function para(children: ParagraphChild[], opts: { after?: number; align?: Align; line?: number } = {}): Paragraph {
  return new Paragraph({
    children,
    alignment: opts.align,
    spacing: { before: 0, after: opts.after ?? 0, line: opts.line },
  });
}

function cell(children: (Paragraph | Table)[], width: number, opts: { edges?: Partial<ITableCellBorders>; pad?: [number, number, number?, number?]; valign?: VAlign } = {}): TableCell {
  const [top, right, bottom = top, left = right] = opts.pad ?? [0, 0];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: borders(opts.edges),
    margins: { top, right, bottom, left },
    verticalAlign: opts.valign ?? VerticalAlign.TOP,
    children,
  });
}

function grid(rows: TableRow[], widths: number[], frame: Partial<ITableCellBorders> = {}): Table {
  return new Table({
    width: { size: widths.reduce((sum, w) => sum + w, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { ...borders(frame), insideHorizontal: NONE, insideVertical: NONE },
    rows,
  });
}

// ── Header: `.wil-header` ─────────────────────────────────────────────────────

/** `.wil-revision`: 15 / 37 / 48 %, 7pt, column rules running the full height. */
function revisionTable(doc: GeneralWorkInstruction): Table {
  const widths = [0.15, 0.37].map((pct) => Math.round(REVISION_COLUMN * pct));
  widths.push(REVISION_COLUMN - widths[0] - widths[1]);
  const row = (values: string[], head: boolean) =>
    new TableRow({
      height: { value: head ? 23 * PX : HEADER_HEIGHT - 23 * PX, rule: "exact" },
      children: values.map((value, i) =>
        cell([para([text(value, 14, { bold: head })])], widths[i], {
          edges: { right: i < 2 ? rule(REV_RULE) : NONE, bottom: head ? rule(REV_RULE) : NONE },
          pad: [4 * PX, 6 * PX],
          valign: VerticalAlign.CENTER,
        }),
      ),
    });
  return grid([row(["Rev", "Date", "Description"], true), row([doc.revision, doc.revisionDate, doc.revisionDescription], false)], widths);
}

function documentHeader(doc: GeneralWorkInstruction, logo: Uint8Array | null): Header {
  const titleColumn = CONTENT - LOGO_COLUMN - REVISION_COLUMN;
  // Edges live on the cells, not the table: some editors drop table-level borders.
  const frame = rule(FRAME);
  const logoRun = logo
    ? new ImageRun({ type: "png", data: logo, transformation: { width: 82, height: 23 } })
    : text("ANA INC.", 20, { bold: true });
  return new Header({
    children: [
      grid(
        [
          new TableRow({
            height: { value: HEADER_HEIGHT, rule: "exact" },
            children: [
              cell([para([logoRun], { align: AlignmentType.CENTER })], LOGO_COLUMN, {
                edges: { top: frame, bottom: frame, left: frame },
                pad: [9 * PX, 9 * PX],
                valign: VerticalAlign.CENTER,
              }),
              cell(
                [
                  para([text(WI_TEMPLATE_LABEL, 13, { color: LABEL, spacing: 13, caps: true })], { after: 4 * PX }),
                  para([text(doc.title, 24, { bold: true })], { after: 3 * PX }),
                  // The document number repeats in the header so every page carries its own identity.
                  para([documentNumber(doc.documentNumber, 17)]),
                ],
                titleColumn,
                { edges: { top: frame, bottom: frame, right: frame }, pad: [8 * PX, 10 * PX], valign: VerticalAlign.CENTER },
              ),
              cell([revisionTable(doc)], REVISION_COLUMN, { edges: { top: frame, bottom: frame, right: frame } }),
            ],
          }),
        ],
        [LOGO_COLUMN, titleColumn, REVISION_COLUMN],
      ),
    ],
  });
}

// ── Footer: `.wil-footer` ─────────────────────────────────────────────────────

/** The template's WI-DEPT-### pattern prints grey italic, like every other prompt. */
function documentNumber(value: string, size = 14): TextRun {
  const prompt = !value || value === WI_TEMPLATE_DOC_NUMBER_PROMPT;
  return new TextRun({
    text: value || WI_TEMPLATE_DOC_NUMBER_PROMPT,
    font: FONT,
    size,
    bold: !prompt,
    italics: prompt,
    color: prompt ? PROMPT : INK,
  });
}

function documentFooter(doc: GeneralWorkInstruction): Footer {
  const pageNumber = new TextRun({
    children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
    font: FONT,
    size: 14,
    color: INK,
  });
  // A two-cell row rather than tab stops: tab alignment varies between editors.
  const half = Math.round(CONTENT / 2);
  return new Footer({
    children: [
      grid(
        [
          new TableRow({
            children: [
              cell([para([text("Document no. ", 14), documentNumber(doc.documentNumber)])], half, { pad: [8 * PX, 0, 5 * PX, 0] }),
              cell([para([text(`Rev. ${doc.revision || "____"}      `, 14), pageNumber], { align: AlignmentType.RIGHT })], CONTENT - half, { pad: [8 * PX, 0, 5 * PX, 0] }),
            ],
          }),
        ],
        [half, CONTENT - half],
      ),
      para([text(WI_TEMPLATE_CONFIDENTIAL_LINE, 12, { color: FOOTNOTE, spacing: 7, caps: true })]),
    ],
  });
}

// ── Body ──────────────────────────────────────────────────────────────────────

/** `.wil-summary`: 9pt bold label, 8.5pt content, rule beneath. */
function summaryBand(doc: GeneralWorkInstruction): Table {
  const widths = [SUMMARY_LABEL, CONTENT - SUMMARY_LABEL];
  const values = [doc.purpose, doc.responsibilities];
  const rows = WI_TEMPLATE_SUMMARY_ROWS.map(
    (row, index) =>
      new TableRow({
        height: { value: Math.round(0.5 * INCH), rule: "atLeast" },
        cantSplit: true,
        children: [
          cell([para([text(row.label, 18, { bold: true })])], widths[0], { edges: { bottom: rule(RULE) }, pad: [9 * PX, 0] }),
          cell([para([text(values[index], 17)])], widths[1], { edges: { bottom: rule(RULE) }, pad: [9 * PX, 0, 9 * PX, 8 * PX] }),
        ],
      }),
  );
  return grid(rows, widths);
}

/** `.wil-step-heading`: 25px boxed number, then the bold step title. */
function stepHeading(sequence: number, title: string, width: number): Table {
  const badge = 25 * PX;
  return grid(
    [
      new TableRow({
        height: { value: badge, rule: "exact" },
        children: [
          cell([para([text(String(sequence), 22, { bold: true })], { align: AlignmentType.CENTER })], badge, {
            edges: box(FRAME),
            valign: VerticalAlign.CENTER,
          }),
          cell([para([text(title, 18, { bold: true })])], width - badge, {
            pad: [0, 0, 0, 9 * PX],
            valign: VerticalAlign.CENTER,
          }),
        ],
      }),
    ],
    [badge, width - badge],
  );
}

/** Scale an image to fit its slot (CSS px at 96dpi), never enlarging it. */
function fitImage(image: WorkInstructionImage, slotHeight: number): ImageRun {
  const maxWidth = (IMAGE_COLUMN - 2 * 10 * PX) / PX;
  const maxHeight = (slotHeight - 2 * 10 * PX) / PX;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  return new ImageRun({
    type: "png",
    data: image.data,
    transformation: { width: Math.round(image.width * scale), height: Math.round(image.height * scale) },
  });
}

/** `.wil-instructions`: one paragraph per line, 10pt at 1.5 line height. */
function instructionParagraphs(instruction: string): Paragraph[] {
  return instruction.split("\n").map((line) => para([text(line, 20)], { line: 330, after: 4 * PX }));
}

/** `.wil-step`: image / reference view | numbered instruction body. */
function steps(doc: GeneralWorkInstruction, images: WorkInstructionImages, sequences: number[], height: number): Table {
  const bodyColumn = CONTENT - IMAGE_COLUMN;
  const inner = bodyColumn - 24 * PX;
  const rows = sequences.map((sequence) => {
    const step: GeneralWorkInstructionStep = doc.steps[sequence - 1] ?? { title: "", instruction: "" };
    const image = step.image ? images[step.image] : undefined;
    return new TableRow({
      height: { value: height, rule: "atLeast" },
      cantSplit: true,
      children: [
        cell(
          [para([image ? fitImage(image, height) : text(WI_TEMPLATE_IMAGE_PROMPT, 16, { color: PROMPT })], { align: AlignmentType.CENTER })],
          IMAGE_COLUMN,
          { edges: { right: rule(RULE), bottom: rule(RULE) }, pad: [10 * PX, 10 * PX], valign: VerticalAlign.CENTER },
        ),
        cell(
          [stepHeading(sequence, step.title, inner), para([], { after: 12 * PX }), ...instructionParagraphs(step.instruction)],
          bodyColumn,
          { edges: { bottom: rule(RULE) }, pad: [12 * PX, 12 * PX] },
        ),
      ],
    });
  });
  return grid(rows, [IMAGE_COLUMN, bodyColumn]);
}

/** A near-zero-height paragraph carrying the break, so a full page 1 can't spill it onto a blank page. */
function pageBreak(): Paragraph {
  return new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: "exact" }, children: [new PageBreak()] });
}

function body(doc: GeneralWorkInstruction, images: WorkInstructionImages): (Paragraph | Table)[] {
  return paginateGeneralWorkInstruction(doc.steps.length).flatMap((sequences, page) =>
    page === 0
      ? [summaryBand(doc), steps(doc, images, sequences, STEP_HEIGHT)]
      : [pageBreak(), steps(doc, images, sequences, CONTINUATION_STEP_HEIGHT)],
  );
}

/**
 * Build the Word document. With no `doc` it is the blank template; pass a
 * filled instruction (and the images its steps reference) for a real one.
 */
export function buildWorkInstructionTemplate(
  logo: Uint8Array | null,
  doc: GeneralWorkInstruction = blankGeneralWorkInstruction(),
  images: WorkInstructionImages = {},
): Document {
  return new Document({
    creator: "ANA Inc. — Quality",
    title: doc.title.startsWith("[") ? "ANA Work Instruction Template" : doc.title,
    styles: { default: { document: { run: { font: FONT, size: 18, color: INK } } } },
    sections: [
      {
        properties: {
          page: {
            size: PAGE,
            margin: {
              top: EDGE + HEADER_HEIGHT + 4 * PX,
              bottom: Math.round(0.85 * INCH),
              left: EDGE,
              right: EDGE,
              header: EDGE,
              footer: EDGE,
            },
          },
        },
        headers: { default: documentHeader(doc, logo) },
        footers: { default: documentFooter(doc) },
        children: body(doc, images),
      },
    ],
  });
}
