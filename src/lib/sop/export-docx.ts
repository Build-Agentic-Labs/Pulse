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
  WidthType,
} from "docx";
import { rasicLegend, type Sop } from "@/domain/sop/schema";

const INK = "1A1A1A";
const MUTED = "666666";
const LINE = "CCCCCC";
const FONT = "Arial";

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getFullYear()}`;
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
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

function tableCell(children: Paragraph[], widthPct: number, opts: { shaded?: boolean } = {}): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    borders: CELL_BORDER,
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
    ? [new ImageRun({ type: "png", data: logo, transformation: { width: 130, height: 36 } })]
    : [new TextRun({ text: "ANA INC.", bold: true, size: 24, color: INK, font: FONT })];

  const infoLines = [
    `${sop.meta.sopNumber || "SOP-QA-00X"}: ${sop.meta.title || ""}`.trim(),
    `Version: ${sop.meta.version || "1.0"}`,
    `Revision date: ${formatDate(sop.meta.revisionDate) || "MM/DD/YY"}`,
    `Effective date: ${formatDate(sop.meta.effectiveDate) || "MM/DD/YY"}`,
  ];

  return new Header({
    children: [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
          left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 40, type: WidthType.PERCENTAGE },
                borders: { ...CELL_BORDER, top: CELL_BORDER.top, left: CELL_BORDER.left },
                children: [new Paragraph({ children: logoChildren })],
              }),
              new TableCell({
                width: { size: 60, type: WidthType.PERCENTAGE },
                children: infoLines.map(
                  (line) =>
                    new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      children: [new TextRun({ text: line, size: 16, color: MUTED, font: FONT })],
                    }),
                ),
              }),
            ],
          }),
        ],
      }),
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

function buildBody(sop: Sop): Array<Paragraph | Table> {
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

  blocks.push(sectionHeading("Responsible Person(s)"), ...bulletList(sop.responsiblePersons));
  blocks.push(sectionHeading("References"), ...bulletList(sop.references));
  blocks.push(sectionHeading("Measurement"), ...bulletList(sop.measurements));

  blocks.push(sectionHeading("Procedure"));
  if (sop.procedure.processFlowDescription) {
    blocks.push(bodyText(sop.procedure.processFlowDescription));
  }
  blocks.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: rasicLegend(".  ") + ".",
          italics: true,
          size: 16,
          color: MUTED,
          font: FONT,
        }),
      ],
    }),
  );
  if (sop.procedure.activities.length) {
    const roles = sop.procedure.roles;
    const headers = ["#", "Activity", ...roles];
    const remaining = Math.max(20, 70 - roles.length * 8);
    const widths = [6, remaining, ...roles.map(() => (100 - 6 - remaining) / Math.max(1, roles.length))];
    const rows = sop.procedure.activities.map((activity, index) => [
      String(index + 1),
      activity.description,
      ...roles.map((role) => activity.assignments[role] ?? ""),
    ]);
    blocks.push(dataTable(headers, rows, widths));
  }

  blocks.push(sectionHeading("Annexes & Forms"));
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
        [entry.createdByName, entry.createdByPosition, formatDate(entry.createdByDate)].filter(Boolean).join("\n"),
      ]),
      [14, 56, 30],
    ),
  );

  blocks.push(sectionHeading("Change Approvals"));
  blocks.push(
    dataTable(
      ["Approval", "Name", "Position", "Date"],
      sop.approvals.map((row) => [row.role, row.name, row.position, formatDate(row.date)]),
      [28, 26, 26, 20],
    ),
  );

  return blocks;
}

/** Build the .docx and return it as a Blob for download. */
export async function exportSopToDocx(sop: Sop): Promise<Blob> {
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
        children: buildBody(sop),
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
