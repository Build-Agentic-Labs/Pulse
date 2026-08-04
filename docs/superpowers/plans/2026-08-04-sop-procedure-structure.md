# SOP Procedure Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Numbered sub-headings render bold and list items render as real bullets in the SOP Procedure section — in the preview, in the DOCX export, for every future conversion, and (via a human-gated assisted backfill) for the 8 existing draft SOPs.

**Architecture:** One pure classifier (`classifyProcedureLine`) detects heading / bullet / paragraph per line of clean text — headings by shape (`4.4 Title`), bullets by the natural `• `/`- ` glyph, no stored markup. The preview's `proseBlocks`, the DOCX export, and the backfill verifier all consume it. The extraction prompt learns to keep line breaks and emit `• ` list lines; the schema stays a bare string.

**Tech Stack:** TypeScript, React 19, Vitest (node project for `.ts`, jsdom for `.tsx`), docx (existing export helpers), `@anthropic-ai/sdk` ^0.100.1 + `pg` for the backfill script (`node --env-file=.env.local`, following `scripts/backfill-*.mjs` precedent).

**Spec:** `docs/superpowers/specs/2026-08-04-sop-procedure-structure-design.md`

## Global Constraints

- Domain logic in `src/domain/` is pure — no React, no DOM, no Supabase — with a test file beside it (CLAUDE.md).
- Classification applies to the **`procedure` category only**. Purpose/scope stay paragraph-only.
- Heading rule (exact): matches `^\d+(\.\d+)+\s+[A-Z]`, trimmed length ≤ 80, **no terminal period**. At least two numeric levels — `4.4` yes, `4` alone never.
- Bullet rule: leading `• ` or `- ` (both accepted; renderer treats them identically; glyph stripped from display text).
- The classifier is a total function: every input line gets a kind, no throws.
- Flat text (no headings/bullets) must produce **today's output byte-for-byte** in preview and export — the change is invisible until structure exists.
- New CSS goes in the component's scoped `<style>` block, never `app/globals.css`.
- Backfill: drafts only (`status = 'draft'` guard on every UPDATE), per-row writes, letters-and-digits-only projection of before/after must be identical, human reviews diffs before any DB write. No schema changes, no `gen:types`, no touching `enforce_sop_transition`/`sign_sop`.
- Branch `feat/sop-procedure-structure`. Run `git branch --show-current` before every commit. CI green before merge.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/sop/procedure-text.ts` | **Create.** The classifier. |
| `src/domain/sop/procedure-text.test.ts` | **Create.** Classifier table tests. Node env. |
| `src/components/sop/print-blocks.tsx` | **Modify.** Procedure lines route through the classifier into heading/bullet/paragraph blocks. |
| `src/components/sop/print-blocks.test.tsx` | **Modify.** New block-kind tests. |
| `src/components/sop/sop-print-preview.tsx` | **Modify.** One CSS rule: `.sop-export-subheading`. |
| `src/lib/sop/export-docx.ts` | **Modify.** Classified rendering of the procedure narrative. |
| `src/domain/sop/extraction.ts` | **Modify.** Two prompt additions (`SOP_SYSTEM_PROMPT` only — schema untouched). |
| `scripts/backfill-procedure-structure.mjs` | **Create.** Assisted backfill: generate → verify → diff files → (on `--apply`) guarded writes. |
| `src/domain/sop/procedure-text-restructure.ts` | **Create.** The mechanical verifier (pure, shared by script via compiled import — see Task 4). |
| `src/domain/sop/procedure-text-restructure.test.ts` | **Create.** Verifier tests. |

---

### Task 1: The classifier

**Files:**
- Create: `src/domain/sop/procedure-text.ts`
- Test: `src/domain/sop/procedure-text.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ProcedureLineKind = "heading" | "bullet" | "paragraph"`, `ClassifiedProcedureLine { kind: ProcedureLineKind; text: string }`, `classifyProcedureLine(line: string): ClassifiedProcedureLine`. Tasks 2, 3, and 4 import these exact names from `@/domain/sop/procedure-text`.

- [ ] **Step 1: Write the failing test**

Create `src/domain/sop/procedure-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyProcedureLine } from "./procedure-text";

describe("classifyProcedureLine", () => {
  // The real lines from SOP-QAS-### that motivated this feature.
  it("classifies numbered sub-headings by shape", () => {
    expect(classifyProcedureLine("4.4 Document Creation")).toEqual({
      kind: "heading",
      text: "4.4 Document Creation",
    });
    expect(classifyProcedureLine("4.11 Document Changes and Revisions")).toEqual({
      kind: "heading",
      text: "4.11 Document Changes and Revisions",
    });
    expect(classifyProcedureLine("4.1.2 Retention Schedule")).toEqual({
      kind: "heading",
      text: "4.1.2 Retention Schedule",
    });
  });

  it("classifies bullet-glyph lines and strips the glyph", () => {
    expect(classifyProcedureLine("• Use the approved corporate template.")).toEqual({
      kind: "bullet",
      text: "Use the approved corporate template.",
    });
  });

  it("accepts the hyphen an author types by hand", () => {
    expect(classifyProcedureLine("- Apply clear and unambiguous language.")).toEqual({
      kind: "bullet",
      text: "Apply clear and unambiguous language.",
    });
  });

  // Conservative by design: a missed heading renders as today; a false positive
  // would mis-bold a controlled document.
  it("keeps near-miss numbered lines as paragraphs", () => {
    // Lowercase after the number: a measurement, not a title.
    expect(classifyProcedureLine("4.5 mm tolerance applies.").kind).toBe("paragraph");
    // Terminal period: a numbered instruction sentence, not a title.
    expect(classifyProcedureLine("4.4 Insert the pin.").kind).toBe("paragraph");
    // One numeric level only: a quantity-leading sentence.
    expect(classifyProcedureLine("4 bolts secure the cover").kind).toBe("paragraph");
  });

  it("caps headings at 80 characters", () => {
    const long = `4.4 ${"Word ".repeat(20)}`.trim(); // > 80 chars
    expect(classifyProcedureLine(long).kind).toBe("paragraph");
    const exactly80 = `4.4 ${"A".repeat(76)}`; // 4 + 76 = 80
    expect(exactly80).toHaveLength(80);
    expect(classifyProcedureLine(exactly80).kind).toBe("heading");
  });

  it("treats surrounding whitespace as insignificant for detection", () => {
    expect(classifyProcedureLine("  4.4 Document Creation  ").kind).toBe("heading");
    expect(classifyProcedureLine("  • Indented bullet").kind).toBe("bullet");
  });

  it("classifies everything else as paragraph, including empty lines", () => {
    expect(classifyProcedureLine("The creator shall:")).toEqual({
      kind: "paragraph",
      text: "The creator shall:",
    });
    expect(classifyProcedureLine("")).toEqual({ kind: "paragraph", text: "" });
    expect(classifyProcedureLine("   ")).toEqual({ kind: "paragraph", text: "   " });
  });

  // A bare glyph with no content is authored noise, not a list item.
  it("keeps a lone glyph as a paragraph", () => {
    expect(classifyProcedureLine("•").kind).toBe("paragraph");
    expect(classifyProcedureLine("-").kind).toBe("paragraph");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/domain/sop/procedure-text.test.ts
```

Expected: FAIL — `Failed to resolve import "./procedure-text"`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/sop/procedure-text.ts`:

```ts
/**
 * Line classification for the SOP Procedure narrative.
 *
 * Converted documents store the Procedure as clean text — no markup. Structure
 * is DETECTED, not marked: numbered sub-headings ("4.4 Document Creation")
 * identify themselves by shape, and bullets are the one stored convention — a
 * leading "• " (or the "- " an author types by hand). This keeps the string
 * presentation-clean in every surface that renders it raw (editor textarea,
 * search, fallback preview) while the preview, the DOCX export, and the
 * backfill verifier all share this single definition of what a line is.
 *
 * The heading rule is deliberately conservative: a missed heading renders as
 * an ordinary paragraph (today's behaviour); a false positive would mis-bold a
 * controlled document. Hence: at least two numeric levels (so "4 bolts secure
 * the cover" can never match), an uppercase letter right after the number (so
 * "4.5 mm tolerance applies." stays prose), no terminal period (so
 * "4.4 Insert the pin." stays an instruction), and a length cap.
 */

export type ProcedureLineKind = "heading" | "bullet" | "paragraph";

export interface ClassifiedProcedureLine {
  kind: ProcedureLineKind;
  /** Display text: bullet glyph stripped for bullets, verbatim otherwise. */
  text: string;
}

const HEADING_PATTERN = /^\d+(\.\d+)+\s+[A-Z]/;
const HEADING_MAX_LENGTH = 80;
const BULLET_PATTERN = /^([•-])\s+(\S.*)$/;

export function classifyProcedureLine(line: string): ClassifiedProcedureLine {
  const trimmed = line.trim();

  const bullet = BULLET_PATTERN.exec(trimmed);
  if (bullet) {
    return { kind: "bullet", text: bullet[2] };
  }

  if (
    HEADING_PATTERN.test(trimmed) &&
    trimmed.length <= HEADING_MAX_LENGTH &&
    !trimmed.endsWith(".")
  ) {
    return { kind: "heading", text: trimmed };
  }

  return { kind: "paragraph", text: line };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/domain/sop/procedure-text.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/domain/sop/procedure-text.ts src/domain/sop/procedure-text.test.ts
git commit -m "feat: classify SOP procedure lines as heading, bullet, or paragraph"
```

---

### Task 2: Preview rendering

**Files:**
- Modify: `src/components/sop/print-blocks.tsx` (the `proseBlocks` call for `procedure` at `:419`, plus a new `procedureBlocks` helper beside `proseBlocks`)
- Modify: `src/components/sop/sop-print-preview.tsx` (one CSS rule in the scoped `<style>` block)
- Test: `src/components/sop/print-blocks.test.tsx`

**Interfaces:**
- Consumes: `classifyProcedureLine`, `ClassifiedProcedureLine` (Task 1); existing `PrintBlock`, `proseBlocks` internals.
- Produces: no new exports. `buildPrintBlocks` output for the `procedure` category now contains three block shapes; every other category is byte-identical to before.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/sop/print-blocks.test.tsx` (inside the existing describe):

```tsx
  it("renders procedure sub-headings as atomic bold keepWithNext blocks", () => {
    const { sections } = buildPrintBlocks(
      sopWith({
        procedure: {
          processFlowDescription: "4.4 Document Creation\nThe creator may be an employee.",
          roles: [],
          activities: [],
        },
      }),
    );
    const body = sections.filter((b) => b.category === "procedure" && !b.keepWithNext);
    const headings = sections.filter(
      (b) => b.category === "procedure" && b.keepWithNext && b.sectionTitle === "Procedure",
    );
    // The section heading block plus the detected sub-heading block.
    expect(headings.length).toBeGreaterThanOrEqual(1);
    const sub = headings.find((b) => {
      const { container } = render(<>{b.render()}</>);
      return container.querySelector("p.sop-export-subheading") !== null;
    });
    expect(sub).toBeDefined();
    expect(sub!.splittable).toBeFalsy();
    const { container } = render(<>{sub!.render()}</>);
    expect(container.querySelector("p.sop-export-subheading")?.textContent).toBe(
      "4.4 Document Creation",
    );
    expect(container.querySelector("[data-review-category='procedure']")).not.toBeNull();
    // The following prose line is still an ordinary splittable paragraph block.
    expect(body.some((b) => b.splittable)).toBe(true);
  });

  it("renders procedure bullet lines as list items with the glyph stripped", () => {
    const { sections } = buildPrintBlocks(
      sopWith({
        procedure: {
          processFlowDescription: "The creator shall:\n• Use the approved corporate template.",
          roles: [],
          activities: [],
        },
      }),
    );
    const body = sections.filter((b) => b.category === "procedure" && !b.keepWithNext);
    const bulletBlock = body.find((b) => {
      const { container } = render(<>{b.render()}</>);
      return container.querySelector("ul.sop-export-list li") !== null;
    });
    expect(bulletBlock).toBeDefined();
    expect(bulletBlock!.splittable).toBeFalsy();
    const { container } = render(<>{bulletBlock!.render()}</>);
    expect(container.querySelector("ul.sop-export-list li")?.textContent).toBe(
      "Use the approved corporate template.",
    );
  });

  it("leaves purpose and scope classification-free", () => {
    const { sections } = buildPrintBlocks(
      sopWith({ purpose: "4.4 Document Creation\n• Not a bullet here." }),
    );
    const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
    for (const block of body) {
      const { container } = render(<>{block.render()}</>);
      expect(container.querySelector("p.sop-export-subheading")).toBeNull();
      expect(container.querySelector("ul")).toBeNull();
      expect(block.splittable).toBe(true);
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/sop/print-blocks.test.tsx
```

Expected: the three new tests FAIL (no `sop-export-subheading`, no bullet `li`); the existing 14 still pass.

- [ ] **Step 3: Implement `procedureBlocks`**

In `src/components/sop/print-blocks.tsx`, add beside `proseBlocks` (import `classifyProcedureLine` from `@/domain/sop/procedure-text`):

```tsx
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
```

Then change the procedure entry in `buildPrintBlocks` (currently
`...proseBlocks("procedure", "Procedure", sop.procedure.processFlowDescription)`
at `:419`) to
`...procedureBlocks("procedure", "Procedure", sop.procedure.processFlowDescription)`.

Note the ids: `procedureBlocks` reuses `proseBlocks`'s exact `${category}-p${index}` scheme and its per-line indices, so ids stay unique and stable regardless of kind.

- [ ] **Step 4: Add the CSS rule**

In `src/components/sop/sop-print-preview.tsx`, in the scoped `<style>` block
directly after the `.sop-export-section p { … }` rule:

```css
        /* Detected procedure sub-headings ("4.4 Document Creation") — body
           size, bold, mirroring how the source Word documents styled them.
           Deliberately a styled p, not an h2/h3: the heading machinery
           (section h2 styles, review anchors, "(cont.)" titles) is
           section-level and these must not enter it. */
        .sop-export-subheading { margin: 0 0 4px; font-weight: 700; }
```

- [ ] **Step 5: Run tests, typecheck, lint**

```bash
npx vitest run src/components/sop/print-blocks.test.tsx
npm run typecheck && npm run lint
```

Expected: 17 tests pass (14 existing + 3 new); both commands clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/sop/print-blocks.tsx src/components/sop/print-blocks.test.tsx src/components/sop/sop-print-preview.tsx
git commit -m "feat: render detected procedure sub-headings and bullets in the preview"
```

---

### Task 3: DOCX export

**Files:**
- Modify: `src/lib/sop/export-docx.ts` (the `bodyText(sop.procedure.processFlowDescription)` call at `:393-395` and a new helper beside `bodyText`)

**Interfaces:**
- Consumes: `classifyProcedureLine` (Task 1); existing `bodyText(text): Paragraph`, `bulletList(items: string[]): Paragraph[]`, `Paragraph`/`TextRun` from docx, constants `INK`, `FONT`.
- Produces: no new exports. The procedure narrative in the exported .docx gains bold sub-heading paragraphs and real Word bullet lists.

- [ ] **Step 1: Implement the classified renderer**

Add beside `bodyText` (import `classifyProcedureLine` from `@/domain/sop/procedure-text`):

```ts
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
```

Replace the call site:

```ts
  blocks.push(sectionHeading("Procedure"));
  if (sop.procedure.processFlowDescription) {
    blocks.push(...procedureNarrativeBlocks(sop.procedure.processFlowDescription));
  }
```

**Behavioural note (deliberate, spec-conforming):** today the whole narrative is
ONE `bodyText` paragraph whose string contains newlines; after this change each
line is its own paragraph. Visually Word rendered the single-paragraph newlines
as breaks already, so the flat-text output is equivalent line-for-line — assert
equivalence by eye in Task 5's export check, not byte equality of the .docx zip.

- [ ] **Step 2: Typecheck, lint, full suite**

```bash
npm run typecheck && npm run lint && npx vitest run
```

Expected: everything green, zero failures.

- [ ] **Step 3: Commit**

```bash
git add src/lib/sop/export-docx.ts
git commit -m "feat: export detected procedure structure as Word bold headings and bullets"
```

---

### Task 4: Extraction prompt + restructure verifier

**Files:**
- Modify: `src/domain/sop/extraction.ts` (`SOP_SYSTEM_PROMPT` rules only — the tool schema is untouched)
- Create: `src/domain/sop/procedure-text-restructure.ts`
- Test: `src/domain/sop/procedure-text-restructure.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (the verifier is pure string work).
- Produces: `restructurePreservesWording(before: string, after: string): boolean` and `RESTRUCTURE_INSTRUCTION` (exported prompt constant). Task 5's script imports both via `npx tsx`.

- [ ] **Step 1: Write the failing verifier test**

Create `src/domain/sop/procedure-text-restructure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { restructurePreservesWording } from "./procedure-text-restructure";

describe("restructurePreservesWording", () => {
  it("accepts pure whitespace restructuring", () => {
    const before = "Step one happens. Step two follows.";
    const after = "Step one happens.\n\nStep two follows.";
    expect(restructurePreservesWording(before, after)).toBe(true);
  });

  it("accepts added bullet glyphs", () => {
    const before = "The creator shall: Use the template. Apply clear language.";
    const after = "The creator shall:\n• Use the template.\n• Apply clear language.";
    expect(restructurePreservesWording(before, after)).toBe(true);
  });

  it("rejects any wording change", () => {
    const before = "Use the approved corporate template.";
    const after = "Use the approved company template.";
    expect(restructurePreservesWording(before, after)).toBe(false);
  });

  it("rejects dropped content", () => {
    const before = "First sentence. Second sentence.";
    const after = "First sentence.";
    expect(restructurePreservesWording(before, after)).toBe(false);
  });

  it("rejects reordered content", () => {
    const before = "Alpha then beta.";
    const after = "Beta then alpha.";
    expect(restructurePreservesWording(before, after)).toBe(false);
  });

  // Restructuring may normalize punctuation spacing but never letters/digits.
  it("ignores punctuation and case only where whitespace collapse implies it", () => {
    const before = "items, including:  Policies;  Quality manuals";
    const after = "items, including:\n• Policies\n• Quality manuals";
    // Semicolons dropped when converting a run-on list to bullets is a wording
    // change by the letters-only projection? No — ";" is punctuation, not a
    // letter/digit, so the projection is identical. This is intentional:
    // separators ARE the thing being restructured.
    expect(restructurePreservesWording(before, after)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/domain/sop/procedure-text-restructure.test.ts
```

Expected: FAIL — unresolved import.

- [ ] **Step 3: Implement the verifier + instruction constant**

Create `src/domain/sop/procedure-text-restructure.ts`:

```ts
/**
 * Mechanical safety net for the assisted procedure-text backfill
 * (spec 2026-08-04). The model is instructed to restructure ONLY — restore
 * paragraph breaks, put list items on "• " lines — never to reword. This
 * verifier enforces that contract the same way assertSaneStateDeletion guards
 * the planner save path: a drifted restructure fails loudly and is excluded.
 *
 * The projection keeps letters and digits only (Unicode-aware), so whitespace,
 * bullet glyphs, and punctuation separators — the things restructuring
 * legitimately moves or replaces — are invisible to it, while any reworded,
 * dropped, or reordered CONTENT changes the projection and fails.
 */

/** Letters-and-digits-only projection, lowercased. */
function contentProjection(text: string): string {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).join("").toLowerCase();
}

export function restructurePreservesWording(before: string, after: string): boolean {
  return contentProjection(before) === contentProjection(after);
}

/** The restructure-only instruction the backfill sends alongside each SOP's text. */
export const RESTRUCTURE_INSTRUCTION = `You are restructuring the Procedure narrative of a controlled SOP document. The text lost its formatting during a document conversion: paragraph breaks may be collapsed, list items may be run together, numbered sub-headings may be buried mid-line.

Return the SAME text with ONLY its structure restored:
- Put each numbered sub-heading (like "4.4 Document Creation") on its own line, exactly as written.
- Put each list item on its own line starting with "• " (bullet + space). Convert run-together lists (comma- or semicolon-joined items, often Capitalized) into bullet lines.
- Separate paragraphs with one blank line.
- NEVER reword, summarize, reorder, add, or drop content. Every letter and digit of the original must appear, in order. Separator punctuation (the commas or semicolons that joined run-together list items) may be dropped when the items become bullet lines; all other punctuation stays.

Return ONLY the restructured text — no commentary, no code fences.`;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/domain/sop/procedure-text-restructure.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Amend the extraction prompt**

In `src/domain/sop/extraction.ts`, two edits to `SOP_SYSTEM_PROMPT`:

1. The line-breaks rule (currently:
   `- Line breaks in long fields (\`purpose\`, \`scope\`, \`detail\`) must be real line breaks…`)
   gains the missing field:

```
- Line breaks in long fields (\`purpose\`, \`scope\`, \`detail\`, \`procedure.processFlowDescription\`) must be real line breaks in the string value. Never write the two characters backslash-n to mean a new line — that reaches the printed document as literal \\n text rather than a paragraph break.
```

2. New rule appended after it:

```
- In \`procedure.processFlowDescription\`, preserve the source's internal structure as clean text: keep each numbered sub-heading (e.g. "4.4 Document Creation") on its own line exactly as written; render every list item from the source as its own line starting with "• " (bullet + space), regardless of the source's list glyphs; separate paragraphs with a blank line as the source does.
```

- [ ] **Step 6: Full gate and commit**

```bash
npm run typecheck && npm run lint && npx vitest run
git add src/domain/sop/extraction.ts src/domain/sop/procedure-text-restructure.ts src/domain/sop/procedure-text-restructure.test.ts
git commit -m "feat: teach SOP extraction to preserve procedure structure; add backfill verifier"
```

---

### Task 5: Backfill script (generate + verify + diffs; apply behind a flag)

**Files:**
- Create: `scripts/backfill-procedure-structure.mjs`

**Interfaces:**
- Consumes: `RESTRUCTURE_INSTRUCTION`, `restructurePreservesWording` — imported by spawning `npx tsx` is NOT used; instead the two are small enough that the script inlines byte-identical copies with a header comment naming the source module as canonical (scripts/ is plain .mjs without a TS loader; every existing backfill script is dependency-light the same way). A drift test in Task 4's test file is NOT added — instead this task adds a repo test that asserts the .mjs copies match the TS exports (Step 2), so drift fails CI.
- Produces: a runnable ops flow — `node --env-file=.env.local scripts/backfill-procedure-structure.mjs` (generate + verify + write diffs) and `… --apply` (guarded writes after human review).

- [ ] **Step 1: Write the script**

Create `scripts/backfill-procedure-structure.mjs`:

```js
// Assisted backfill: restore structure in already-converted SOP Procedure text
// (spec docs/superpowers/specs/2026-08-04-sop-procedure-structure-design.md).
//
// Phase 1 (default): for each DRAFT SOP whose procedure narrative is longer
// than 400 chars, ask Claude to restructure (RESTRUCTURE_INSTRUCTION), verify
// mechanically that only whitespace/glyphs changed, and write a reviewable
// before/after diff to scratch/procedure-backfill/<sop-number-or-id>.diff.txt.
// NOTHING is written to the database in this phase.
//
// Phase 2 (--apply): after a human has reviewed the diffs, re-run with --apply.
// Re-generates deterministically? No — it REUSES the reviewed outputs stored in
// scratch/procedure-backfill/<id>.after.txt (written in phase 1), re-verifies
// each against the CURRENT database text (a draft edited since phase 1 fails
// verification and is skipped), and applies per-row guarded updates:
//   update sops set document = jsonb_set(document, '{procedure,processFlowDescription}', $1)
//   where id = $2 and status = 'draft'
// Drafts only, one row at a time, no full-state save path.
//
// Usage:
//   node --env-file=.env.local scripts/backfill-procedure-structure.mjs
//   node --env-file=.env.local scripts/backfill-procedure-structure.mjs --apply
//
// Requires ANTHROPIC_API_KEY (phase 1) and the Postgres connection string
// (both phases) in .env.local. IMPLEMENTER: read an existing backfill script
// (e.g. scripts/backfill-flexboost-nomenclature.mjs) and use the SAME
// connection env var name it reads — do not invent a new one. The
// requireEnv("SUPABASE_DB_URL") calls below are placeholders for that name.

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";

const OUT_DIR = path.join(process.cwd(), "scratch", "procedure-backfill");
const MIN_LENGTH = 400;
const MODEL = process.env.SOP_EXTRACTION_MODEL || "claude-opus-5";

// --- Canonical copies -------------------------------------------------------
// These two are byte-identical to src/domain/sop/procedure-text-restructure.ts
// (the canonical source); a repo test asserts they stay in sync.

function contentProjection(text) {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).join("").toLowerCase();
}

function restructurePreservesWording(before, after) {
  return contentProjection(before) === contentProjection(after);
}

const RESTRUCTURE_INSTRUCTION = `You are restructuring the Procedure narrative of a controlled SOP document. The text lost its formatting during a document conversion: paragraph breaks may be collapsed, list items may be run together, numbered sub-headings may be buried mid-line.

Return the SAME text with ONLY its structure restored:
- Put each numbered sub-heading (like "4.4 Document Creation") on its own line, exactly as written.
- Put each list item on its own line starting with "• " (bullet + space). Convert run-together lists (comma- or semicolon-joined items, often Capitalized) into bullet lines.
- Separate paragraphs with one blank line.
- NEVER reword, summarize, reorder, add, or drop content. Every letter and digit of the original must appear, in order. Separator punctuation (the commas or semicolons that joined run-together list items) may be dropped when the items become bullet lines; all other punctuation stays.

Return ONLY the restructured text — no commentary, no code fences.`;
// ---------------------------------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Add it to .env.local.`);
    process.exit(1);
  }
  return value;
}

async function loadDrafts(client) {
  const { rows } = await client.query(
    `select id, document->'meta'->>'sopNumber' as sop_number,
            document->'meta'->>'title' as title,
            document->'procedure'->>'processFlowDescription' as text
       from sops
      where status = 'draft'
        and length(coalesce(document->'procedure'->>'processFlowDescription', '')) > $1
      order by sop_number nulls last, id`,
    [MIN_LENGTH],
  );
  return rows;
}

function fileStem(row) {
  return (row.sop_number || row.id).replaceAll(/[^\w.-]/g, "_");
}

async function generate() {
  const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const client = new pg.Client({ connectionString: requireEnv("SUPABASE_DB_URL") });
  await client.connect();
  try {
    const rows = await loadDrafts(client);
    console.log(`${rows.length} draft SOP(s) with a procedure narrative over ${MIN_LENGTH} chars.`);
    await mkdir(OUT_DIR, { recursive: true });
    let ok = 0;
    let failed = 0;
    for (const row of rows) {
      const label = `${row.sop_number || row.id} — ${row.title || "untitled"}`;
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: RESTRUCTURE_INSTRUCTION,
        messages: [{ role: "user", content: row.text }],
      });
      const after = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
      if (!restructurePreservesWording(row.text, after)) {
        failed += 1;
        console.error(`VERIFY FAILED (wording changed) — skipped: ${label}`);
        continue;
      }
      const stem = fileStem(row);
      await writeFile(path.join(OUT_DIR, `${stem}.id.txt`), row.id, "utf8");
      await writeFile(path.join(OUT_DIR, `${stem}.after.txt`), after, "utf8");
      await writeFile(
        path.join(OUT_DIR, `${stem}.diff.txt`),
        [`=== ${label}`, "", "--- BEFORE ---", row.text, "", "--- AFTER ---", after, ""].join("\n"),
        "utf8",
      );
      ok += 1;
      console.log(`verified + diff written: ${label}`);
    }
    console.log(`\nDone. ${ok} verified, ${failed} skipped. Review ${OUT_DIR}/*.diff.txt, then re-run with --apply.`);
  } finally {
    await client.end();
  }
}

async function apply() {
  const client = new pg.Client({ connectionString: requireEnv("SUPABASE_DB_URL") });
  await client.connect();
  try {
    const stems = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".after.txt"));
    if (stems.length === 0) {
      console.error(`No reviewed outputs found in ${OUT_DIR}. Run the generate phase first.`);
      process.exit(1);
    }
    let applied = 0;
    let skipped = 0;
    for (const file of stems) {
      const stem = file.replace(/\.after\.txt$/, "");
      const id = (await readFile(path.join(OUT_DIR, `${stem}.id.txt`), "utf8")).trim();
      const after = await readFile(path.join(OUT_DIR, file), "utf8");
      const { rows } = await client.query(
        `select status, document->'procedure'->>'processFlowDescription' as text from sops where id = $1`,
        [id],
      );
      const current = rows[0];
      if (!current || current.status !== "draft") {
        skipped += 1;
        console.error(`skipped ${stem}: not found or no longer a draft`);
        continue;
      }
      // A draft edited since generation fails re-verification and is skipped —
      // the reviewed diff no longer describes the row.
      if (!restructurePreservesWording(current.text ?? "", after)) {
        skipped += 1;
        console.error(`skipped ${stem}: database text changed since the diff was generated`);
        continue;
      }
      const result = await client.query(
        `update sops
            set document = jsonb_set(document, '{procedure,processFlowDescription}', to_jsonb($1::text))
          where id = $2 and status = 'draft'`,
        [after, id],
      );
      if (result.rowCount === 1) {
        applied += 1;
        console.log(`applied: ${stem}`);
      } else {
        skipped += 1;
        console.error(`skipped ${stem}: guarded update matched no row`);
      }
    }
    console.log(`\nDone. ${applied} applied, ${skipped} skipped.`);
  } finally {
    await client.end();
  }
}

if (process.argv.includes("--apply")) {
  await apply();
} else {
  await generate();
}
```

- [ ] **Step 2: Add the drift test**

Append to `src/domain/sop/procedure-text-restructure.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { RESTRUCTURE_INSTRUCTION } from "./procedure-text-restructure";

describe("backfill script stays in sync with the canonical module", () => {
  const script = readFileSync(
    path.join(process.cwd(), "scripts", "backfill-procedure-structure.mjs"),
    "utf8",
  );

  it("carries the canonical RESTRUCTURE_INSTRUCTION verbatim", () => {
    // JSON.stringify-normalize both to compare content including the •
    // escape without being tripped by template-literal vs source formatting.
    expect(script).toContain("Return ONLY the restructured text");
    expect(script.includes(RESTRUCTURE_INSTRUCTION)).toBe(true);
  });

  it("carries the canonical projection regex", () => {
    expect(script).toContain(String.raw`text.match(/[\p{L}\p{N}]/gu)`);
  });
});
```

- [ ] **Step 3: Run the gate**

```bash
npm run typecheck && npm run lint && npx vitest run
```

Expected: all green (the two new drift tests included). `scripts/*.mjs` is outside the eslint globs (`app src`) — consistent with every existing backfill script.

- [ ] **Step 4: Ensure scratch/ is ignored**

```bash
grep -qx "scratch/" .gitignore || echo "scratch/" >> .gitignore
git diff --stat .gitignore
```

Expected: either no change (already ignored) or a one-line addition.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-procedure-structure.mjs src/domain/sop/procedure-text-restructure.test.ts .gitignore
git commit -m "feat: assisted procedure-structure backfill script, human-gated"
```

---

### Task 6: Live verification + backfill execution (controller-run)

**Files:** none — verification and ops.

**Interfaces:**
- Consumes: the running app, the backfill script, the user's diff review.
- Produces: verified feature; restructured drafts (only after user approval).

- [ ] **Step 1: Drive the preview** — dev server via preview tooling; open SOP-QAS-### (`91cb0e3a-…?preview=pdf`). Before backfill, the document is unchanged (its stored text has no bullets and its headings ARE detected — `4.4 …` lines should now render bold). Confirm: `4.x` lines bold; page breaks still footer-clean (pagination post-paint guard silent); console clean.
- [ ] **Step 2: Regression sweep** — short SOP (Concession Management `8c8295f9-…`) and forms SOP (`d777f101-…`): unchanged page counts, no drift flags, no console errors.
- [ ] **Step 3: Run backfill phase 1** — `node --env-file=.env.local scripts/backfill-procedure-structure.mjs`; expect ~8 drafts processed, diffs in `scratch/procedure-backfill/`.
- [ ] **Step 4: HUMAN GATE** — surface the diffs to the user (SendUserFile the diff files or summarize per SOP). **Do not run `--apply` until the user approves.**
- [ ] **Step 5: Apply after approval** — `… --apply`; then re-open SOP-QAS-###: paragraphs separated, `shall:` items bulleted, sub-headings bold; page count changes are expected (more structure = more blocks); footer-clean everywhere.
- [ ] **Step 6: Export check** — download the DOCX for SOP-QAS-### via the app's export; open/inspect: bold sub-headings, real Word bullets, no stray `•` glyphs inside bullet items.
- [ ] **Step 7: Full gate + push** — `npm run typecheck && npm run lint && npx vitest run && npm run build`; push `-u origin feat/sop-procedure-structure`.

---

## Follow-up, not in this plan

Conversion-quality watch: the extraction prompt changes take effect on the next real document conversion; there is no automated test of model behaviour. The first post-ship conversion should be eyeballed against its source (structure arrives as `• ` lines and real newlines).
