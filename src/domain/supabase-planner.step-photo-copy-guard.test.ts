import { describe, expect, it } from "vitest";

import type { StepPhotoAttachment } from "./step-photos";

// `copyStepPhotoAttachmentToStep` must reject a photo that still carries its ORIGINAL id
// (i.e. was never run through `duplicateStepPhotoAttachment`) before it touches Storage --
// otherwise the derived destination path collapses onto the source path and the metadata
// upsert silently overwrites the source photo's row (see the doc comment above the guard in
// supabase-planner.ts).
//
// No client fixture is needed here, unlike other supabase-planner test files (see
// supabase-planner.master-bom.test.ts): the guard must fire before the function ever reads
// `supabase`. Proof of that is built into the test itself -- with no `project` context,
// `assertTaskInProject` returns without touching the client, and in a server/node
// environment (no `window`, exactly what this "unit" project test runs under)
// `plannerClient()` returns a Proxy that throws its own "browser-only" error on ANY property
// access (see supabase-planner.server-guard.test.ts for that mechanism). So if the guard were
// ever bypassed, this test would fail with that unrelated error instead of the guard's.
describe("copyStepPhotoAttachmentToStep", () => {
  it("throws before touching storage when the destination path collapses onto the source path", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    const { copyStepPhotoAttachmentToStep } = await import("./supabase-planner");

    const photo: StepPhotoAttachment = {
      id: "photo-1",
      name: "Panel.png",
      dataUrl: "https://example.test/panel.png",
      capturedAt: "2026-08-27T00:00:00.000Z",
      contentType: "image/jpeg",
    };

    // Deliberately reuses photo.id in the source path, as if the caller forgot to duplicate
    // the photo before pasting it back onto the very step it came from.
    const sourceStoragePath = "task-1/step-1/photo-1.jpg";

    await expect(
      copyStepPhotoAttachmentToStep("task-1", "step-1", photo, sourceStoragePath, undefined),
    ).rejects.toThrow(/destination path matches the source path/);
  });
});
