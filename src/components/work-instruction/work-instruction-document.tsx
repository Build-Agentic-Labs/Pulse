"use client";

/**
 * Print-ready assembly work instruction: 11x17 landscape ledger sheets, one
 * setup sheet followed by 3x2 photo-first step sheets.
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
import { paginateWorkInstruction } from "@/domain/work-instruction/paginate";
import {
  CARDS_ON_FIRST_SHEET,
  CARDS_PER_SHEET,
  type WorkInstruction,
  type WorkInstructionCard,
  type WorkInstructionSheet,
} from "@/domain/work-instruction/schema";

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
.wi-hdr {
  flex: none; height: 0.90in; display: grid;
  grid-template-columns: 1.9in 1fr 2.1in 3.0in;
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
.wi-hdr-safety-label {
  font-size: 7pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8a5a00;
}
.wi-hdr-safety {
  font-size: 8pt; line-height: 1.25; color: #1a1a1a;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
}
.wi-hdr-safety-empty { color: #888; font-style: italic; }
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
.wi-card-overflowing { border: 2px solid #a52a2a; }
.wi-card-head { flex: none; display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.wi-card-seq {
  flex: none; width: 0.24in; height: 0.24in; border-radius: 50%;
  background: #1a1a1a; color: #fff;
  font-size: 9pt; font-weight: 700; line-height: 0.24in; text-align: center;
}
.wi-card-name { flex: 1; min-width: 0; font-size: 10pt; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wi-card-code { flex: none; font-family: var(--type-mono, monospace); font-size: 7pt; color: #666; }
.wi-card-main { flex: 1; min-height: 0; display: grid; grid-template-columns: 2.45in minmax(0, 1fr); gap: 0.1in; }
.wi-card-photo { border: 1px solid #ccc; background: #f7f7f7; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.wi-card-photo img { width: 100%; height: 100%; object-fit: contain; }
.wi-card-photo-empty { border: 1px dashed #bbb; background: repeating-linear-gradient(0deg, transparent, transparent 0.22in, #e4e4e4 0.22in, #e4e4e4 calc(0.22in + 1px)); }
.wi-card-caption { flex: none; font-size: 7pt; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

.wi-setup { height: 100%; display: grid; grid-template-columns: 1.15fr 1.15fr 1fr 1.6fr 1.5fr; gap: 0.12in; }
.wi-setup-col { display: flex; flex-direction: column; gap: 0.12in; min-height: 0; }
/* Blocks share their column's full height rather than stacking at the top:
   a printed form with boxes floating above dead space reads as unfinished,
   and the leftover is useful ruled space for handwritten notes. */
.wi-setup-col > .wi-block { flex: 1; }
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
  .wi-pages { display: block; gap: 0; }
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
      <div>
        <span className="wi-hdr-safety-label">Safety / PPE</span>
        {setup.safetyNotes ? (
          <span className="wi-hdr-safety">{setup.safetyNotes}</span>
        ) : (
          <span className="wi-hdr-safety wi-hdr-safety-empty">No hazards recorded for this task</span>
        )}
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
 * The setup band: everything that is not a step, sized to exactly one card row
 * so the bottom half of sheet 1 can carry real step cards instead of white
 * space. Five columns rather than three, because it has to be short.
 */
function SetupSheetBody({ instruction }: { instruction: WorkInstruction }) {
  const { setup, meta } = instruction;
  return (
    <div className="wi-setup">
      <div className="wi-setup-col">
        <Block title="Purpose / scope">
          <EmptyAware value={setup.purpose} fallback="No description recorded" />
        </Block>
        <Block title="Production data">
          <div className="wi-facts" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
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
        </Block>
      </div>

      <div className="wi-setup-col">
        <Block title="Safety / PPE">
          <EmptyAware value={setup.safetyNotes} fallback="No hazards recorded" />
        </Block>
      </div>

      <div className="wi-setup-col">
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
      </div>

      <div className="wi-setup-col">
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
        <Block title="Material kit">
          <EmptyAware value={setup.materialKit} fallback="No kit assigned" />
        </Block>
      </div>

      <div className="wi-setup-col">
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
        <Block title="Revision history">
          <table className="wi-table wi-table-ruled">
            <thead>
              <tr>
                <th style={{ width: "16%" }}>Rev</th>
                <th style={{ width: "28%" }}>Date</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {(meta.revisionHistory.length > 0
                ? meta.revisionHistory
                : [
                    { revision: "", date: "", description: "", author: "" },
                    { revision: "", date: "", description: "", author: "" },
                    { revision: "", date: "", description: "", author: "" },
                  ]
              ).map((entry, index) => (
                <tr key={`${entry.revision}-${index}`}>
                  <td>{entry.revision}</td>
                  <td>{formatDateControlled(entry.date)}</td>
                  <td>{entry.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      </div>
    </div>
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
          <div className="wi-card-photo">
            {/* eslint-disable-next-line @next/next/no-img-element -- self-contained print document; src is a data: or signed URL */}
            <img src={card.photo.url} alt={card.photo.caption || `Step ${card.sequence}`} />
          </div>
        ) : (
          <div className="wi-card-photo wi-card-photo-empty" />
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
      {card.photo?.caption && !continued ? <div className="wi-card-caption">{card.photo.caption}</div> : null}
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
        <div className="wi-card-photo wi-card-photo-empty" />
        <div className="wi-card-text">
          <div className="wi-card-instruction wi-card-photo-empty" style={{ border: 0 }} />
        </div>
      </div>
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

export function WorkInstructionDocument({ instruction }: { instruction: WorkInstruction }) {
  const sheets = paginateWorkInstruction(instruction);

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <div className="wi-pages">
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
                    <CardCells cards={sheet.cards} slots={CARDS_ON_FIRST_SHEET} />
                  </>
                ) : (
                  <CardCells cards={sheet.cards} slots={CARDS_PER_SHEET} />
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
