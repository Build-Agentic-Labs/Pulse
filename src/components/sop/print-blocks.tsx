import type { ReactNode } from "react";
import { formatDateControlled } from "@/domain/formatting";
import type { PlacedLineRange } from "@/domain/sop/pagination";
import { classifyProcedureLine } from "@/domain/sop/procedure-text";
import { linkedSopLabel, type Sop } from "@/domain/sop/schema";

/** A leaf block before measurement. Task 3 adds `height`/`lineHeight`. */
export interface PrintBlock {
  id: string;
  category: string;
  sectionTitle: string;
  keepWithNext?: boolean;
  splittable?: boolean;
  /** `lineRange` is supplied when the packer cut this block across pages. */
  render: (lineRange?: PlacedLineRange) => ReactNode;
}

/**
 * Interactive and component-state content is injected here, keeping this
 * module pure of preview state.
 */
export interface PrintBlockExtras {
  /** References section: the preview injects the linked-SOP anchor and annex-open button. */
  renderLinkedSop?: (link: Sop["linkedSops"][number]) => ReactNode;
  renderReferenceDoc?: (doc: NonNullable<Sop["referenceDocs"]>[number]) => ReactNode;
  /** Change History author column ("system author" + formatDateControlled join). */
  changeAuthor?: (entry: Sop["changeHistory"][number]) => string;
  /** Whole approvals table, one atomic trailing block; omitted → section omitted. */
  approvalsTable?: ReactNode;
  /** "Attached form: …" annotations under annex rows, keyed by annex id. */
  annexFileLines?: Map<string, { name: string; error?: string }>;
  annexLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Shared block shells.
//
// Every block is self-contained: its `render` output includes its own
// `.sop-export-section` shell (plus `data-review-category`), so a page
// (visible or offscreen) is just placed blocks stacked in order — no
// grouping helper whose visible and offscreen versions could diverge.
// ---------------------------------------------------------------------------

/**
 * A section heading. Keeps the natural `margin-top: 12px` — the gap above a
 * section belongs to its heading. `.sop-export-section:first-child` absorbs
 * it at the top of a page.
 */
function headingBlock(id: string, category: string, sectionTitle: string): PrintBlock {
  return {
    id,
    category,
    sectionTitle,
    keepWithNext: true,
    render: () => (
      <section className="sop-export-section" data-review-category={category}>
        <h2>{sectionTitle}</h2>
      </section>
    ),
  };
}

/** The EmptyAwareText em-dash convention, as a self-contained content block. */
function emptyBlock(id: string, category: string, sectionTitle: string): PrintBlock {
  return {
    id,
    category,
    sectionTitle,
    render: () => (
      <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category={category}>
        <p className="sop-export-empty">—</p>
      </section>
    ),
  };
}

/** One list entry as a self-contained single-item list — a non-splittable row. */
function listItemBlock(id: string, category: string, sectionTitle: string, content: ReactNode): PrintBlock {
  return {
    id,
    category,
    sectionTitle,
    render: () => (
      <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category={category}>
        <ul className="sop-export-list">
          <li>{content}</li>
        </ul>
      </section>
    ),
  };
}

interface TableColumn {
  width: string;
}

/** The header-row block: a thead-only table sharing the data rows' colgroup. */
function tableHeaderBlock(
  id: string,
  category: string,
  sectionTitle: string,
  columns: TableColumn[],
  headerCells: ReactNode[],
): PrintBlock {
  return {
    id,
    category,
    sectionTitle,
    render: () => (
      <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category={category}>
        <table className="sop-export-table">
          <colgroup>
            {columns.map((column, index) => (
              <col key={index} style={{ width: column.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {headerCells.map((cell, index) => (
                <th key={index}>{cell}</th>
              ))}
            </tr>
          </thead>
        </table>
      </section>
    ),
  };
}

/**
 * One data row as a self-contained single-row table with the full colgroup
 * repeated — identical percentage columns under `table-layout: fixed` keep
 * every row's columns aligned across stacked tables. `borderTop: 0` on every
 * cell stops the row's own top border from doubling the 1px seam against
 * whatever is stacked directly above it (the header block, or another row).
 */
function tableRowBlock(
  id: string,
  category: string,
  sectionTitle: string,
  columns: TableColumn[],
  cells: ReactNode[],
): PrintBlock {
  return {
    id,
    category,
    sectionTitle,
    render: () => (
      <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category={category}>
        <table className="sop-export-table">
          <colgroup>
            {columns.map((column, index) => (
              <col key={index} style={{ width: column.width }} />
            ))}
          </colgroup>
          <tbody>
            <tr>
              {cells.map((cell, index) => (
                <td key={index} style={{ borderTop: 0 }}>
                  {cell}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>
    ),
  };
}

// ---------------------------------------------------------------------------
// The prose helper, which every text section routes through. A cut fragment
// renders the whole paragraph inside a clipping window offset to its line
// range — never a sliced string, which would re-wrap the remainder at
// different points than the measured pass and detach the packer's arithmetic
// from what is on screen. Because the window starts exactly at a wrapped
// line boundary, no stray leading whitespace can appear on a continuation;
// the spec's trim requirement is satisfied by construction.
// ---------------------------------------------------------------------------

function proseBlocks(category: string, sectionTitle: string, value: string): PrintBlock[] {
  // One block per line. A paragraph containing no newline stays a single block and
  // is still marked splittable — the six SOPs whose Procedure has zero newlines
  // depend on the Range pass cutting it later.
  const lines = value ? value.split(/\r?\n/) : [""];
  // The em-dash empty state belongs to a section with NO content at all
  // (EmptyAwareText semantics). An interior blank line is the author's paragraph
  // spacing: the old pre-wrap rendering showed it as one empty text line, so it
  // renders as a non-breaking space — same height, no dash.
  const sectionIsEmpty = !value;
  return lines.map((line, index) => ({
    id: `${category}-p${index}`,
    category,
    sectionTitle,
    splittable: true,
    render: (lineRange) => {
      const paragraph = (
        <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category={category}>
          <p className={sectionIsEmpty ? "sop-export-empty" : undefined}>
            {line || (sectionIsEmpty ? "—" : " ")}
          </p>
        </section>
      );
      if (!lineRange) return paragraph;
      const { startLine, endLine, lineHeight } = lineRange;
      return (
        <div
          data-review-category={category}
          data-line-range={`${startLine}-${endLine}`}
          style={{ height: (endLine - startLine) * lineHeight, overflow: "hidden" }}
        >
          <div style={{ marginTop: -startLine * lineHeight }}>{paragraph}</div>
        </div>
      );
    },
  }));
}

/**
 * Procedure-only line classification (spec 2026-08-04): numbered sub-headings
 * become atomic keepWithNext blocks — the paginator's orphan rules then protect
 * them exactly as they protect section headings — and bullet-glyph lines become
 * list items. Every other section keeps plain proseBlocks: purpose/scope are
 * authored prose where "4.4 …" shapes do not occur, and holding the blast
 * radius to the section with the problem keeps this reviewable.
 */
function procedureBlocks(category: string, sectionTitle: string, value: string): PrintBlock[] {
  const plain = proseBlocks(category, sectionTitle, value);
  if (!value) return plain;
  const lines = value.split(/\r?\n/);
  return lines.map((line, index) => {
    const classified = classifyProcedureLine(line);
    if (classified.kind === "paragraph") return plain[index];
    if (classified.kind === "heading") {
      return {
        id: `${category}-p${index}`,
        category,
        sectionTitle,
        keepWithNext: true,
        render: () => (
          <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category={category}>
            <p className="sop-export-subheading">{classified.text}</p>
          </section>
        ),
      };
    }
    return {
      id: `${category}-p${index}`,
      category,
      sectionTitle,
      render: () => (
        <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category={category}>
          <ul className="sop-export-list">
            <li>{classified.text}</li>
          </ul>
        </section>
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Section builders. Order and markup mirror sop-print-preview.tsx:715-786
// (page-1 sections) and :796-855 (annexes / history / approvals).
// ---------------------------------------------------------------------------

function buildDefinitionsSection(sop: Sop): PrintBlock[] {
  const heading = headingBlock("definitions-heading", "definitions", "Definitions");
  if (sop.definitions.length === 0) {
    return [heading, emptyBlock("definitions-empty", "definitions", "Definitions")];
  }
  const columns: TableColumn[] = [{ width: "30%" }, { width: "70%" }];
  return [
    heading,
    tableHeaderBlock("definitions-header", "definitions", "Definitions", columns, ["Term", "Definition"]),
    ...sop.definitions.map((row, index) =>
      tableRowBlock(`definitions-row-${index}`, "definitions", "Definitions", columns, [row.term, row.definition]),
    ),
  ];
}

/** One paragraph per non-empty entry, sharing LinesOrDash's em-dash empty state. */
function buildResponsibleSection(sop: Sop): PrintBlock[] {
  const heading = headingBlock("responsible-heading", "responsible", "Responsible Person(s)");
  const entries = sop.responsiblePersons.filter(Boolean);
  if (entries.length === 0) {
    return [heading, emptyBlock("responsible-empty", "responsible", "Responsible Person(s)")];
  }
  return [
    heading,
    ...entries.map(
      (entry, index): PrintBlock => ({
        id: `responsible-p${index}`,
        category: "responsible",
        sectionTitle: "Responsible Person(s)",
        render: () => (
          <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category="responsible">
            <p>{entry}</p>
          </section>
        ),
      }),
    ),
  ];
}

/** Linked SOPs, then reference documents, then plain reference strings — source order. */
function buildReferencesSection(sop: Sop, extras?: PrintBlockExtras): PrintBlock[] {
  const heading = headingBlock("references-heading", "references", "References");
  const linkedSops = sop.linkedSops;
  const referenceDocs = sop.referenceDocs ?? [];
  const references = sop.references;

  if (linkedSops.length === 0 && referenceDocs.length === 0 && references.length === 0) {
    return [heading, emptyBlock("references-empty", "references", "References")];
  }

  const items: ReactNode[] = [
    ...linkedSops.map((link) => (extras?.renderLinkedSop ? extras.renderLinkedSop(link) : linkedSopLabel(link))),
    ...referenceDocs.map((doc) => (extras?.renderReferenceDoc ? extras.renderReferenceDoc(doc) : doc.name)),
    ...references,
  ];

  return [
    heading,
    ...items.map((content, index) => listItemBlock(`references-item-${index}`, "references", "References", content)),
  ];
}

function buildMeasurementsSection(sop: Sop): PrintBlock[] {
  const heading = headingBlock("measurements-heading", "measurements", "Measurement");
  if (sop.measurements.length === 0) {
    return [heading, emptyBlock("measurements-empty", "measurements", "Measurement")];
  }
  return [
    heading,
    ...sop.measurements.map((item, index) =>
      listItemBlock(`measurements-item-${index}`, "measurements", "Measurement", item),
    ),
  ];
}

function buildAnnexesSection(sop: Sop, extras?: PrintBlockExtras): PrintBlock[] {
  const heading = headingBlock("annexes-heading", "annexes", "Annexes & Forms");

  const content: PrintBlock[] =
    sop.annexes.length === 0
      ? [emptyBlock("annexes-empty", "annexes", "Annexes & Forms")]
      : sop.annexes.map((annex, index): PrintBlock => {
          const fileLine = annex.id ? extras?.annexFileLines?.get(annex.id) : undefined;
          return {
            id: `annexes-item-${index}`,
            category: "annexes",
            sectionTitle: "Annexes & Forms",
            render: () => (
              <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category="annexes">
                <div>
                  <p className="sop-export-annex">
                    <strong>{annex.label}: </strong>
                    {annex.description}
                  </p>
                  {fileLine ? (
                    <p className={`sop-export-annex-file ${fileLine.error ? "sop-export-annex-file-error" : ""}`}>
                      Attached form: {fileLine.name}
                      {fileLine.error ? ` - ${fileLine.error}` : ""}
                    </p>
                  ) : null}
                </div>
              </section>
            ),
          };
        });

  const loading: PrintBlock[] = extras?.annexLoading
    ? [
        {
          id: "annexes-loading",
          category: "annexes",
          sectionTitle: "Annexes & Forms",
          render: () => (
            <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category="annexes">
              <p className="sop-export-annex-file">Rendering attached forms…</p>
            </section>
          ),
        },
      ]
    : [];

  return [heading, ...content, ...loading];
}

function buildHistorySection(sop: Sop, extras?: PrintBlockExtras): PrintBlock[] {
  const columns: TableColumn[] = [{ width: "14%" }, { width: "56%" }, { width: "30%" }];
  return [
    headingBlock("history-heading", "history", "Change History"),
    tableHeaderBlock("history-header", "history", "Change History", columns, ["Version", "Changes", "Author"]),
    ...sop.changeHistory.map((entry, index) => {
      const author = extras?.changeAuthor ? extras.changeAuthor(entry) : formatDateControlled(entry.createdByDate);
      return tableRowBlock(`history-row-${index}`, "history", "Change History", columns, [
        entry.version,
        entry.changes,
        author,
      ]);
    }),
  ];
}

/**
 * The whole approvals table as one atomic block: `ApprovalTable`'s
 * signature-reveal animation and `data-signature-id` anchors must stay in a
 * single element. Omitted (rather than falling back to placeholder markup)
 * when the caller has nothing to hand in yet.
 *
 * Deliberately carries NO `data-review-category` — this is the one sanctioned
 * exception to the "every block carries its category" rule. `"approvals"` is
 * not a `REVIEW_CATEGORIES` key (sop-review-workspace.tsx), and the review
 * panel's scroll-spy (`handleReviewScroll`) highlights the last anchor whose
 * top is above the scroll target: an anchor here would capture that scroll-spy
 * and blank the panel highlight over this region. Today's markup has no
 * anchor here either, so the highlight correctly lingers on "history" —
 * parity, not the general rule, governs this block. Do not add the attribute
 * back.
 */
function buildApprovalsBlock(extras?: PrintBlockExtras): PrintBlock[] {
  if (!extras?.approvalsTable) return [];
  const approvalsTable = extras.approvalsTable;
  return [
    {
      id: "approvals-table",
      category: "approvals",
      sectionTitle: "Change Approvals",
      render: () => (
        <section className="sop-export-section">
          <h2>Change Approvals</h2>
          {approvalsTable}
        </section>
      ),
    },
  ];
}

/**
 * Decomposes a Sop document into self-contained print blocks, split into two
 * segments because the flowchart sheets must stay where the controlled
 * document has them today — after the Procedure narrative, before Annexes. A
 * single flat list would silently reorder the document (flowcharts after
 * Change Approvals). Task 3 measures both segments in one offscreen pass but
 * packs them separately; Task 4 renders sections → flow pages → trailing.
 */
export function buildPrintBlocks(
  sop: Sop,
  extras?: PrintBlockExtras,
): { sections: PrintBlock[]; trailing: PrintBlock[] } {
  const sections: PrintBlock[] = [
    headingBlock("purpose-heading", "purpose", "Purpose"),
    ...proseBlocks("purpose", "Purpose", sop.purpose),
    headingBlock("scope-heading", "scope", "Scope"),
    ...proseBlocks("scope", "Scope", sop.scope),
    ...buildDefinitionsSection(sop),
    ...buildResponsibleSection(sop),
    ...buildReferencesSection(sop, extras),
    ...buildMeasurementsSection(sop),
    headingBlock("procedure-heading", "procedure", "Procedure"),
    ...procedureBlocks("procedure", "Procedure", sop.procedure.processFlowDescription),
  ];

  const trailing: PrintBlock[] = [
    ...buildAnnexesSection(sop, extras),
    ...buildHistorySection(sop, extras),
    ...buildApprovalsBlock(extras),
  ];

  return { sections, trailing };
}
