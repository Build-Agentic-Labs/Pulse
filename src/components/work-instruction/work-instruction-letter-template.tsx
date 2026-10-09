"use client";

import { LETTER_TEMPLATE_STYLES } from "./work-instruction-letter-styles";
import type { WorkInstruction } from "@/domain/work-instruction/schema";

/** Print-review prototype. Uses the WI contract, without changing released layouts or live data. */
export function WorkInstructionLetterTemplate({ example, blankOnly = false }: { example: WorkInstruction; blankOnly?: boolean }) {
  const blank = blankOnly;
  const pages = [[0], [1, 2], [3, 4]];
  return (
    <div className="wil-preview">
      <style>{LETTER_TEMPLATE_STYLES}</style>
      <div className="wil-toolbar">
        <div><strong>Letter portrait template</strong><span>Layout review · first page and continuation</span></div>
        <button type="button" className="ui-btn-primary" onClick={() => window.print()}>Print / Save PDF</button>
      </div>
      <div className="wil-pages">
        {pages.map((steps, pageIndex) => (
          <article className="wil-sheet" key={pageIndex} aria-label={blank ? "Blank work instruction template" : "Example work instruction template"}>
            <header className="wil-header">
              <div className="wil-logo">
                {/* eslint-disable-next-line @next/next/no-img-element -- print asset */}
                <img src="/sop/ana-logo.png" alt="ANA Inc." />
              </div>
              <div className="wil-title"><span className="wil-label">Work instruction</span><h1>{blank ? "" : example.meta.title}</h1>{blank && <span className="wil-fill" />}</div>
              <table className="wil-revision"><thead><tr><th>Rev</th><th>Date</th><th>Description</th></tr></thead><tbody><tr><td>{blank ? "" : "A"}</td><td>{blank ? "" : "09/29/2026"}</td><td>{blank ? "" : "Layout review"}</td></tr></tbody></table>
            </header>
            {pageIndex === 0 && <>
            <section className="wil-summary"><h2>Purpose / scope</h2><p>{blank ? "" : example.setup.purpose}</p></section>
            <section className="wil-summary wil-safety"><h2>Safety / PPE</h2><p>{blank ? "" : example.setup.safetyNotes}</p></section>
            <div className="wil-preparation">
              <section><h2>BOM / materials</h2><table className="wil-bom"><thead><tr><th>Part number</th><th>Description</th><th>Qty</th></tr></thead><tbody>{Array.from({length: 4}, (_, i) => { const part = blank ? undefined : example.setup.parts[i]; return <tr key={i}><td>{part?.partNumber}</td><td>{part?.description}</td><td>{part?.quantity}</td></tr>; })}</tbody></table></section>
              <section><h2>Tools &amp; equipment</h2><ul>{Array.from({length: 4}, (_, i) => <li key={i}>{blank ? "" : example.setup.tools[i]}</li>)}</ul></section>
            </div>
            </>}
            <main className="wil-steps" style={{ gridTemplateRows: `repeat(${steps.length}, minmax(0, 1fr))` }}>
              {steps.map((i) => { const card = blank ? undefined : example.cards[i]; return (
                <section className="wil-step" key={i}>
                  <div className="wil-image"><span>Image / reference view</span></div>
                  <div className="wil-step-body">
                    <div className="wil-step-heading"><span className="wil-number">{i + 1}</span><h2>{card?.name || "Instructions"}</h2></div>
                    <div className="wil-instructions">{card?.instruction}</div>
                    <div className="wil-tools"><h3>Tools</h3><p>{card?.tools.join(" · ")}</p></div>
                  </div>
                </section>
              ); })}
            </main>
            <footer className="wil-footer"><div><strong>{blank ? "Document no. __________________" : example.meta.documentNumber}</strong><span>{blank ? "Rev. ______" : "Rev. A"}</span><span>Page {pageIndex + 1} of {pages.length}</span></div><p>{blank ? "WORK INSTRUCTION · BLANK TEMPLATE" : "LAYOUT REVIEW ONLY · SAMPLE CONTENT · NOT FOR PRODUCTION"}</p></footer>
          </article>
        ))}
      </div>
    </div>
  );
}
