# Quality WI builder — local acceptance

Branch: `codex/quality-work-instructions`, based on `9d6ef21`. First version, not released.

## What is ready

Department library; draft creation without a number; title, purpose and responsibilities;
ordered steps using existing instruction formatting, image preparation and annotation controls;
scoped autosave/recovery; preview and Word export; direct publishing without SOP review;
immutable revisions and a stable WI department number assigned on first publication.

The product planning workspace is not imported. UI responsibilities are split across small files:
largest UI file 281 lines; save controller 274 lines. The PDF preview adds pinned `pdf-lib` 1.17.1;
CI configuration is unchanged. Its image writer loads only on preview, using targeted ESM imports
to stay within the unchanged chunk budget.

## Observed checks

| Check | Result |
|---|---|
| Full application unit/component suite | 2,293 passed, 269 files |
| Local database assertions | 36 passed; test fixture transaction rolled back |
| Real-browser feature cases | 6 passed; includes real PDF parsing, download and continuous pages |
| Independent-session numbering / rollback probe | Passed on isolated database; fixtures retained |
| Lint, production build, subsequent typecheck | Passed |
| Existing route bundle budgets | Passed; largest chunk 138.0 KiB gzip (160 KiB limit) |
| Word visual inspection | Word: normal/annotated one page each, long 11 pages; PDF: normal/annotated one page each, long 7 pages; all inspected |

Browser cases exercise direct publish/revision preservation, offline reload/retry, private images,
annotation text and Word download, and long title/revision/instruction content. The long export
preserves beginning/end markers and repeats complete headers, using explicit continuation chunks.
This is correctness evidence, not a before/after speed claim. Microsoft Word itself has not been
visually tested; rendered QA uses LibreOffice through the document renderer.

Raw local logs and exported documents are in ignored `scratch/quality-wi-build/`.

## Local test environment

Open <http://127.0.0.1:3215/sops/work-instructions>. The prepared in-app browser is signed into
the synthetic “WI local author” account, in “WI builder — local test”. Test credentials are in
ignored `scratch/quality-wi-build/login.json`; never commit them. Existing rows are synthetic fixtures.

The isolated database is `pulse-quality-wi-20261006`, API port 57721 and database port 57722.
The new feature is enabled only in that runner. Original development database `pulse` is untouched;
retained `pulse-e2e` remains stopped with its volumes retained. No production migration was applied.
Restart the test app with `node tests/quality-work-instructions/local-runtime.mjs dev` if needed.
The runner verifies the isolated database identity and disables outbound email/AI integrations.

Try: create a WI, rename it, edit/reorder steps, add an image and annotations, reload, preview/export,
publish, change it and publish again. Confirm that no number exists before publishing, the number
stays the same afterward, and the original published revision remains readable.

## Bounds and remaining release work

- Conflicts retain local intent and refuse overwriting newer server content. A complete conflict
  resolution interface is outside this first version; a conflict must be investigated before release.
- Browser recovery does not guarantee durability before its asynchronous write commits or provide
  encryption against someone with access to the same browser profile.
- Extremely long purpose/responsibilities or step titles can refuse Word export with an actionable
  message; content is retained. Detailed procedure text belongs in steps. PDF preview shares the SOP document toolbar and page-spacing styles, with continuous centered
  Letter pages on the same gray background. PDF generation uses measured browser text wrapping.
  PDF pages are raster images at twice Letter resolution so browser Unicode and image annotations
  remain visible; PDF text is not selectable/searchable. Word export retains editable text.
  PDF and Word use the same template content but their page breaks can differ.
- Department reassignment, SOP linking, step restore UI and an SOP review flow are outside scope.
- After user acceptance: wire the local SQL/browser tests into CI, verify fresh migration replay
  and final schema parity, run all CI jobs, and separately review production migration/release.
  Existing local database functions were updated during development, so local passing tests alone
  do not substitute for a clean migration replay.
- No push, merge or release is authorized at this stage. Feature rollout is gated by
  `NEXT_PUBLIC_QUALITY_WI_BUILDER_ENABLED=1`; default production builds hide the link.

## WI attribution and revision history (local, October 7)

- WI PDF and Word footer: Document Owner (creator name), page count, confidentiality. Document number and current revision remain in the header; revision history labels its attribution column Document Owner.
- Final revision-history page: revision, release date, description of change, Document Owner (release author). Drafts do not become history entries. Selecting an older release excludes later releases.
- New releases capture creator and release-author names in the immutable snapshot; profile renames do not rewrite that history. Older snapshots without release attribution show “Not recorded.”
- Author lookup returns only the name, gated by existing WI read access. No email fallback. The two additive migrations were applied only to the retained isolated WI database.
- Validation: 43 rolled-back SQL assertions, 20 focused unit/export tests, typecheck and targeted lint. PDF sample rendered and inspected. SOP templates untouched.
- Sample PDF is a standalone artifact; no new WIs were added to the cleaned library. Browser page-count expectations now include the history page; the fixture-creating browser suite was not rerun in this pass.
