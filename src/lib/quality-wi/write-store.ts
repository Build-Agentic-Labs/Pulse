import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { getUserFromSession } from "@/domain/supabase-planner";
import type { PendingWiEdit } from "@/domain/quality-wi/schema";
import { qualityWiClient } from "./client";

type Result = {
  id: string;
  version: number;
  operation?: string;
  revisionId?: string;
  documentNumber?: string;
};
async function send(
  id: string,
  operation: string | undefined,
  request: () => PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
    status?: number;
  }>,
  assertCurrent: () => void,
): Promise<Result> {
  for (let attempt = 0; attempt < 2; attempt++) {
    assertCurrent();
    let result;
    try {
      result = await request();
    } catch (error) {
      if (attempt === 0) continue;
      throw error;
    }
    assertCurrent();
    if (result.error) {
      if (result.status === 0 && attempt === 0) continue;
      throw Object.assign(new Error(result.error.message), { code: result.error.code });
    }
    const value = result.data as Result | null;
    if (
      !value ||
      value.id !== id ||
      !Number.isInteger(value.version) ||
      value.version < 1 ||
      (operation && value.operation !== operation)
    )
      throw new Error(
        "Unable to confirm the work instruction save. Your draft has been retained.",
      );
    return value;
  }
  throw new Error("Unable to save the work instruction.");
}
async function accountGuard(
  client: SupabaseClient<Database> | undefined,
  assertCurrent: () => void,
  expectedActor?: string,
) {
  const db = qualityWiClient(client);
  const session = await getUserFromSession(
    db as unknown as SupabaseClient<Database>,
  );
  if (expectedActor && session.data.user?.id !== expectedActor)
    throw new Error("Account changed. Your draft has been retained.");
  if (!session.data.user) throw new Error("Sign in to edit work instructions.");
  const actor = session.data.user.id;
  return {
    actor,
    check: async () => {
      assertCurrent();
      const current = await getUserFromSession(
        db as unknown as SupabaseClient<Database>,
      );
      assertCurrent();
      if (current.data.user?.id !== actor)
        throw new Error("Account changed. Your draft has been retained.");
    },
  };
}
export async function createQualityWi(
  id: string,
  workspaceId: string,
  departmentId: string,
  client?: SupabaseClient<Database>,
  assertCurrent: () => void = () => undefined,
  expectedActor?: string,
) {
  const guard = await accountGuard(client, assertCurrent, expectedActor);
  const db = qualityWiClient(client);
  return send(
    id,
    undefined,
    async () => {
      await guard.check();
      return db.rpc("create_quality_wi", {
        p_id: id,
        p_workspace: workspaceId,
        p_department: departmentId,
        p_actor: guard.actor,
      });
    },
    assertCurrent,
  );
}
export async function saveQualityWiEdit(
  id: string,
  entry: PendingWiEdit,
  client?: SupabaseClient<Database>,
  assertCurrent: () => void = () => undefined,
  expectedActor?: string,
) {
  if (entry.expectedVersion === undefined)
    throw new Error("A confirmed document version is required.");
  const guard = await accountGuard(client, assertCurrent, expectedActor);
  const db = qualityWiClient(client);
  const payload = { ...entry.edit.payload } as Record<string, unknown>;
  delete payload.dataUrl;
  if (entry.edit.kind === "image" && entry.edit.payload.image) {
    const image = { ...entry.edit.payload.image };
    delete image.url;
    payload.image = image;
  }
  return send(
    id,
    entry.operation,
    async () => {
      await guard.check();
      return db.rpc("edit_quality_wi", {
        p_id: id,
        p_expected_version: entry.expectedVersion!,
        p_operation: entry.operation,
        p_kind: entry.edit.kind,
        p_payload: payload as Json,
        p_actor: guard.actor,
      });
    },
    assertCurrent,
  );
}
export async function deleteQualityWi(
  id: string,
  workspaceId: string,
  version: number,
  client?: SupabaseClient<Database>,
  assertCurrent: () => void = () => undefined,
  expectedActor?: string,
) {
  const guard = await accountGuard(client, assertCurrent, expectedActor);
  const db = qualityWiClient(client);
  return send(id, undefined, async () => {
    await guard.check();
    return db.rpc("delete_quality_wi", {
      p_id: id,
      p_workspace: workspaceId,
      p_expected_version: version,
      p_actor: guard.actor,
    });
  }, assertCurrent);
}
export async function publishQualityWi(
  id: string,
  version: number,
  operation: string,
  description: string,
  client?: SupabaseClient<Database>,
  assertCurrent: () => void = () => undefined,
  expectedActor?: string,
) {
  const guard = await accountGuard(client, assertCurrent, expectedActor);
  const db = qualityWiClient(client);
  return send(
    id,
    operation,
    async () => {
      await guard.check();
      return db.rpc("publish_quality_wi", {
        p_id: id,
        p_expected_version: version,
        p_operation: operation,
        p_description: description,
        p_actor: guard.actor,
      });
    },
    assertCurrent,
  );
}
