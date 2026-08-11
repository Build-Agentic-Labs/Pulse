# Design QA — SOP End Terminal

## Comparison Target

- Source visual truth: `/Users/rosendolopez/.codex/generated_images/019fdd56-a055-7a81-9915-cd40e93c51ec/exec-54a5c75f-4134-45de-8250-7e5d0d0d84d0.png`
- Browser-rendered implementation: `/Users/rosendolopez/.codex/visualizations/2026/08/07/019fdd56-a055-7a81-9915-cd40e93c51ec/sop-end-terminal-qa/sop-end-terminal-viewport-final.png`
- Full-view comparison: `/Users/rosendolopez/.codex/visualizations/2026/08/07/019fdd56-a055-7a81-9915-cd40e93c51ec/sop-end-terminal-qa/sop-end-terminal-full-comparison-final.png`
- Focused comparison: `/Users/rosendolopez/.codex/visualizations/2026/08/07/019fdd56-a055-7a81-9915-cd40e93c51ec/sop-end-terminal-qa/sop-end-terminal-comparison-final.png`
- State: Jli draft SOP PDF preview, document page 3, first decision with `No` ending the process.

## Viewport And Normalization

- Source pixels: 1286 x 1223.
- Implementation pixels and CSS viewport: 865 x 998 at device scale factor 1.
- The source is an illustrative generated composition rather than the live PDF viewport, so the full views were fit into equal 640 x 640 comparison panels without stretching.
- The decision regions were independently cropped and fit into equal 520 x 400 panels for readable branch-level comparison.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- Fonts and typography: the implementation preserves the existing controlled-document Inter/Arial stack, weights, and hierarchy. `No` and `End` use the established branch-label style.
- Spacing and layout rhythm: the terminal exits from the diamond's right point, remains inside the Process step lane, and leaves a measured 10.56 px gap before the Output frame. The Yes connector remains centered and unobstructed.
- Colors and visual tokens: the branch uses the renderer's existing black, muted gray, connector gray, and border tokens with no new color or elevation treatment.
- Image quality and asset fidelity: the live vector branch remains crisp at the PDF preview scale and matches the selected hollow-circle terminal treatment.
- Copy and content: the branch reads `No` above the connector and `End` beneath the terminal circle, with no badge or arrow-text compound.

## Comparison History

1. Initial focused comparison confirmed the selected geometry, but the browser console exposed a P1 server-rendering fallback because canvas text measurement touched `document` during SSR.
2. Flow-page generation was deferred until after hydration, preserving the same rendered design while removing the server error.
3. Post-fix evidence: the terminal is visible after a clean reload, the final browser capture matches the selected treatment, and no new console errors were recorded.

## Primary Checks

- Opened the authenticated SOP PDF preview.
- Scrolled to document page 3 and verified the selected decision branch.
- Confirmed the terminal, `No`, and `End` elements render.
- Confirmed the terminal does not overlap the Output frame.
- Reloaded after the hydration fix and checked browser errors: none.

## Follow-up Polish

- None required for this selected treatment.

final result: passed

---

# Invitation access implementation QA

## Visual source

- Approved access-model board: `/Users/rosendolopez/.codex/visualizations/2026/08/11/pulse-invite-audit/figjam-board.png`
- Board flow implemented: Person → Organization role → Access package → Resources & scope → Review & send.

## Implementation captures

- Final review state at the reference desktop viewport: `.qa/invite-review-final.png`
- Responsive resources-and-scope state: `.qa/invite-resources-responsive.png`

## Visual comparison

- Compared the approved board and the final review capture together at the same desktop viewport.
- The implementation preserves the existing Pulse settings shell, typography, neutral palette, border treatment, spacing, and compact controls.
- The five approved stages are visible in the same order and clearly distinguish completed, current, and future steps.
- The final state uses the requested plain-language access summary and keeps the primary send action visually distinct.
- The resources state remains readable without horizontal page overflow; long resource lists stay in normal document flow.

## Interaction verification

- Opened the composer from Organization settings.
- Confirmed invalid work email validation blocks progress.
- Selected Member organization access.
- Applied the Industrial Engineer package.
- Confirmed the preset grants Quality Edit, Planning, Process Engineering Create, and the Industrial Engineer job title.
- Confirmed Admin review states show one unambiguous `Modules and projects: Full access` summary instead of contradictory per-module rows.
- Reached Review & send and confirmed the send button is enabled.
- Did not submit the QA invitation, so no email or pending member was created.
- Confirmed zero new browser console errors during the final end-to-end pass.

## Automated verification

- TypeScript typecheck passed.
- ESLint passed with zero warnings.
- Production build passed.
- Full Vitest suite passed: 102 files, 905 tests.
- Migration applied transactionally with 56 table row counts unchanged; six policies, three functions, and two smoke calls verified.
- Quality grants were re-keyed from global user access to `(workspace_id, user_id)` with four rows preserved, zero unscoped rows, and no synthetic audit events.

final result: passed
