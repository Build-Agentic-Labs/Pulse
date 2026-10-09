# Pulse visual cohesion audit

October 9, 2026 · baseline d5a9676 · codex/ui-component-audit

## Verdict

Pulse already has a recognizable visual language: restrained color, Inter typography, consistent application shells, and shared button/field styles. The gap is enforcement and ownership. Callers still choose their own dimensions, radius, casing, spacing, badges and dialog chrome. A token change reaches some controls, while local utilities and scoped overrides keep others different.

Success means a visual family has one implementation, a small set of named variants, and known consumers. Changing its shared styling updates every migrated instance. It does not mean all dialogs have identical contents, all controls have one size, or every page uses the same layout.

This audit makes no application source changes. It follows the behavior audit; it does not repeat that work or claim a speed improvement.

## Evidence and scope

[Open the screenshot report](report.html). Thirteen current-run captures cover six feature areas and two viewport sizes (1280×720 and 390×844), using synthetic records in the local Docker environment. Screenshots were inspected before acceptance. No old audit images were reused.

Static TSX inventory: 232 production files under app/ and src/components/, excluding test/spec files; 573 native button occurrences, 180 inputs, 24 textareas, 59 ThemedSelect usages, nine native selects, 50 tables, 16 ModalSurface usages and five native-dialog elements. These are source occurrences, not unique designs, runtime instances, or defect counts. Dynamic class expressions and scoped CSS need manual review. [Inventory and caller lists](inventory.json).

Existing button vocabulary has four shared classes: primary (82 class occurrences), secondary (12), ghost (271), destructive (one literal occurrence, with dynamic callers not fully represented). Button callers contain ten distinct explicit height tokens, mostly h-9 and h-8. That signals opportunities to define sizes; it does not justify changing every occurrence.

## Screen review

| Step | Capture | Health and observation |
|---|---|---|
| 1 | SOP document | Clear layout; Draft is a rounded pill with a dot. Document fields intentionally have generous spacing. |
| 2 | SOP annexes | Clear row grouping; local AddButton/RowDeleteButton wrappers offer a useful starting point for shared actions. Measured delete target: 36×36px. |
| 3 | SOP list | Strong table hierarchy; Draft is a small rectangular badge, unlike the editor's same state. New SOP uses a filled primary action. |
| 4 | SOP confirmation | Existing shared confirmation works visually and behaviorally; preserve it as the owner rather than rebuilding deletion UI. Backdrop is much lighter than AWI creation. |
| 5 | Settings account | Clear sections; smaller fields and subdued disabled actions. Label/help layout differs from document forms. |
| 6 | Settings narrow | Fields stack without horizontal page overflow (390px content width). Section tabs scroll horizontally; final tab is clipped as expected for a scroller, but discoverability deserves testing. |
| 7 | AWI empty list | Legible empty state, but create action is ghost-style in the distant toolbar. Planning puts a filled action directly in its empty state. |
| 8 | AWI create form | Clear form; title field measures 36px high, 13px type and 12px corners. Shared radius-control is 4px. Form/dialog shape is locally chosen. |
| 9 | Planning empty list | Primary create action is available in both toolbar and empty state. Description mentions an internal Excel limitation rather than only the user's next step. |
| 10 | Product dashboard | Data hierarchy is readable; alert, metric labels and status text use feature-local compositions. Dense data display is a legitimate variant. |
| 11 | Product procedure | Dense tools, uppercase labels and small formatting actions. Needs explicit compact-editor variants rather than global enlargement. |
| 12 | Mobile process | Large expandable cards fit the touch workflow. Uppercase actions and separate mobile styling diverge from desktop. |
| 13 | Mobile step | Camera/upload, duration, delete and description use another family of controls. Preserve camera, numeric and recovery semantics while sharing visual foundations. |

## Findings and proposed ownership

### 1. High priority: action styling depends on each caller

Evidence: steps 2, 3, 7, 9, 11–13. New SOP and New work order are filled primary actions; Add AWI is ghost. Mobile uses uppercase tracked text and 6px corners while desktop shared buttons use sentence case and the 4px control token. The difference in mobile target size is useful; independently maintained color/type rules are not necessary.

Current owners: app/globals.css (.ui-btn-* near 1710); src/components/sop/editor/editor-controls.tsx; mobile-photo-portal.css (button classes near 620); raw buttons throughout feature files.

Proposed owner: src/components/ui/button.tsx and icon-button.tsx, with semantic variant (primary, secondary, ghost, destructive), density (compact, standard, touch), disabled and pending states. A link can receive the same visual contract while remaining a link. Start with SOP row actions, Settings actions and AWI creation; then migrate Planning and mobile. Avoid exposing unlimited class overrides as the normal API.

### 2. High priority: fields have several competing shape/label rules

Evidence: steps 1, 2, 5, 8, 11, 13. AWI's 12px input corners versus the 4px token is a measured example. SOP document fields, ordinary SOP annex fields, Settings rows and mobile fields each have additional presentation rules.

Current owners: app/globals.css .ui-input (underline), .ui-field-shell/control/standalone (outlined), .sop-editor overrides, .sop-document-field; SOP editor-fields.tsx; ClearableNumberInput; mobile-photo-portal.css.

Proposed owners: Field (label, help, error and association), TextInput/Textarea, with explicit outlined/document/inline presentation and density. Numeric input remains a specialized wrapper so empty and numeric values behave as they do today. Keep ThemedSelect as the selection owner; align its visual size and focus tokens rather than replacing its search/create behavior.

### 3. High priority: modal behavior is shared; modal appearance is not yet shared

Evidence: steps 4 and 8. Confirmation has a divided header, light background treatment and compact footer; AWI creation has its own rounded panel, darker backdrop and spacing. Different content is appropriate, but panel, backdrop, heading and footer treatment should be named variants of one family.

Current owners: ModalSurface owns layering/focus only; themed-feedback.tsx owns confirmation markup; awi-directory.tsx and other callers paint their own shells.

Proposed owner: DialogPanel/DialogHeader/DialogBody/DialogFooter above ModalSurface, with confirm/form/preview variants and width tokens. ConfirmProvider/useConfirm remains the entry point for relevant delete confirmations. Caller supplies item name, explanation and operation; it does not restyle the box. Do not route immediate reversible row editing through a new confirmation indiscriminately. Full-screen media/PDF and drawers keep appropriate layouts.

### 4. Medium priority: the same status has multiple visual representations

Evidence: steps 1 and 3 show Draft as a pill with dot versus a rectangular text badge; step 10 has further local status treatments.

Current owners: sop/editor/document-section.tsx near 132; sop/sop-list.tsx near 791; domain-specific status mappings elsewhere.

Proposed owner: StatusBadge for size, shape, dot and visual tone. Domain adapters keep mapping states to labels/tones; a generic UI component must not decide approval or release rules. Choose a standard default, with compact table and regular variants only if the comparison demonstrates a need.

### 5. Medium priority: headers, empty states and feedback are assembled independently

Evidence: steps 3, 7 and 9 use different title scale and primary-action emphasis; AWI and Planning empty states differ in border, icon, placement and action. Step 10's warning banner is another composition.

Proposed owners: PageHeader, SectionHeader, EmptyState and InlineNotice. Table, panel and full-page empty states may vary in density, but share typography, icon spacing and action rules. Simplify Planning's empty-state copy to the next useful action. Keep critical/recovery status persistent; do not turn it into an auto-disappearing toast for visual uniformity.

### 6. Medium priority: local CSS overrides make global updates unpredictable

Evidence: measured AWI field radius and source inventory of explicit height/radius tokens. app/globals.css has base tokens plus SOP-specific overrides; mobile-photo-portal.css maintains its own control rules.

Keep existing color, type, shell and panel tokens. Add named semantic control/overlay tokens only where needed. Move component-specific visual ownership to its shared component stylesheet. During migration remove replaced caller styling and record justified exceptions; do not keep both rules indefinitely.

## Full-system component map

| Family | Target ownership | Keep distinct |
|---|---|---|
| Buttons and icon actions | Button, IconButton, shared action styles for links | Touch targets, compact editor tools, toggles |
| Fields | Field, TextInput, Textarea, shared help/error styling | Numeric parsing, file upload, document editing |
| Selectors | ThemedSelect plus common size/focus tokens | Native select, multi-tool picker, checkbox/switch semantics |
| Dialogs/confirmations/drawers | ModalSurface + shared panel/header/footer; existing confirm provider | Preview canvases, drawers, anchored popovers |
| Status and metadata | StatusBadge, domain label/tone adapters | Progress indicators versus static status |
| Feedback | InlineNotice and existing themed toast/confirmation family | Persistent save/recovery versus transient success |
| Page/section headers | Shared heading/action spacing variants | Dense product editor versus full-page list |
| Cards/tables/lists | Shared surfaces, row/action spacing and empty state | Domain columns, virtualization, Gantt, editable matrices |
| Loading/empty/error | Shared visual tokens, contextual skeletons, EmptyState | Shell, content-only, inline action and recovery |
| Navigation | Shared item visual tokens and active/focus states | Routes, workflow steps, expandable product trees |
| Mobile capture/media | Shared controls with touch density, preserved specialty wrappers | Camera, crop/annotation canvas, drag handles, playback |

The nine raw selects and 50 tables are not automatic replacement candidates. Confirm equivalence before consolidation. Existing loading components reserve different shapes on purpose; retain them where they match content.

## Implementation order

1. **Reference sheet and tokens:** render existing/proposed variants together in a local component gallery. Decide action hierarchy, radii, sizes, label styles and badge shape using the existing Pulse language. No new brand direction needed.
2. **Buttons + fields:** build shared components, migrate SOP annexes, AWI creation and Settings first. Capture each before/after at the same size/state. Verify keyboard, disabled/pending/error, numeric clearing, field labels and save/reopen.
3. **Dialogs + status:** standardize panel/header/footer styling on the tested ModalSurface. Reuse the existing confirm owner. Replace the two SOP Draft renderings with a domain adapter and shared badge; verify actual workflow labels remain unchanged.
4. **Headers + empty/feedback surfaces:** migrate AWI, SOP and Planning lists; document standard placement and copy. Preserve table behavior and visibility-based loading.
5. **Product + mobile adoption:** apply compact/touch variants to the repeated controls while preserving specialized toolbars, annotations, timer, uploads and recovery. Use local browser persistence checks for affected workflows.
6. **Remove superseded styling and verify adoption:** inventory the remaining exceptions; ensure each is deliberate and has an owner. Do not declare completion after only creating unused shared files.

## Definition of success

- Every in-scope family has one documented owner, allowed variants and caller inventory.
- Every targeted caller uses that owner; remaining exceptions are listed with a reason.
- A temporary visual-token change in the local gallery appears in all migrated representative screens, then is reverted: proof that one change propagates.
- Same-family controls share shape, type, focus, disabled, pending and error treatment. Differences are named variants rather than arbitrary per-screen utilities.
- Each implementation item has matched before/after screenshots, including relevant narrow and state examples. This report contains baseline screenshots only; no visual changes have been made yet.
- Controls remain semantic, labels are associated, focus visible, and touch targets deliberate. Measure contrast and test keyboard/assistive technology before claiming accessibility compliance.
- Save, permission, navigation, upload/recovery and destructive-operation contracts remain unchanged; tests plus local browser checks cover affected flows.
- Type/lint/tests/build pass for implementation phases. Screenshots alone do not prove correctness or performance.

## Limits and environment

Visual sampling is representative, not every route/theme/role. Dark mode, real-device camera, screen readers, contrast ratios, live production data, populated Planning tables, and transient loading/error combinations were not fully exercised. Those belong in the state matrix during implementation. No unsupported accessibility failure is inferred from small or muted text alone; disabled text is not assessed as ordinary active-text contrast.

A local setup mismatch initially blocked the dashboard: Product module access migration 20261009144351 existed in code but not the refinement Docker database. A private local backup was taken and the existing migration applied transactionally to supabase_db_pulse-structure-refinement; the dashboard, AWI and Product views then loaded. The hosted database was not accessed. No test account/password, save, delete, upload, release or new document was submitted during the audit. The backup is outside the repository.
