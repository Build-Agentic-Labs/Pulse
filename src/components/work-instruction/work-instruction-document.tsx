"use client";

/**
 * Print-ready assembly work instruction: 11x17 landscape ledger sheets, one
 * setup sheet followed by photo-first step sheets. The card grid is a layout
 * variant (`WORK_INSTRUCTION_LAYOUTS`) — v1 is 3x2, v2 is 2x2 with a far larger
 * photo — driven by CSS custom properties rather than a forked renderer.
 *
 * `WorkInstructionDocument` is a pure render — no data fetching, no planner
 * state — so the print route can load its data however it likes and hand the
 * same markup to the browser's print pipeline. Same contract as
 * `src/components/planning/work-order-print.tsx`.
 *
 * The sheet is white paper in both app themes (precedent: work-order-print and
 * the exported HTML documents in `src/domain/report.ts`): colors are hardcoded
 * rather than read from CSS variables, and only the font stack is shared.
 *
 * See docs/superpowers/specs/2026-08-04-assembly-work-instruction-design.md
 */

import { formatMinutes } from "@/domain/calculations";
import { formatDateControlled } from "@/domain/formatting";
import {
  isPhotoBoxAnnotation,
  textCalloutLeaderPoint,
  type PhotoAnnotation,
  type PhotoTextAnnotation,
} from "@/domain/photo-annotations";
import { paginateWorkInstruction } from "@/domain/work-instruction/paginate";
import {
  DEFAULT_WORK_INSTRUCTION_LAYOUT,
  type WorkInstruction,
  type WorkInstructionCard,
  type WorkInstructionLayout,
  type WorkInstructionPhoto,
  type WorkInstructionSheet,
} from "@/domain/work-instruction/schema";
import { useId } from "react";

const CONFIDENTIAL_LINE =
  "ANA INC. CONFIDENTIAL: This copyrighted work and all information is the property of ANA INC. All rights reserved";

const PRINT_STYLES = `
.wi-pages { display: grid; gap: 24px; justify-content: center; }
.wi-sheet {
  box-sizing: border-box; width: 17in; height: 11in; overflow: hidden;
  display: flex; flex-direction: column; gap: 0.12in;
  padding: 0.45in 0.5in 0.35in;
  background: #fff; color: #1a1a1a;
  box-shadow: 0 8px 40px rgba(0,0,0,0.25);
  font-family: var(--type-sans, var(--font-ui-family));
  font-size: 10pt; line-height: 1.35;
}
/* Document control lives entirely in the header — identity, revision history
   and production data — which is what frees the sheet canvas for content the
   operator actually works from. */
.wi-hdr {
  flex: none; height: 1.05in; display: grid;
  grid-template-columns: 1.9in 1fr 1.9in 3.4in 2.0in;
  border: 1px solid #666;
}
.wi-hdr > div {
  display: flex; flex-direction: column; justify-content: center;
  gap: 2px; padding: 4px 9px; border-right: 1px solid #666; min-width: 0;
}
.wi-hdr > div:last-child { border-right: 0; }
.wi-hdr-logo { align-items: center; }
.wi-hdr-logo img { width: 150px; height: 42px; object-fit: contain; }
.wi-hdr-title { font-size: 13pt; font-weight: 700; line-height: 1.2; }
.wi-hdr-docno { font-family: var(--type-mono, monospace); font-size: 10pt; font-weight: 700; }
.wi-hdr-meta { font-size: 8pt; }
.wi-hdr-meta > div { display: flex; justify-content: space-between; gap: 8px; }
.wi-hdr-meta span:first-child { color: #555; }
.wi-hdr-label {
  flex: none; color: #555;
  font-size: 6.5pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
}
.wi-hdr-cell { justify-content: flex-start !important; padding-top: 5px !important; }
/* The revision table IS this header cell, not a table sitting inside one: the
   cell gives up its padding, the table fills it edge to edge, and its rules are
   the cell's own dividers. A bordered table inset in a bordered cell reads as a
   box in a box. */
.wi-hdr-rev-cell { padding: 0 !important; justify-content: stretch !important; gap: 0 !important; }
.wi-hdr-rev {
  width: 100%; height: 100%;
  border-collapse: collapse; table-layout: fixed; font-size: 7pt;
}
.wi-hdr-rev th, .wi-hdr-rev td {
  border-right: 1px solid #bbb; border-bottom: 1px solid #bbb;
  padding: 1px 6px; text-align: left; vertical-align: middle;
}
.wi-hdr-rev th:last-child, .wi-hdr-rev td:last-child { border-right: 0; }
.wi-hdr-rev tbody tr:last-child td { border-bottom: 0; }
/* Title row: the cell's label, so it spans and carries no column rule. */
.wi-hdr-rev-title {
  border-right: 0 !important; height: 0.17in;
  color: #555; font-size: 6.5pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
}
.wi-hdr-rev-cols th { height: 0.16in; background: #f0f0f0; font-weight: 700; }
.wi-body { flex: 1; min-height: 0; }
.wi-ftr {
  flex: none; height: 0.30in; display: flex; align-items: center; justify-content: space-between;
  gap: 12px; border-top: 1px solid #999; color: #666; font-size: 7.5pt;
}
.wi-ftr-confidential { flex: 1; text-align: center; }
.wi-ftr > span:first-child, .wi-ftr > span:last-child { white-space: nowrap; }

/* Sheet 1 and the step sheets share one grid geometry, so a card is the same
   size wherever it lands. On sheet 1 the setup band spans row 1. */
.wi-grid {
  height: 100%; display: grid;
  grid-template-columns: repeat(var(--wi-columns, 3), minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 0.12in;
}
.wi-setup-band { grid-column: 1 / -1; min-height: 0; }
.wi-card {
  box-sizing: border-box; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column; gap: 0.06in;
  padding: 0.1in; border: 1px solid #666;
}
.wi-card-blank { border-style: dashed; border-color: #aaa; }
/* An empty filled badge prints as a solid ink disc; on a fill-in slot it wants
   to be a circle to write the step number into. */
.wi-card-blank .wi-card-seq { background: none; border: 1px solid #aaa; }
.wi-card-overflowing { border: 2px solid #a52a2a; }
.wi-card-head { flex: none; display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.wi-card-seq {
  flex: none; width: 0.24in; height: 0.24in; border-radius: 50%;
  background: #1a1a1a; color: #fff;
  font-size: 9pt; font-weight: 700; line-height: 0.24in; text-align: center;
}
.wi-card-name { flex: 1; min-width: 0; font-size: 10pt; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wi-card-code { flex: none; font-family: var(--type-mono, monospace); font-size: 7pt; color: #666; }
.wi-card-main { flex: 1; min-height: 0; display: grid; grid-template-columns: var(--wi-photo-width, 2.45in) minmax(0, 1fr); gap: 0.1in; }
.wi-card-photo { border: 1px solid #ccc; background: #f7f7f7; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.wi-card-photo-populated { border: 0; background: transparent; }
.wi-card-photo img, .wi-card-photo-svg { width: 100%; height: 100%; object-fit: contain; }
.wi-card-photo-svg { display: block; }
.wi-card-photo-callout {
  box-sizing: border-box; width: 100%; height: 100%; overflow: hidden;
  border: 1px solid rgba(0,0,0,0.18); background: rgba(255,255,255,0.94);
  color: #1a1a1a; font-family: var(--type-sans, var(--font-ui-family)); font-weight: 600;
  line-height: 1.25; white-space: pre-wrap; overflow-wrap: anywhere;
}
/* A REAL step that simply has no photo. Reads as absence, not as somewhere to
   write — deliberately distinct from .wi-rule-lines, which the two shared until
   a populated card started printing a ruled writing box where its photo goes. */
.wi-card-photo-missing {
  border: 1px solid #e0e0e0; background: #fafafa;
  color: #b0b0b0; font-size: 7pt; letter-spacing: 0.08em; text-transform: uppercase;
}
/* The blank template's writing surface, and only that. */
.wi-rule-lines {
  border: 1px dashed #bbb;
  background: repeating-linear-gradient(0deg, transparent, transparent 0.22in, #e4e4e4 0.22in, #e4e4e4 calc(0.22in + 1px));
}
/* Always rendered, even with nothing to say: the row is reserved so the photo
   slot is the same height on every card. Let it collapse when a caption is
   absent and that card's .wi-card-main grows by the caption's height, making a
   photo-less slot visibly taller than its neighbours. */
.wi-card-caption {
  flex: none; height: 0.13in;
  font-size: 7pt; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wi-card-text { display: flex; flex-direction: column; gap: 0.05in; min-width: 0; overflow: hidden; }
.wi-card-instruction { flex: 1; min-height: 0; font-size: 9pt; line-height: 1.3; white-space: pre-wrap; overflow: hidden; }
.wi-card-overflow-note { flex: none; color: #a52a2a; font-size: 7pt; font-weight: 700; }
.wi-card-tools, .wi-card-checks { flex: none; font-size: 7.5pt; }
.wi-card-label { color: #666; font-size: 7pt; letter-spacing: 0.05em; text-transform: uppercase; }
.wi-check { display: inline-flex; align-items: center; gap: 3px; margin: 0 4px 2px 0; padding: 1px 4px; border: 1px solid #999; }
.wi-check-spec { font-family: var(--type-mono, monospace); font-weight: 700; }
.wi-card-duration { flex: none; color: #666; font-size: 7pt; white-space: nowrap; }
.wi-card-part { flex: none; color: #666; font-size: 7.5pt; font-style: italic; }
/* A continuation card has no photo, so its text runs the full card width —
   which is why continuations get their own, larger character budget. */
.wi-card-continued .wi-card-main { grid-template-columns: minmax(0, 1fr); }

/* One block per column, every container the same height — the band reads as a
   single rank of boxes rather than a ragged collage, and the leftover inside
   each is useful ruled space for handwritten notes. */
.wi-setup {
  height: 100%; display: grid;
  grid-template-columns: 1.15fr 1.3fr 1fr 1.75fr 1.2fr;
  gap: 0.12in; align-items: stretch;
}
.wi-block { display: flex; flex-direction: column; gap: 0.05in; border: 1px solid #666; padding: 0.09in; min-height: 0; overflow: hidden; }
.wi-block h3 { margin: 0; font-size: 8pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #333; }
.wi-block p { margin: 0; font-size: 9pt; line-height: 1.35; white-space: pre-wrap; overflow: hidden; }
.wi-block-empty { color: #888; font-style: italic; }
.wi-list { margin: 0; padding-left: 14px; list-style: disc; font-size: 9pt; }
.wi-list li { margin: 0 0 1px; }
.wi-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.5pt; }
.wi-table th, .wi-table td { border: 1px solid #bbb; padding: 2px 5px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.wi-table th { background: #f0f0f0; font-weight: 700; font-size: 7.5pt; }
.wi-table-ruled td { height: 0.22in; }
.wi-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.05in 0.1in; font-size: 8.5pt; }
.wi-facts > div { display: flex; justify-content: space-between; gap: 6px; border-bottom: 1px solid #ddd; }
.wi-facts span:first-child { color: #666; }
/* No signature or approval block by design: a work instruction is a repeated
   master, reprinted for every build, so it carries no sign-off surface. Where a
   signature is required it belongs on the referenced checklist action. */

@media print {
  body { visibility: hidden !important; margin: 0 !important; }
  .wi-print-root { position: absolute; inset: 0; display: block; background: #fff; z-index: 0; }
  .wi-print-root, .wi-pages, .wi-sheet, .wi-sheet * { visibility: visible !important; }
  .wi-print-chrome { display: none !important; }
  /* Any padding or margin around the sheets lands INSIDE the printed flow and
     spills past the last sheet's page break, emitting a blank trailing page.
     Zeroed here rather than at the call site so every host of this document —
     the print route, the design preview, an exported standalone file — prints
     the same sheet count. */
  .wi-pages { display: block; gap: 0; padding: 0 !important; margin: 0 !important; }
  .wi-preview-scale { width: auto !important; zoom: 1 !important; }
  .wi-print-body { padding: 0 !important; margin: 0 !important; }
  /* A modal is fixed and scrollable on screen. Both properties create a
     one-viewport print box in Chromium, which clips every sheet after page 1.
     Put only the modal host back in normal flow and let its body fully expand
     so the explicit sheet page breaks can paginate the entire instruction. */
  .wi-print-root.wi-print-modal {
    position: static !important; inset: auto !important;
    width: auto !important; height: auto !important;
    overflow: visible !important;
  }
  .wi-print-root.wi-print-modal .wi-print-body {
    width: auto !important; height: auto !important;
    overflow: visible !important;
  }
  .wi-sheet {
    width: 17in; height: 11in; margin: 0; box-shadow: none;
    break-after: page; page-break-after: always;
  }
  .wi-sheet:last-child { break-after: auto; page-break-after: auto; }
  @page { size: 17in 11in; margin: 0; }
}
`;

function HeaderBand({ instruction, sheet }: { instruction: WorkInstruction; sheet: WorkInstructionSheet }) {
  const { meta, context, setup } = instruction;
  const revisions =
    meta.revisionHistory.length > 0
      ? meta.revisionHistory
      : [
          { revision: "", date: "", description: "", author: "" },
          { revision: "", date: "", description: "", author: "" },
          { revision: "", date: "", description: "", author: "" },
        ];

  return (
    <header className="wi-hdr">
      <div className="wi-hdr-logo">
        {/* eslint-disable-next-line @next/next/no-img-element -- self-contained print document */}
        <img src="/sop/ana-logo.png" alt="ANA Inc." />
      </div>
      <div>
        <span className="wi-hdr-title">{meta.title || "Assembly work instruction"}</span>
        <span className="wi-hdr-docno">{meta.documentNumber || "WI number pending"}</span>
      </div>
      <div className="wi-hdr-meta">
        <div>
          <span>Revision</span>
          <span>{meta.revision || "—"}</span>
        </div>
        <div>
          <span>Effective</span>
          <span>{formatDateControlled(meta.effectiveDate) || "MM/DD/YYYY"}</span>
        </div>
        <div>
          <span>Product</span>
          <span>{context.productCode || context.productName || "—"}</span>
        </div>
        <div>
          <span>Sheet</span>
          <span>{`${sheet.page} of ${sheet.total}`}</span>
        </div>
      </div>
      <div className="wi-hdr-rev-cell">
        <table className="wi-hdr-rev">
          <thead>
            <tr>
              <th className="wi-hdr-rev-title" colSpan={3}>
                Revision history
              </th>
            </tr>
            <tr className="wi-hdr-rev-cols">
              <th style={{ width: "13%" }}>Rev</th>
              <th style={{ width: "26%" }}>Date</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {revisions.map((entry, index) => (
              <tr key={`${entry.revision}-${index}`}>
                <td>{entry.revision}</td>
                <td>{formatDateControlled(entry.date)}</td>
                <td>{entry.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="wi-hdr-cell">
        <span className="wi-hdr-label">Production data</span>
        <div className="wi-facts" style={{ gridTemplateColumns: "minmax(0, 1fr)", fontSize: "8pt" }}>
          <div>
            <span>Planned time</span>
            <span>{formatMinutes(setup.plannedDurationMinutes)}</span>
          </div>
          <div>
            <span>Operators</span>
            <span>{setup.plannedOperators}</span>
          </div>
          <div>
            <span>Quality gate</span>
            <span>{setup.qualityGate ? "Yes" : "No"}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

function FooterBand({ instruction, sheet }: { instruction: WorkInstruction; sheet: WorkInstructionSheet }) {
  const { context } = instruction;
  return (
    <footer className="wi-ftr">
      <span>{[context.manufacturingCode, context.zoneName, context.productName].filter(Boolean).join("  ·  ")}</span>
      <span className="wi-ftr-confidential">{CONFIDENTIAL_LINE}</span>
      <span>{`Page ${sheet.page} of ${sheet.total}`}</span>
    </footer>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="wi-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function EmptyAware({ value, fallback }: { value: string; fallback: string }) {
  return <p className={value ? undefined : "wi-block-empty"}>{value || fallback}</p>;
}

/**
 * The setup band: everything the operator works from that is not a step, sized
 * to exactly one card row so the bottom half of sheet 1 carries real step cards
 * instead of white space.
 *
 * One block per column, all the same height, so the band reads as a single rank
 * of containers. Document control (revision history, production data) lives in
 * the header instead — that is what keeps this to five blocks.
 */
function SetupSheetBody({ instruction }: { instruction: WorkInstruction }) {
  const { setup } = instruction;
  return (
    <div className="wi-setup">
      <Block title="Purpose / scope">
        <EmptyAware value={setup.purpose} fallback="No description recorded" />
      </Block>

      <Block title="Safety / PPE">
        <EmptyAware value={setup.safetyNotes} fallback="No hazards recorded" />
      </Block>

      <Block title="Tools & equipment">
        {setup.tools.length > 0 ? (
          <ul className="wi-list">
            {setup.tools.map((tool) => (
              <li key={tool}>{tool}</li>
            ))}
          </ul>
        ) : (
          <EmptyAware value="" fallback="No tools assigned" />
        )}
      </Block>

      <Block title="Parts & materials">
        {setup.parts.length > 0 ? (
          <table className="wi-table">
            <thead>
              <tr>
                <th style={{ width: "34%" }}>Part no.</th>
                <th>Description</th>
                <th style={{ width: "14%" }}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {setup.parts.map((part) => (
                <tr key={`${part.partNumber}-${part.description}`}>
                  <td>{part.partNumber}</td>
                  <td>{part.description}</td>
                  <td>{part.quantity ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyAware value="" fallback="No parts assigned" />
        )}
      </Block>

      <Block title="Reference documents">
        <div className="wi-facts" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
          <div>
            <span>Drawing</span>
            <span>{setup.drawingLink || "—"}</span>
          </div>
          <div>
            <span>Governing SOP</span>
            <span>{setup.sopLink || "—"}</span>
          </div>
        </div>
      </Block>
    </div>
  );
}

function photoRenderScale(width: number, height: number) {
  // Annotation sizes are authored against a roughly 700px viewer. Scale them
  // into intrinsic-photo coordinates so they retain that visual weight when
  // the complete SVG is reduced into a WI card or printed to PDF.
  return Math.max(1, Math.min(width, height) / 700);
}

function StaticPhotoAnnotation({
  annotation,
  width,
  height,
  markerId,
}: {
  annotation: PhotoAnnotation;
  width: number;
  height: number;
  markerId: string;
}) {
  const scale = photoRenderScale(width, height);

  if (annotation.type === "arrow") {
    return (
      <line
        data-annotation-type="arrow"
        x1={annotation.x1 * width}
        y1={annotation.y1 * height}
        x2={annotation.x2 * width}
        y2={annotation.y2 * height}
        stroke={annotation.color}
        strokeWidth={annotation.strokeWidth * scale}
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
      />
    );
  }

  if (isPhotoBoxAnnotation(annotation)) {
    const x = annotation.x * width;
    const y = annotation.y * height;
    const boxWidth = annotation.width * width;
    const boxHeight = annotation.height * height;
    const common = {
      "data-annotation-type": annotation.type,
      fill: annotation.type === "highlight" ? annotation.color : "none",
      fillOpacity: annotation.type === "highlight" ? annotation.opacity : undefined,
      stroke: annotation.color,
      strokeOpacity:
        annotation.type === "highlight" ? Math.min(annotation.opacity + 0.35, 0.75) : undefined,
      strokeWidth: annotation.strokeWidth * scale,
    };

    return annotation.type === "ellipse" ? (
      <ellipse
        {...common}
        cx={x + boxWidth / 2}
        cy={y + boxHeight / 2}
        rx={boxWidth / 2}
        ry={boxHeight / 2}
      />
    ) : (
      <rect {...common} x={x} y={y} width={boxWidth} height={boxHeight} />
    );
  }

  if (annotation.type === "freehand") {
    return (
      <polyline
        data-annotation-type="freehand"
        points={annotation.points.map((point) => `${point.x * width},${point.y * height}`).join(" ")}
        fill="none"
        stroke={annotation.color}
        strokeWidth={annotation.strokeWidth * scale}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  return <StaticTextCallout annotation={annotation} width={width} height={height} scale={scale} />;
}

function StaticTextCallout({
  annotation,
  width,
  height,
  scale,
}: {
  annotation: PhotoTextAnnotation;
  width: number;
  height: number;
  scale: number;
}) {
  const boxHeightNorm = annotation.height ?? Math.max(0.08, (annotation.fontSize * 3.4 * scale) / height);
  const leader = textCalloutLeaderPoint(
    annotation.anchorX,
    annotation.anchorY,
    annotation.x,
    annotation.y,
    annotation.width,
    boxHeightNorm,
  );
  const accentWidth = 3 * scale;

  return (
    <g data-annotation-type="text">
      <line
        x1={annotation.anchorX * width}
        y1={annotation.anchorY * height}
        x2={leader.x * width}
        y2={leader.y * height}
        stroke={annotation.color}
        strokeWidth={2 * scale}
        strokeLinecap="round"
      />
      <circle
        cx={annotation.anchorX * width}
        cy={annotation.anchorY * height}
        r={3 * scale}
        fill={annotation.color}
      />
      <foreignObject
        x={annotation.x * width}
        y={annotation.y * height}
        width={annotation.width * width}
        height={boxHeightNorm * height}
      >
        <div
          className="wi-card-photo-callout"
          style={{
            borderLeft: `${accentWidth}px solid ${annotation.color}`,
            fontSize: `${annotation.fontSize * scale}px`,
            padding: `${5 * scale}px ${7 * scale}px`,
          }}
        >
          {annotation.text}
        </div>
      </foreignObject>
    </g>
  );
}

function WorkInstructionPhotoMedia({
  photo,
  sequence,
}: {
  photo: WorkInstructionPhoto;
  sequence: number;
}) {
  const markerId = `wi-arrow-${useId().replace(/:/g, "")}`;
  const annotations = photo.annotations?.items ?? [];
  // Match the viewer's legacy fallback so annotations remain available for
  // older attachments that predate stored intrinsic dimensions.
  const width = photo.width ?? 1280;
  const height = photo.height ?? 960;
  const alt = photo.caption || `Step ${sequence}`;

  if (annotations.length === 0) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- self-contained print document; src is a data: or signed URL
      <img src={photo.url} alt={alt} />
    );
  }

  return (
    <svg
      className="wi-card-photo-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={alt}
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" />
        </marker>
      </defs>
      <image href={photo.url} width={width} height={height} preserveAspectRatio="none" />
      {annotations.map((annotation) => (
        <StaticPhotoAnnotation
          key={annotation.id}
          annotation={annotation}
          width={width}
          height={height}
          markerId={markerId}
        />
      ))}
    </svg>
  );
}

function StepCardCell({ card }: { card: WorkInstructionCard }) {
  const continued = card.part > 1;
  return (
    <article
      className={`wi-card${continued ? " wi-card-continued" : ""}${card.overflowing ? " wi-card-overflowing" : ""}`}
    >
      <div className="wi-card-head">
        <span className="wi-card-seq">{card.sequence}</span>
        <span className="wi-card-name">{card.name || `Step ${card.sequence}`}</span>
        {card.partCount > 1 ? (
          <span className="wi-card-part">{`(${card.part} of ${card.partCount})`}</span>
        ) : null}
        {card.durationMinutes ? <span className="wi-card-duration">{formatMinutes(card.durationMinutes)}</span> : null}
        {card.code ? <span className="wi-card-code">{card.code}</span> : null}
      </div>
      <div className="wi-card-main">
        {continued ? null : card.photo ? (
          <div className="wi-card-photo wi-card-photo-populated">
            <WorkInstructionPhotoMedia photo={card.photo} sequence={card.sequence} />
          </div>
        ) : (
          <div className="wi-card-photo wi-card-photo-missing">No photo</div>
        )}
        <div className="wi-card-text">
          <div className="wi-card-instruction">{card.instruction}</div>
          {card.overflowing ? (
            <div className="wi-card-overflow-note">Unbreakable text wider than the card — shorten this step</div>
          ) : null}
          {card.tools.length > 0 ? (
            <div className="wi-card-tools">
              <span className="wi-card-label">Tools </span>
              <span>{card.tools.join(", ")}</span>
            </div>
          ) : null}
          {card.checks.length > 0 ? (
            <div className="wi-card-checks">
              {card.checks.map((check) => (
                <span className="wi-check" key={check.key}>
                  <span>{check.label}</span>
                  {check.spec ? <span className="wi-check-spec">{check.spec}</span> : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="wi-card-caption">{!continued && card.photo?.caption ? card.photo.caption : ""}</div>
    </article>
  );
}

/**
 * An unfilled grid slot. Keeps the card's exact geometry and draws ruled boxes,
 * which is what lets one renderer serve both the generated and blank documents.
 */
function BlankCardCell() {
  return (
    <article className="wi-card wi-card-blank">
      <div className="wi-card-head">
        <span className="wi-card-seq" />
        <span className="wi-card-name" />
      </div>
      <div className="wi-card-main">
        <div className="wi-card-photo wi-rule-lines" />
        <div className="wi-card-text">
          <div className="wi-card-instruction wi-rule-lines" style={{ border: 0 }} />
        </div>
      </div>
      {/* Reserved for the same reason as on a real card: keeps every slot in the
          grid exactly the same height. */}
      <div className="wi-card-caption" />
    </article>
  );
}

/** Cards plus ruled blanks, always filling `slots` so the grid geometry holds. */
function CardCells({ cards, slots }: { cards: WorkInstructionCard[]; slots: number }) {
  const blanks = Math.max(0, slots - cards.length);
  return (
    <>
      {cards.map((card) => (
        <StepCardCell card={card} key={`${card.stepId}-${card.part}`} />
      ))}
      {Array.from({ length: blanks }, (_, index) => (
        <BlankCardCell key={`blank-${index}`} />
      ))}
    </>
  );
}

export function WorkInstructionDocument({
  instruction,
  layout = DEFAULT_WORK_INSTRUCTION_LAYOUT,
}: {
  instruction: WorkInstruction;
  layout?: WorkInstructionLayout;
}) {
  const sheets = paginateWorkInstruction(instruction, layout);
  // Grid shape travels as custom properties so one stylesheet serves every
  // variant — a forked renderer per layout would drift within a week.
  const vars = {
    "--wi-columns": String(layout.columns),
    "--wi-photo-width": layout.photoWidth,
  } as React.CSSProperties;

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <div className="wi-pages" style={vars} data-wi-layout={layout.id}>
        {sheets.map((sheet) => (
          <article className="wi-sheet" key={`${instruction.taskId}-${sheet.page}`}>
            <HeaderBand instruction={instruction} sheet={sheet} />
            <main className="wi-body">
              <div className="wi-grid">
                {sheet.kind === "setup" ? (
                  <>
                    <div className="wi-setup-band">
                      <SetupSheetBody instruction={instruction} />
                    </div>
                    <CardCells cards={sheet.cards} slots={layout.cardsOnFirstSheet} />
                  </>
                ) : (
                  <CardCells cards={sheet.cards} slots={layout.cardsPerSheet} />
                )}
              </div>
            </main>
            <FooterBand instruction={instruction} sheet={sheet} />
          </article>
        ))}
      </div>
    </>
  );
}
