# Shared controls — phase 1

[Before/after comparison](comparison.html). Work remains local and uncommitted.

## Shared owners

- src/components/ui/button.tsx: Button and IconButton, semantic primary/secondary/ghost/destructive variants, compact/standard/touch density, pending and disabled handling. Defaults to type=button; submit must be explicit. Icon labels are required. Static and reduced-motion modes suppress the press scale.
- src/components/ui/text-input.tsx: TextInput forwards native attributes, handlers and refs; Field owns label/help presentation and explicit association. Numeric/file controls are not converted to text inputs.
- src/components/ui/controls.css: one scoped styling source, using existing Pulse colors, radius and height tokens. 32/36/44px densities; 4px standard radius; consistent focus and state treatment. Caller className is for placement, not restyling.

## Adopted callers

- AWI directory: primary Add action; creation fields, cancel/create/close. Existing access checks, required/maxlength, pending cancellation guard and create callback retained.
- Account Settings: name/password fields and actions; deleted the superseded acct-field/acct-btn rules. Existing validation, dirty-state, save and credential operations unchanged.
- SOP AnnexesEditor: text/rename fields and icon actions; existing upload label uses the same visual class while remaining a native file input. Attachment-open content remains a dedicated content button. Rename/error/upload callbacks unchanged.
- SOP AddButton/RowDeleteButton: thin domain wrappers now use shared Button/IconButton. These wrappers also serve reference/overview rows, so their shared action styling follows the same owner; associated editor tests ran.

## Verification

- Full suite: 302 files / 2,491 tests passed, including existing AWI and annex save/error tests and three new control contract tests.
- Typecheck, lint and production build passed; whitespace diff check passed.
- Browser: AWI field measured 36px high and 4px radius; typing enables Create, Escape cancels and restores opener. No AWI submitted.
- Browser: attachment rename opens with focus; Escape cancels without changing the file.
- Browser: Settings name edit enables Save; restoring the original value disables it. No profile or password update submitted.
- Browser: Settings fields measured 36px high, 4px radius; at 390px the page content width remains 390px.
- Screenshots: four matched desktop pairs captured this implementation run; narrow before comes from the immediately preceding audit baseline, after from this implementation. Captures are unedited. A transient stylesheet compile error was corrected; its rejected screenshot was replaced.
- React review: presentational wrappers only, native props/ref forwarding, no fetches/effects or save-state ownership added. Existing form handlers retained.

## UI polish review

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| Medium | awi-directory.tsx | Rounded local fields, low-emphasis create | Shared 4px fields and primary action | Consistent shape and action hierarchy |
| Medium | account-settings.tsx/.css | Separate 30px buttons/32px fields | Shared 36px controls | Central ownership and consistent sizing |
| Medium | sop/editor/annexes-editor.tsx | Mixed icon sizes/targets | Shared icon treatment and 36px targets | Consistent alignment and hit areas |

Approve for the inspected pilot surfaces. Not verified: 10%-speed animation replay, dark-mode screenshots, real-device input, screen-reader audit, a fresh credential update, or every nonpilot caller. Existing automated save tests passed; browser checks here did not exercise a new save/reopen cycle.

This is the buttons/fields pilot, not completion of all visual-audit phases. Dialog chrome, badges, headers/empty states and broader Product/mobile adoption remain next. No hosted services were modified, and nothing was merged or pushed.
