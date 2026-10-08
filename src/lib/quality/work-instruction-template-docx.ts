/**
 * Renders ANA's blank general work instruction template as a Word document.
 *
 * Reproduces the letter-portrait AWI (markup in work-instruction-document.tsx,
 * metrics in work-instruction-letter-styles.ts; reference render
 * public/templates/work-instruction-letter-template.pdf):
 *   header  centered logo + label/title/number | Rev · Release date
 *   body    label rows (`.wil-summary`), then image | numbered step (`.wil-step`)
 *   footer  document owner ··· Page X of Y, then the 6pt line
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
export type WorkInstructionImage = {
  data: Uint8Array;
  width: number;
  height: number;
};
export type WorkInstructionImages = Record<string, WorkInstructionImage>;

// Palette mirrors LETTER_TEMPLATE_STYLES.
const FONT = "Arial";
const INK = "202428";
const LABEL = "5B6167";
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
const HEADER_HEIGHT = 84 * PX;
const REVISION_COLUMN = 230 * PX;
const LOGO_COLUMN = 108 * PX;
const SUMMARY_LABEL = Math.round(1.05 * INCH);
const IMAGE_COLUMN = Math.round((CONTENT * 2) / 3); // .wil-step 2fr | 1fr
// Page 1 shares its height with the summary band; the continuation page's
// steps grow to fill the sheet.
// Leave room for cell padding, the repeated header, and the footer in Word.
const STEP_HEIGHT = Math.round(2.1 * INCH);
const CONTINUATION_STEP_HEIGHT = Math.round(2.55 * INCH);

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];
type VAlign = typeof VerticalAlign.TOP | typeof VerticalAlign.CENTER;
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const rule = (color: string) => ({ style: BorderStyle.SINGLE, size: 6, color });
const borders = (
  edges: Partial<ITableCellBorders> = {},
): ITableCellBorders => ({
  top: NONE,
  bottom: NONE,
  left: NONE,
  right: NONE,
  ...edges,
});
const box = (color: string): ITableCellBorders => ({
  top: rule(color),
  bottom: rule(color),
  left: rule(color),
  right: rule(color),
});

/** Bracketed prompts print grey italic so an author sees what to replace. */
function text(
  value: string,
  size: number,
  opts: {
    bold?: boolean;
    color?: string;
    spacing?: number;
    caps?: boolean;
  } = {},
): TextRun {
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

function para(
  children: ParagraphChild[],
  opts: { after?: number; align?: Align; line?: number } = {},
): Paragraph {
  return new Paragraph({
    children,
    alignment: opts.align,
    spacing: { before: 0, after: opts.after ?? 0, line: opts.line },
  });
}

function cell(
  children: (Paragraph | Table)[],
  width: number,
  opts: {
    edges?: Partial<ITableCellBorders>;
    pad?: [number, number, number?, number?];
    valign?: VAlign;
  } = {},
): TableCell {
  const [top, right, bottom = top, left = right] = opts.pad ?? [0, 0];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: borders(opts.edges),
    margins: { top, right, bottom, left },
    verticalAlign: opts.valign ?? VerticalAlign.TOP,
    children,
  });
}

function grid(
  rows: TableRow[],
  widths: number[],
  frame: Partial<ITableCellBorders> = {},
): Table {
  return new Table({
    width: { size: widths.reduce((sum, w) => sum + w, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: {
      ...borders(frame),
      insideHorizontal: NONE,
      insideVertical: NONE,
    },
    rows,
  });
}

// ── Header: `.wil-header` ─────────────────────────────────────────────────────

/** Header revision and release date; change descriptions live in the history table. */
function revisionTable(
  doc: GeneralWorkInstruction,
  headerHeight = HEADER_HEIGHT,
): Table {
  const revisionWidth = Math.round(REVISION_COLUMN * 0.3);
  const widths = [revisionWidth, REVISION_COLUMN - revisionWidth];
  const row = (values: string[], head: boolean) =>
    new TableRow({
      height: { value: head ? 23 * PX : headerHeight - 23 * PX, rule: "exact" },
      children: values.map((value, i) =>
        cell([para([text(value, 14, { bold: head })])], widths[i], {
          edges: {
            right: i === 0 ? rule(REV_RULE) : NONE,
            bottom: head ? rule(REV_RULE) : NONE,
          },
          pad: [4 * PX, 6 * PX],
          valign: VerticalAlign.CENTER,
        }),
      ),
    });
  return grid(
    [
      row(["Rev", "Release date"], true),
      row([doc.revision, doc.revisionDate], false),
    ],
    widths,
  );
}

function documentHeader(
  doc: GeneralWorkInstruction,
  logo: Uint8Array | null,
  headerHeight = HEADER_HEIGHT,
): Header {
  const titleColumn = CONTENT - LOGO_COLUMN - REVISION_COLUMN;
  // Edges live on the cells, not the table: some editors drop table-level borders.
  const frame = rule(FRAME);
  const logoRun = logo
    ? new ImageRun({
        type: "png",
        data: logo,
        transformation: { width: 90, height: 26 },
      })
    : text("ANA INC.", 20, { bold: true });
  return new Header({
    children: [
      grid(
        [
          new TableRow({
            height: { value: headerHeight, rule: "exact" },
            children: [
              cell(
                [para([logoRun], { align: AlignmentType.CENTER })],
                LOGO_COLUMN,
                {
                  edges: { top: frame, bottom: frame, left: frame },
                  pad: [9 * PX, 9 * PX],
                  valign: VerticalAlign.CENTER,
                },
              ),
              cell(
                [
                  para(
                    [
                      text(
                        doc.isDraft
                          ? `${WI_TEMPLATE_LABEL} · Draft`
                          : WI_TEMPLATE_LABEL,
                        13,
                        { color: LABEL, caps: true },
                      ),
                    ],
                    { after: 6 * PX },
                  ),
                  para([text(doc.title, 24, { bold: true })], {
                    after: 5 * PX,
                  }),
                  // The document number repeats in the header so every page carries its own identity.
                  para([documentNumber(doc.documentNumber, 15)]),
                ],
                titleColumn,
                {
                  edges: { top: frame, bottom: frame, right: frame },
                  pad: [8 * PX, 10 * PX],
                  valign: VerticalAlign.CENTER,
                },
              ),
              cell([revisionTable(doc, headerHeight)], REVISION_COLUMN, {
                edges: { top: frame, bottom: frame, right: frame },
              }),
            ],
          }),
        ],
        [LOGO_COLUMN, titleColumn, REVISION_COLUMN],
      ),
    ],
  });
}

// ── Footer: `.wil-footer` ─────────────────────────────────────────────────────

function documentNumber(value: string, size = 14): TextRun {
  const prompt = !value || value === WI_TEMPLATE_DOC_NUMBER_PROMPT || /^WI-[A-Z0-9]+-###$/.test(value);
  return new TextRun({ text: value || WI_TEMPLATE_DOC_NUMBER_PROMPT, font: FONT, size,
    bold: !prompt, italics: prompt, color: prompt ? PROMPT : INK });
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
              cell(
                [
                  para([text(`Document Owner: ${doc.authorName?.trim() || "Not recorded"}`, 14)]),
                ],
                half,
                { pad: [8 * PX, 0, 5 * PX, 0] },
              ),
              cell(
                [
                  para(
                    [
                      pageNumber,
                    ],
                    { align: AlignmentType.RIGHT },
                  ),
                ],
                CONTENT - half,
                { pad: [8 * PX, 0, 5 * PX, 0] },
              ),
            ],
          }),
        ],
        [half, CONTENT - half],
      ),
      para([
        text(WI_TEMPLATE_CONFIDENTIAL_LINE, 12, {
          color: FOOTNOTE,
          spacing: 7,
          caps: true,
        }),
      ]),
    ],
  });
}

function revisionHistory(doc: GeneralWorkInstruction): (Paragraph | Table)[] {
  const widths = [0.12, 0.18, 0.46, 0.24].map(fraction => Math.round(CONTENT * fraction));
  const rows = doc.revisionHistory ?? [];
  return [
    new Paragraph({ pageBreakBefore: true, children: [text("Revision history", 22, { bold: true })], spacing: { after: 180 } }),
    grid([
      new TableRow({ tableHeader: true, children: ["Revision", "Release date", "Description of change", "Document Owner"].map((value, i) => cell([para([text(value, 16, { bold: true })])], widths[i], { edges: box(RULE), pad: [100, 100] })) }),
      ...rows.map(row => new TableRow({ children: [row.revision, row.releaseDate, row.description, row.authorName].map((value, i) => cell([para([text(value, 16)])], widths[i], { edges: box(RULE), pad: [100, 100] })) })),
    ] , widths),
    ...(rows.length ? [] : [para([text("No published revisions yet.", 16)])]),
  ];
}

// ── Body ──────────────────────────────────────────────────────────────────────

/** `.wil-summary`: 9pt bold label, 8.5pt content, rule beneath. */
function summaryBand(doc: GeneralWorkInstruction, allowSplit = false): Table {
  const widths = [SUMMARY_LABEL, CONTENT - SUMMARY_LABEL];
  const values = [doc.purpose, doc.responsibilities];
  const rows = WI_TEMPLATE_SUMMARY_ROWS.map(
    (row, index) =>
      new TableRow({
        height: { value: Math.round(0.5 * INCH), rule: "atLeast" },
        cantSplit: !allowSplit,
        children: [
          cell([para([text(row.label, 18, { bold: true })])], widths[0], {
            edges: { bottom: rule(RULE) },
            pad: [9 * PX, 0],
          }),
          cell([para([text(values[index], 17)])], widths[1], {
            edges: { bottom: rule(RULE) },
            pad: [9 * PX, 0, 9 * PX, 8 * PX],
          }),
        ],
      }),
  );
  return grid(rows, widths);
}

/** `.wil-step-heading`: 25px boxed number, then the bold step title. */
function stepHeading(
  sequence: number,
  title: string,
  width: number,
  allowGrowth = false,
): Table {
  const badge = 25 * PX;
  return grid(
    [
      new TableRow({
        height: { value: badge, rule: allowGrowth ? "atLeast" : "exact" },
        children: [
          cell(
            [
              para([text(String(sequence), 22, { bold: true })], {
                align: AlignmentType.CENTER,
              }),
            ],
            badge,
            {
              edges: box(FRAME),
              valign: VerticalAlign.CENTER,
            },
          ),
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
    transformation: {
      width: Math.round(image.width * scale),
      height: Math.round(image.height * scale),
    },
  });
}

/** `.wil-instructions`: one paragraph per line, 10pt at 1.5 line height. */
function instructionParagraphs(instruction: string): Paragraph[] {
  return instruction
    .split("\n")
    .map((line) => para([text(line, 20)], { line: 330, after: 4 * PX }));
}

/** `.wil-step`: image / reference view | numbered instruction body. */
function steps(
  doc: GeneralWorkInstruction,
  images: WorkInstructionImages,
  sequences: number[],
  height: number,
  allowSplit = false,
): Table {
  const bodyColumn = CONTENT - IMAGE_COLUMN;
  const inner = bodyColumn - 24 * PX;
  const rows = sequences.map((sequence) => {
    const step: GeneralWorkInstructionStep = doc.steps[sequence - 1] ?? {
      title: "",
      instruction: "",
    };
    const image = step.image ? images[step.image] : undefined;
    return new TableRow({
      height: { value: height, rule: "atLeast" },
      cantSplit: !allowSplit,
      children: [
        cell(
          [
            para(
              [
                image
                  ? fitImage(image, height)
                  : text(WI_TEMPLATE_IMAGE_PROMPT, 16, { color: PROMPT }),
              ],
              { align: AlignmentType.CENTER },
            ),
          ],
          IMAGE_COLUMN,
          {
            edges: { right: rule(RULE), bottom: rule(RULE) },
            pad: [10 * PX, 10 * PX],
            valign: VerticalAlign.CENTER,
          },
        ),
        cell(
          [
            stepHeading(
              step.sequence ?? sequence,
              step.continued ? `${step.title} (continued)` : step.title,
              inner,
              allowSplit,
            ),
            para([], { after: 12 * PX }),
            ...instructionParagraphs(step.instruction),
          ],
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
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 20, lineRule: "exact" },
    children: [new PageBreak()],
  });
}

function body(
  doc: GeneralWorkInstruction,
  images: WorkInstructionImages,
  filled = false,
  singleStepPages = false,
  headerHeight = HEADER_HEIGHT,
): (Paragraph | Table)[] {
  const pages = singleStepPages
    ? doc.steps.map((_, index) => [index + 1])
    : paginateGeneralWorkInstruction(doc.steps.length, !filled);
  return pages.flatMap((sequences, page) => {
    const available =
      PAGE.height - EDGE - headerHeight - 4 * PX - Math.round(0.85 * INCH);
    const height = singleStepPages
      ? Math.max(
          Math.round(0.5 * INCH),
          available - (page === 0 ? Math.round(1.2 * INCH) : 0) - 64 * PX,
        )
      : filled
        ? Math.round((page === 0 ? 2.25 : 2.55) * INCH)
        : page === 0
          ? STEP_HEIGHT
          : CONTINUATION_STEP_HEIGHT;
    const content = steps(
      doc,
      images,
      sequences,
      height,
      filled && !singleStepPages,
    );
    return page === 0
      ? [summaryBand(doc, filled), content]
      : [pageBreak(), content];
  });
}

/**
 * Build the Word document. With no `doc` it is the blank template; pass a
 * filled instruction (and the images its steps reference) for a real one.
 */
export function buildWorkInstructionTemplate(
  logo: Uint8Array | null,
  doc: GeneralWorkInstruction = blankGeneralWorkInstruction(),
  images: WorkInstructionImages = {},
  options: {
    filledDocument?: boolean;
    headerHeightTwips?: number;
    singleStepPages?: boolean;
  } = {},
): Document {
  const headerHeight = options.headerHeightTwips ?? HEADER_HEIGHT;
  return new Document({
    creator: "ANA Inc. — Quality",
    title: doc.title.startsWith("[")
      ? "ANA Work Instruction Template"
      : doc.title,
    styles: {
      default: { document: { run: { font: FONT, size: 18, color: INK } } },
    },
    sections: [
      {
        properties: {
          page: {
            size: PAGE,
            margin: {
              top: EDGE + headerHeight + 4 * PX,
              bottom: Math.round(0.85 * INCH),
              left: EDGE,
              right: EDGE,
              header: EDGE,
              footer: EDGE,
            },
          },
        },
        headers: { default: documentHeader(doc, logo, headerHeight) },
        footers: { default: documentFooter(doc) },
        children: [...body(
          doc,
          images,
          options.filledDocument,
          options.singleStepPages,
          headerHeight,
        ), ...revisionHistory(doc)],
      },
    ],
  });
}
