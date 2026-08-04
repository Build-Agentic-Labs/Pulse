# SOP procedure structure: clean-text classification

**Date:** 2026-08-04
**Status:** Approved, not yet implemented
**Area:** `src/domain/sop/`, `src/components/sop/print-blocks.tsx`,
`src/lib/sop/export-docx.ts`, `app/api/sops/extract` prompt, assisted backfill

## Problem

Converted SOPs lose their internal structure. On SOP-QAS-### (Document &
Records Control), the Procedure section renders numbered sub-headings —
`4.4 Document Creation`, `4.5 Document Review` — as plain body text, and the
list items under lead-ins like "The creator shall:" as bare unbulleted lines.
The stored field literally contains `4.4 Document Creation` as an
undifferentiated line among lines.

Where it dies:

```
DOCX ──► mammoth.convertToHtml           structure PRESERVED — parse-document.ts
         (src/lib/sop/parse-document.ts)  chose HTML precisely because it keeps
                                          tables/lists that raw text flattens
     ──► Claude extraction
     ──► processFlowDescription: { type: "string" }   ◄── everything dies HERE
         (src/domain/sop/extraction.ts:131)
```

The conversion hands the model HTML with headings, bold, and lists intact; the
output schema is a bare string that cannot carry "this line is a heading." The
preview then renders honestly — it cannot bold what the data does not
distinguish.

Related, same wound: the extraction prompt's real-line-breaks rule
(`extraction.ts:77`) names `purpose`, `scope`, `detail` — **not**
`processFlowDescription`. That omission is why 6 of 24 SOPs have a Procedure
with zero newlines (measured 2026-08-03; the collapsed comma-joined run-ons).

Production facts that shape the design (measured 2026-08-04, project
`neaadefipcpxxcqszpud`):

- 24 SOPs: 22 draft, 2 in_review.
- All 8 SOPs with a Procedure over 400 chars are **drafts**.
- `final_approval_content_hash` is null on every row — nothing is hash-bound.
- The 2 in_review SOPs have short procedures, outside backfill scope.

## Decision history

The first design (option B as originally pitched) stored markdown-lite markers
(`#### heading`, `- bullet`) in the string. The user rejected visible markers:
*"i dont want raw markers i want clean text but i want it to be handled
automatically not add any user input fields."* This supersedes it: the stored
text stays presentation-clean everywhere it leaks (editor textarea, search,
fallback preview), structure is detected rather than marked, and no editor UI
is added.

## Design

### Storage: clean text, self-describing

`processFlowDescription` stays a plain string holding only what a person would
naturally type:

```
4.4 Document Creation
The document creator may be an employee or authorized external consultant.

The creator shall:
• Use the approved corporate template.
• Apply clear and unambiguous language.
```

- **Headings are detected, not marked.** `4.4 Document Creation` identifies
  itself by shape.
- **Bullets are the one stored convention: a leading `• `** — clean text in its
  own right (it is how a person types a bullet in an email), legible raw in
  every surface that does nothing special, and it survives copy-paste.
- No schema change, no migration, no `gen:types`.

### The classifier: one pure function, every consumer

`src/domain/sop/procedure-text.ts` (+ `procedure-text.test.ts` beside it, per
the domain convention):

```ts
export type ProcedureLineKind = "heading" | "bullet" | "paragraph";

export interface ClassifiedProcedureLine {
  kind: ProcedureLineKind;
  /** The display text: bullet glyph stripped for bullets, verbatim otherwise. */
  text: string;
}

export function classifyProcedureLine(line: string): ClassifiedProcedureLine;
```

Rules, deliberately conservative — a missed heading renders as today, a false
positive would mis-bold a controlled document:

- **heading**: matches `^\d+(\.\d+)+\s+[A-Z]`, length ≤ 80 after trim, and no
  terminal period. So `4.4 Document Creation` and
  `4.11 Document Changes and Revisions` are headings, while
  `4.5 mm tolerance applies.` (lowercase continuation) and
  `4.4 Insert the pin.` (terminal period) stay paragraphs. At least two
  numeric levels are required (`4.4`, not `4`) so quantity-leading sentences
  ("4 bolts secure the cover") can never match.
- **bullet**: leading `• ` or `- ` (accept the hyphen an author types by hand;
  the renderer treats both identically). `text` is the content after the glyph.
- **paragraph**: everything else, including empty lines (interior blanks keep
  their existing nbsp spacing behaviour in the preview).

### Preview (`print-blocks.tsx`)

`proseBlocks` classifies per line **for the `procedure` category only** — the
other prose sections (purpose, scope) keep today's paragraph-only treatment;
their content is authored prose where `4.4 …` shapes do not occur, and holding
the blast radius to the section with the problem keeps the change reviewable.

- heading line → an atomic block (`splittable: false`, `keepWithNext: true`)
  rendering `<p className="sop-export-subheading">` inside the standard
  self-contained section shell. **`keepWithNext` is the payoff of doing this in
  the block layer**: the paginator's existing orphan rules now protect `4.x`
  sub-headings from ending a page, exactly as they protect section headings.
- bullet line → an atomic block rendering the existing single-item
  `<ul className="sop-export-list"><li>` markup, identical to how Measurement
  items already render.
- paragraph line → unchanged splittable prose block.

One new CSS rule in the component-scoped style block (never `globals.css`):
`.sop-export-subheading { font-weight: 700; }` — same size as body text, bold,
mirroring how the source documents styled these.

The sub-heading element is a styled `<p>`, not an `<h3>`: the preview's
heading machinery (`.sop-export-section h2`, review-scroll anchors,
continuation "(cont.)" titles) is section-level, and these lines must not
enter it. `data-review-category="procedure"` stays on every block either way.

### DOCX export (`export-docx.ts`)

The single `bodyText(processFlowDescription)` call becomes a classified
rendering using helpers that already exist in the file:

- heading line → a bold body paragraph (reuse the pattern `sectionHeading`
  uses, at body size with bold formatting — not a Word Heading style, so the
  document's navigation pane and numbering conventions are untouched).
- consecutive bullet lines → one real Word `bulletList` run (glyph stripped;
  Word supplies its own).
- paragraph lines → `bodyText` as today, blank lines preserved.

The exported controlled document matches the preview.

### Conversion (extraction prompt)

Two additions to `SOP_SYSTEM_PROMPT` in `src/domain/sop/extraction.ts` — the
schema is untouched:

1. Add `procedure.processFlowDescription` to the real-line-breaks rule at
   `:77`. Its absence there is the collapsed-prose root cause; this closes it
   for all future conversions.
2. New rule: *In `processFlowDescription`, keep the source's numbered
   sub-headings (e.g. "4.4 Document Creation") on their own line exactly as
   written. Render every list item from the source as its own line starting
   with "• " (bullet + space), regardless of the source's list glyphs.
   Separate paragraphs with blank lines as the source does.*

No change to `parse-document.ts` — it already delivers structure-preserving
HTML; the prompt now stops discarding it.

### Editor

Untouched. The textarea shows clean text; authors who add `• ` lines or
`4.x Title` lines get structure automatically, and authors who ignore the
conventions get today's behaviour. No new input fields, controls, or hints.

## Backfill: full assisted pass, human-gated, drafts only

Restores structure in already-converted SOPs. Ops flow, not app UI.

1. **Generate.** A repo script (`scripts/` — run locally, service credentials
   never in the app) selects draft SOPs whose Procedure is non-trivial
   (length > 400), sends each text to Claude with a restructure-only
   instruction: restore paragraph breaks in collapsed run-ons, put list items
   on `• ` lines, keep sub-headings on their own lines, **verbatim wording
   otherwise — reorganize whitespace and glyphs, never words**.
2. **Verify mechanically.** For each SOP the script asserts the
   letters-and-digits-only projection of before and after is **identical**
   (whitespace and `• `/`- ` glyphs are the only permitted differences — same
   invariant style as `assertSaneStateDeletion`: a drifted restructure fails
   loudly and is excluded). It writes one reviewable before/after diff file
   per SOP to a local directory.
3. **Human gate.** Nothing is written to the database until the user has seen
   the diffs and approved.
4. **Apply.** Per-row guarded updates: `update … set document = jsonb_set(…)
   where id = $1 and status = 'draft'` — drafts only, one row at a time, no
   full-state save path, no touching `enforce_sop_transition`/`sign_sop`
   (status never changes). The 2 in_review SOPs are out of scope by the
   length filter and additionally excluded by the status guard.

Signature-safety: nothing is hash-bound today (measured above), and the
status guard makes that a standing invariant rather than a lucky fact.

## Error handling

- Classifier: total function — any input line gets a kind; no throws.
- Preview: a procedure with no headings/bullets classifies entirely as
  paragraphs and renders exactly as today (the change is invisible until
  structure exists).
- Export: same property — flat text produces today's output.
- Backfill: any SOP failing the mechanical verification is skipped and listed;
  partial application is safe because rows are independent.

## Testing

- `procedure-text.test.ts` — the classifier table: the real QAS lines
  (`4.4 Document Creation`, `The creator shall:`, `• Use the approved
  corporate template.`), the near-misses (`4.5 mm tolerance applies.`,
  `4.4 Insert the pin.`, `4 bolts secure the cover`), hyphen bullets, empty
  line, 80-char boundary.
- `print-blocks.test.tsx` — procedure lines produce heading (atomic,
  keepWithNext) / bullet (li markup) / paragraph blocks; purpose/scope remain
  paragraph-only; sub-heading carries `sop-export-subheading` and the review
  category.
- Export: unit-test the classified block builder (heading → bold paragraph,
  bullet run → one list, paragraphs preserved) at the builder level.
- Backfill script: unit-test the mechanical verifier (identical projection
  passes; a reworded restructure fails).
- Live (CLAUDE.md): re-open SOP-QAS-### after backfill — `4.x` lines bold,
  `shall:` items bulleted, page breaks still footer-clean (the pagination
  post-paint guard stays silent); export the DOCX and confirm Word shows bold
  sub-headings and real bullets.

## Out of scope

- Purpose/scope classification (no observed need).
- Nested bullet levels (single level; the source documents use one).
- Rich editor UI (explicitly rejected — clean text, automatic handling).
- Any change to `sops` schema, RLS, or the patched-in-place DB functions.
