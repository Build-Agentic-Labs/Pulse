# Mobile photo preparation extraction — 2026-10-05

Baseline: published main `999c1a6`. Bounded implementation on `codex/mobile-photo-preparation`.
Local validation completed. User approved publication on 2026-10-05; merge is gated on green GitHub
CI. This is a code extraction release with no database activation.

## Change and ownership

`src/components/mobile-photo-portal/photo-preparation.ts` owns decoding an image file, resizing to a
maximum 1,280-pixel edge without upscaling, JPEG encoding at quality 0.72, and returning attachment
metadata. Its two internal helpers and constants stay private. Only `buildPhotoAttachment` is exported.
The existing FileReader helper is reused. No IndexedDB operation is invoked by photo preparation.

The portal retains file selection, draft state, upload orchestration, persistence, errors and UI.
Its two existing call sites remain unchanged. All three moved function bodies are byte-identical
apart from the export modifier, including resource cleanup, error messages and metadata generation.
No hooks, effects, JSX, styles, dependencies, permissions, database or Delete/Restore code changed.

## Observed results

| Measurement | Before | After |
|---|---:|---:|
| Mobile component lines | 4,068 | 3,998 |
| Photo preparation module lines | — | 73 |
| Portal chunk raw bytes | 80,622 | 80,622 |
| Portal chunk gzip bytes | 21,868 | 21,857 |
| Production JavaScript chunks | 112 | 112 |
| App tests | 2,208 | 2,221 |

The 11-byte gzip difference is negligible build output variation, not a speed improvement claim.
This extraction makes ownership clearer; it does not reduce the total amount of production code.
No network or timing improvement is claimed. Actual app photo uploads still follow the same paths.

13 characterization cases passed on the original implementation before extraction and on the new
module afterward. They cover landscape/portrait resizing, no upscaling, extreme aspect ratios,
metadata, unnamed-file fallback, invalid file type, decoder failure, missing context, failed encoding
and FileReader failure. URL release is asserted on both decode outcomes. The temporary original
function export used for characterization was removed; no new export remains on the client component.

66 targeted photo/mobile-authoring/recovery/capture cases pass. The full app suite passes 2,221 tests
in 256 files. Lint, production build, subsequent standalone typecheck and bundle budgets pass.

A real Chromium probe exercised both original and extracted implementations with browser-generated
PNG files (2,560 × 1,920; 1,920 × 2,560; 640 × 480). The JPEG data URLs were identical byte-for-byte;
actual decoded output sizes were 1,280 × 960, 960 × 1,280 and 640 × 480. It also verified the non-image
rejection. This probe exercises the browser media pipeline; it is not a full authenticated upload or
rendered-screen workflow test. Existing component tests cover parent authoring behavior. No database
was started, reset, queried or modified for this slice.

Raw summaries and body-comparison hash:
[measurement evidence](../outputs/measurements/mobile-photo-preparation/2026-10-05/validation.json),
[before bundle](../outputs/measurements/mobile-photo-preparation/2026-10-05/before-bundle.json),
[after bundle](../outputs/measurements/mobile-photo-preparation/2026-10-05/after-bundle.json),
[browser photo outputs](../outputs/measurements/mobile-photo-preparation/2026-10-05/browser.json).
The original bodies are reproducible from the baseline commit. Browser byte results are for the
same browser run and generated inputs, not a cross-browser encoding guarantee.

Further extraction is optional. Delete/Restore remains paused at the user's request; this slice
does not advance its pilot, remote concurrency gates or any database rollout.
