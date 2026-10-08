# DOCX to general work instruction conversion

Entry: **Quality → WI Builder → Convert WI**. Uses the selected department (normally the user's assigned department). Published WIs do not expose this action.

The converter reads DOCX text, table coordinates, numbering hints, image relationships and DrawingML crop/rotation/flip settings. It sends every supported image, explicitly labeled, with the source evidence to the configured Anthropic model. The model produces sequenced steps, original metadata, image descriptions and exclusions. Coverage is calculated from one canonical set of references. A second model call independently checks the source, images and proposed result. Material omissions or mismatches trigger one bounded correction attempt, followed by another independent review. Unresolved problems prevent import. The review screen retains source ambiguities for the author to resolve in the draft.

## Identity and document fields

- The authenticated importing user owns the draft. The source author's name is preserved verbatim as metadata; it never selects an account or grants permissions.
- The selected department must pass existing Quality department-edit permissions. A department name in the document does not override the selection.
- The source title initializes the editable draft title. Original number, author, revision and date remain in the source details disclosure.
- The new WI receives its normal Pulse number when published. Source approvals and revision dates do not become a new release.
- Image filenames derive from their step titles. Storage uses immutable UUID paths, independent of filenames, within the correct organization, WI and step.

## Failure and recovery

A private reservation stores each conversion under a caller-generated UUID. Only its requester, with current department-edit access, can read or import it. Source files use the existing private conversion bucket. Reserved image policies permit only exact registered paths. Images must finish uploading before the result is ready.

The import RPC creates the WI and every step in one database transaction. Retrying that same conversion returns the same document; it cannot resurrect an imported WI that was later hard-deleted. After upload, the dialog closes and a conversion row appears in the department table with an indeterminate progress bar. Server-backed job summaries restore it after navigation, refresh, or reopening the app. Ready rows offer Review; failed rows show the error and Try again. No fabricated percentage is shown. No existing autosave mechanism is replaced.

Processing is bounded below the route's five-minute limit. A killed request is recognized as timed out when reopened. Results expire for new import after 24 hours. Failed/expired reservation records and any unused immutable images are private and are not automatically purged by this feature. The source DOCX is removed on normal request completion or failure; source cleanup is best effort if a host is terminated.

## Configuration

Server-only `ANTHROPIC_API_KEY` is required. Multi-workspace keys also require `ANTHROPIC_WORKSPACE_ID`. Set the same configuration in the deployed environment before release. Never use a `NEXT_PUBLIC_` prefix for AI credentials.

Extraction model: `WI_EXTRACTION_MODEL`, default `claude-sonnet-5-5`. Independent review model: `WI_REVIEW_MODEL`, default `claude-opus-5-5`. The feature reuses the app's Anthropic integration and supports the optional workspace header for SOP conversion too.

## Supported boundaries

DOCX only, 20 MB, 40 embedded images, 500 evidence blocks, 150 resulting steps. Larger or slower documents must be split. Linked images are not fetched; undecodable pictures remain accounted for with review warnings. Tracked changes and legacy embedded objects are rejected with instructions to prepare the document in Word first. Image pairing and process interpretation remain probabilistic: the independent audit and review screen reduce errors, but do not guarantee their absence.

Tests include synthetic DOCX rotation/linked-image/invalid-XML cases, metadata and coverage validation, audit rejection, API access and failure handling, UI recovery, and `tests/quality-work-instructions/conversion.sql` for permissions, image reservation, atomicity and idempotency. The user-supplied document stays outside tracked fixtures.

## Verified sample

The supplied ANA Delivery Photos DOCX completed through the live app with 37 steps, 19 assigned procedural images, 21 total accounted-for images and 90 source blocks. The imported draft retained Jaylynn Johnson / FIP-00001 / revision C / 08/21/2025 as source metadata while using the authenticated importing owner and selected department. It remained unpublished with normal WI numbering pending publication. Browser verification included leaving and returning during conversion, table review, atomic draft creation, and the editor's Saved state. Source caption conflicts and incomplete folder instructions still require author review; this is evidence for one sample, not a guarantee for every document.
