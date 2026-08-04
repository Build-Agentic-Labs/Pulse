/**
 * Generates a .docx for a SOP, reconstructing the company standard template from
 * scratch with the `docx` library. Runs in the browser (SOPs live in localStorage),
 * so it fetches the embedded ANA logo from /public and packs to a Blob for download.
 *
 * This is a faithful reconstruction, not the literal master file. If byte-for-byte
 * fidelity is ever required, swap this module for a docxtemplater fill of the tagged
 * master — both consume the same `Sop`, so nothing else changes.
 */

"use client";

import type { ApprovalSignatureEntry } from "./approval-entries";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { formatDateControlled } from "@/domain/formatting";
import { classifyProcedureLine } from "@/domain/sop/procedure-text";
import { linkedSopLabel, rasicLegend, type Sop } from "@/domain/sop/schema";
import { renderProcedureFlowImages } from "./procedure-flow-image";

const INK = "1A1A1A";
const MUTED = "666666";
const LINE = "CCCCCC";
const FONT = "Arial";


function sectionHeading(text: string, opts: { pageBreakBefore?: boolean } = {}): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    // Keep a heading with the content that follows so it never orphans at the foot of a page.
    keepNext: true,
    pageBreakBefore: opts.pageBreakBefore,
    children: [new TextRun({ text, bold: true, size: 24, color: INK, font: FONT })],
  });
}

function bodyText(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: text || "—", size: 20, color: text ? INK : MUTED, font: FONT })],
  });
}

function bulletList(items: string[]): Paragraph[] {
  if (items.length === 0) return [bodyText("")];
  return items.map(
    (item) =>
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 40 },
        children: [new TextRun({ text: item, size: 20, color: INK, font: FONT })],
      }),
  );
}

/**
 * The procedure narrative with detected structure (spec 2026-08-04): numbered
 * sub-headings become bold body paragraphs — body size, NOT sectionHeading's
 * size, and not a Word Heading style, so the document's navigation pane and
 * numbering conventions are untouched — and consecutive bullet lines collapse
 * into one real Word bullet list (glyph stripped; Word supplies its own).
 * Flat text (no headings, no bullets) produces exactly the per-line bodyText
 * output this replaced.
 */
function procedureNarrativeBlocks(text: string): Paragraph[] {
  const blocks: Paragraph[] = [];
  let bulletRun: string[] = [];
  const flushBullets = () => {
    if (bulletRun.length === 0) return;
    blocks.push(...bulletList(bulletRun));
    bulletRun = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const classified = classifyProcedureLine(line);
    if (classified.kind === "bullet") {
      bulletRun.push(classified.text);
      continue;
    }
    flushBullets();
    if (classified.kind === "heading") {
      blocks.push(
        new Paragraph({
          spacing: { before: 120, after: 80 },
          children: [new TextRun({ text: classified.text, bold: true, size: 20, color: INK, font: FONT })],
        }),
      );
      continue;
    }
    if (classified.text.trim() === "") {
      // A blank line is paragraph spacing. bodyText("") would render its
      // em-dash empty-state — a literal "—" printed into the Word document —
      // the same leak the preview's nbsp fix closed.
      blocks.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }
    blocks.push(bodyText(classified.text));
  }
  flushBullets();
  return blocks;
}

function cellText(text: string, opts: { bold?: boolean; color?: string } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: text || "", bold: opts.bold, size: 18, color: opts.color ?? INK, font: FONT })],
  });
}

const CELL_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  left: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  right: { style: BorderStyle.SINGLE, size: 4, color: LINE },
};

const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function tableCell(children: Paragraph[], widthPct: number, opts: { shaded?: boolean; bordered?: boolean } = {}): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    borders: opts.bordered === false ? NO_BORDER : CELL_BORDER,
    shading: opts.shaded ? { fill: "F0F0F0" } : undefined,
    children,
  });
}

function dataTable(headers: string[], rows: string[][], widths: number[]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((header, index) =>
      tableCell([cellText(header, { bold: true })], widths[index], { shaded: true }),
    ),
  });

  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map((value, index) => tableCell([cellText(value)], widths[index])),
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  });
}

/** Box border for a Process-step paragraph, so each step reads as a flowchart node. */
const STEP_BOX_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 6, color: INK, space: 4 },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: INK, space: 4 },
  left: { style: BorderStyle.SINGLE, size: 6, color: INK, space: 8 },
  right: { style: BorderStyle.SINGLE, size: 6, color: INK, space: 8 },
};

/**
 * Fallback Procedure flowchart, used when the process map can't be rasterized to an image
 * (e.g. server-side, no <canvas>): a center column of boxed steps joined by down-arrows, with
 * Input / Output / RASIC text aligned beside each step. The table is borderless (no spreadsheet
 * grid) and only the steps are boxed, so it reads as a flowchart, not a table.
 */
function procedureFlowBoxed(sop: Sop): Array<Paragraph | Table> {
  const roles = sop.procedure.roles;
  const widths = [22, 32, 22, 24];

  const labelCell = (text: string, widthPct: number) =>
    tableCell(
      [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text, bold: true, size: 16, color: MUTED, font: FONT })],
        }),
      ],
      widthPct,
      { bordered: false },
    );

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      labelCell("Input", widths[0]),
      labelCell("Process step", widths[1]),
      labelCell("Output", widths[2]),
      labelCell("RASIC", widths[3]),
    ],
  });

  const bodyRows = sop.procedure.activities.map((activity, index) => {
    const isLast = index === sop.procedure.activities.length - 1;
    const stepCell: Paragraph[] = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: STEP_BOX_BORDER,
        spacing: { before: 24, after: 24 },
        children: [
          new TextRun({
            text: activity.description || "—",
            size: 18,
            color: activity.description ? INK : MUTED,
            font: FONT,
          }),
        ],
      }),
    ];
    if (!isLast) {
      stepCell.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 8, after: 8 },
          children: [new TextRun({ text: "↓", size: 18, color: MUTED, font: FONT })],
        }),
      );
    }
    const rasic = roles
      .filter((role) => activity.assignments[role])
      .map((role) => cellText(`${activity.assignments[role]}: ${role}`));
    return new TableRow({
      children: [
        tableCell([cellText(activity.input ?? "")], widths[0], { bordered: false }),
        tableCell(stepCell, widths[1], { bordered: false }),
        tableCell([cellText(activity.output ?? "")], widths[2], { bordered: false }),
        tableCell(rasic.length ? rasic : [cellText("")], widths[3], { bordered: false }),
      ],
    });
  });

  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        ...NO_BORDER,
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      },
      rows: [headerRow, ...bodyRows],
    }),
  ];
}

/**
 * The Procedure flowchart for export. Renders the process map as an embedded PNG so the real
 * flowchart shapes (terminator pill / process rectangle / decision diamond) appear in Word —
 * which can't draw them natively. Falls back to the boxed-paragraph flowchart when the image
 * can't be rasterized (server-side render, no <canvas>, or a tainted canvas).
 */
async function procedureBlocks(sop: Sop): Promise<Array<Paragraph | Table>> {
  const images = await renderProcedureFlowImages(sop);
  // Each flow page starts on a fresh page (page break before), so it has the full body height and
  // never overlaps the footer; a tall flow spans several pages, each repeating the column headers.
  const diagram: Array<Paragraph | Table> = images.length
    ? images.map(
        (img) =>
          new Paragraph({
            pageBreakBefore: true,
            spacing: { after: 80 },
            children: [
              new ImageRun({
                type: "png",
                data: img.data,
                transformation: { width: img.width, height: img.height },
              }),
            ],
          }),
      )
    : procedureFlowBoxed(sop);
  // RASIC legend captioned directly under the diagram.
  const legend = new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [
      new TextRun({ text: `${rasicLegend(".  ")}.`, italics: true, size: 16, color: MUTED, font: FONT }),
    ],
  });
  return [...diagram, legend];
}

async function loadLogo(): Promise<Uint8Array | null> {
  try {
    const response = await fetch("/sop/ana-logo.png");
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function buildHeader(sop: Sop, logo: Uint8Array | null): Header {
  const logoChildren = logo
    ? [new ImageRun({ type: "png", data: logo, transformation: { width: 150, height: 42 } })]
    : [new TextRun({ text: "ANA INC.", bold: true, size: 28, color: INK, font: FONT })];

  const title = `${sop.meta.sopNumber || "SOP-QAS-00X"}: ${sop.meta.title || ""}`.trim();

  // Fully-bordered header box matching the company template: a tall logo + title cell on the
  // left, and three stacked info cells (version / revision / effective) on the right. Every
  // edge is a single border at both the table and cell level, so the box always renders whole.
  const border = { style: BorderStyle.SINGLE, size: 6, color: MUTED };
  const gridBorders = {
    top: border,
    bottom: border,
    left: border,
    right: border,
    insideHorizontal: border,
    insideVertical: border,
  };

  const infoCell = (text: string) =>
    new TableCell({
      width: { size: 25, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.CENTER,
      borders: gridBorders,
      margins: { top: 30, bottom: 30, left: 100, right: 60 },
      children: [new Paragraph({ children: [new TextRun({ text, size: 16, color: INK, font: FONT })] })],
    });

  const logoCell = new TableCell({
    width: { size: 75, type: WidthType.PERCENTAGE },
    rowSpan: 3,
    verticalAlign: VerticalAlign.CENTER,
    borders: gridBorders,
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: logoChildren }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60 },
        children: [new TextRun({ text: title, bold: true, size: 22, color: INK, font: FONT })],
      }),
    ],
  });

  return new Header({
    children: [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: gridBorders,
        rows: [
          new TableRow({ children: [logoCell, infoCell(`Version: ${sop.meta.version || "1.0"}`)] }),
          new TableRow({
            children: [infoCell(`Revision date: ${formatDateControlled(sop.meta.revisionDate) || "MM/DD/YY"}`)],
          }),
          new TableRow({
            children: [infoCell(`Effective date: ${formatDateControlled(sop.meta.effectiveDate) || "MM/DD/YY"}`)],
          }),
        ],
      }),
      new Paragraph({ spacing: { before: 0, after: 0 }, children: [] }),
    ],
  });
}

function buildFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 80 },
        children: [
          new TextRun({ text: "Page ", size: 14, color: MUTED, font: FONT }),
          new TextRun({ children: [PageNumber.CURRENT], size: 14, color: MUTED, font: FONT }),
          new TextRun({ text: " / ", size: 14, color: MUTED, font: FONT }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: MUTED, font: FONT }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text:
              "ANA INC. CONFIDENTIAL: This copyrighted work and all information is the property of ANA INC. All rights reserved",
            size: 12,
            color: MUTED,
            font: FONT,
          }),
        ],
      }),
    ],
  });
}

async function buildBody(
  sop: Sop,
  approvalEntries: readonly ApprovalSignatureEntry[],
): Promise<Array<Paragraph | Table>> {
  const blocks: Array<Paragraph | Table> = [];

  blocks.push(sectionHeading("Purpose"), bodyText(sop.purpose));
  blocks.push(sectionHeading("Scope"), bodyText(sop.scope));

  blocks.push(sectionHeading("Definitions"));
  if (sop.definitions.length) {
    blocks.push(
      dataTable(
        ["Term", "Definition"],
        sop.definitions.map((row) => [row.term, row.definition]),
        [30, 70],
      ),
    );
  } else {
    blocks.push(bodyText(""));
  }

  // One entry per line rather than a "; "-joined sentence. Plain paragraphs, not bulletList:
  // the request was line breaks, and bullets would change the section's visual weight.
  const responsiblePersons = sop.responsiblePersons.filter(Boolean);
  blocks.push(
    sectionHeading("Responsible Person(s)"),
    ...(responsiblePersons.length > 0 ? responsiblePersons.map(bodyText) : [bodyText("")]),
  );
  blocks.push(
    sectionHeading("References"),
    ...bulletList([
      ...sop.linkedSops.map(linkedSopLabel),
      ...(sop.referenceDocs ?? []).map((doc) => doc.name),
      ...sop.references,
    ]),
  );
  blocks.push(sectionHeading("Measurement"), ...bulletList(sop.measurements));

  blocks.push(sectionHeading("Procedure"));
  if (sop.procedure.processFlowDescription) {
    blocks.push(...procedureNarrativeBlocks(sop.procedure.processFlowDescription));
  }
  if (sop.procedure.activities.length) {
    blocks.push(...(await procedureBlocks(sop)));
  }

  // Back matter (forms + history + approvals) starts on its own page, grouped together.
  blocks.push(sectionHeading("Annexes & Forms", { pageBreakBefore: true }));
  if (sop.annexes.length) {
    sop.annexes.forEach((annex) => {
      blocks.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: `${annex.label}: `, bold: true, size: 20, color: INK, font: FONT }),
            new TextRun({ text: annex.description, size: 20, color: INK, font: FONT }),
          ],
        }),
      );
    });
  } else {
    blocks.push(bodyText(""));
  }

  blocks.push(sectionHeading("Change History"));
  blocks.push(
    dataTable(
      ["Version", "Changes", "Created By"],
      sop.changeHistory.map((entry) => [
        entry.version,
        entry.changes,
        [entry.createdByName, entry.createdByPosition, formatDateControlled(entry.createdByDate)].filter(Boolean).join("\n"),
      ]),
      [14, 56, 30],
    ),
  );

  // Built from the approval roster and its signatures -- the same source the PDF uses -- rather
  // than from sop.approvals, which no UI can edit and which is blank on every hand-authored SOP.
  blocks.push(sectionHeading("Change Approvals"));
  blocks.push(
    dataTable(
      ["Approval", "Name", "Position", "Signed"],
      approvalEntries.map((row) => [
        row.approval,
        row.name,
        row.position,
        row.signedAt ? formatDateControlled(row.signedAt.slice(0, 10)) : "Pending signature",
      ]),
      [28, 26, 26, 20],
    ),
  );

  return blocks;
}

/** Build the .docx and return it as a Blob for download. */
/**
 * `approvalEntries` comes from buildApprovalEntries — the same rows the PDF renders. Passing them
 * in rather than deriving them here keeps this module free of Supabase and, more importantly,
 * makes it impossible for the two documents to answer "who approved this?" differently.
 */
export async function exportSopToDocx(
  sop: Sop,
  approvalEntries: readonly ApprovalSignatureEntry[] = [],
): Promise<Blob> {
  const logo = await loadLogo();

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 20, color: INK } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1440, bottom: 1080, left: 1080, right: 1080 } } },
        headers: { default: buildHeader(sop, logo) },
        footers: { default: buildFooter() },
        children: await buildBody(sop, approvalEntries),
      },
    ],
  });

  return Packer.toBlob(doc);
}

/** Build a filesystem-safe download name from the SOP metadata. */
export function exportFileName(sop: Sop): string {
  const base = [sop.meta.sopNumber, sop.meta.title].filter(Boolean).join(" ").trim() || "SOP";
  return `${base.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-")}.docx`;
}
