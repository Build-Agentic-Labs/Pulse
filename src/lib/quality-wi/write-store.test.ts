import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  createQualityWi,
  deleteQualityWi,
  publishQualityWi,
  saveQualityWiEdit,
} from "./write-store";
const auth = vi.hoisted(() => ({ id: "author" }));
vi.mock("@/domain/supabase-planner", () => ({
  getUserFromSession: vi.fn(async () => ({
    data: { user: auth.id ? { id: auth.id } : null },
  })),
  createPlannerSupabaseClient: vi.fn(() => {
    throw Error("Default browser client must not be used");
  }),
}));
beforeEach(() => {
  auth.id = "author";
});
const client = (rpc: ReturnType<typeof vi.fn>) =>
  ({ rpc }) as unknown as SupabaseClient<Database>;
it("uses only the injected client and sends the captured actor", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { id: "wi", version: 1 }, error: null });
  await createQualityWi("wi", "workspace", "department", client(rpc));
  expect(rpc).toHaveBeenCalledExactlyOnceWith("create_quality_wi", {
    p_id: "wi",
    p_workspace: "workspace",
    p_department: "department",
    p_actor: "author",
  });
});
it("retries transport failure with identical operation and version", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ error: { message: "offline" }, status: 0 })
    .mockResolvedValueOnce({
      data: { id: "wi", version: 4, operation: "same" },
      error: null,
    });
  await saveQualityWiEdit(
    "wi",
    {
      operation: "same",
      expectedVersion: 3,
      edit: { kind: "details", payload: { title: "Edit" } },
    },
    client(rpc),
  );
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  expect(rpc).toHaveBeenCalledTimes(2);
});
it("never retries a database conflict", async () => {
  const rpc = vi.fn().mockResolvedValue({
    error: { code: "PT409", message: "Conflict" },
    status: 409,
  });
  await expect(
    saveQualityWiEdit(
      "wi",
      {
        operation: "same",
        expectedVersion: 3,
        edit: { kind: "details", payload: { title: "Edit" } },
      },
      client(rpc),
    ),
  ).rejects.toThrow("Conflict");
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("rejects wrong-document or wrong-operation acknowledgment", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { id: "other", version: 4, operation: "same" },
    error: null,
  });
  await expect(
    publishQualityWi("wi", 3, "same", "Release", client(rpc)),
  ).rejects.toThrow("Unable to confirm");
});
it("will not submit under a different account on a retry", async () => {
  const rpc = vi.fn().mockImplementationOnce(async () => {
    auth.id = "second";
    throw Error("transport");
  });
  await expect(createQualityWi("wi", "w", "d", client(rpc))).rejects.toThrow(
    "Account changed",
  );
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("does not write after the editor scope expires", async () => {
  const rpc = vi.fn();
  await expect(
    createQualityWi("wi", "w", "d", client(rpc), () => {
      throw Error("Scope changed");
    }),
  ).rejects.toThrow("Scope changed");
  expect(rpc).not.toHaveBeenCalled();
});
it("does not claim database persistence for an image data URL", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { id: "wi", version: 2, operation: "image" },
    error: null,
  });
  await saveQualityWiEdit(
    "wi",
    {
      operation: "image",
      expectedVersion: 1,
      edit: {
        kind: "image",
        payload: {
          id: "step",
          dataUrl: "data:image/jpeg;base64,test",
          image: {
            id: "photo",
            name: "Photo",
            storagePath: "w/wi/step/photo.jpg",
            width: 1,
            height: 1,
            url: "blob:local",
          },
        },
      },
    },
    client(rpc),
  );
  expect(rpc.mock.calls[0][1].p_payload).not.toHaveProperty("dataUrl");
  expect(rpc.mock.calls[0][1].p_payload.image).not.toHaveProperty("url");
});

it("cannot begin an old editor's write under a new signed-in account", async () => {
  auth.id = "new-account";
  const rpc = vi.fn();
  await expect(
    createQualityWi(
      "wi",
      "w",
      "d",
      client(rpc),
      () => undefined,
      "original-account",
    ),
  ).rejects.toThrow("Account changed");
  expect(rpc).not.toHaveBeenCalled();
});


it("deletes using the captured author, workspace and displayed version", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { id: "wi", version: 7 }, error: null });
  await deleteQualityWi("wi", "workspace", 7, client(rpc), () => {}, "author");
  expect(rpc).toHaveBeenCalledExactlyOnceWith("delete_quality_wi", {
    p_id: "wi", p_workspace: "workspace", p_expected_version: 7, p_actor: "author",
  });
});

it("does not delete under a changed account", async () => {
  auth.id = "other";
  const rpc = vi.fn();
  await expect(deleteQualityWi("wi", "workspace", 1, client(rpc), () => {}, "author")).rejects.toThrow("Account changed");
  expect(rpc).not.toHaveBeenCalled();
});
