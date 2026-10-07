import { dataUrlToBlob } from "@/lib/planner/media-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { WiImage } from "@/domain/quality-wi/schema";
import { qualityWiClient } from "./client";
/** Immutable uploads; removing/replacing an editor image never deletes the old object. */
export async function uploadWiImage(
  image: WiImage,
  dataUrl: string,
  client?: SupabaseClient<Database>,
  assertCurrent: () => void = () => undefined,
  expectedActor?: string,
) {
  if (!dataUrl.startsWith("data:image/jpeg;base64,"))
    throw new Error("Prepare the photo before uploading it.");
  assertCurrent();
  const blob = dataUrlToBlob(dataUrl);
  assertCurrent();
  const db = qualityWiClient(client);
  const session = await db.auth.getSession();
  assertCurrent();
  if (
    session.error ||
    !session.data.session ||
    (expectedActor && session.data.session.user.id !== expectedActor)
  )
    throw new Error("Account changed. Your draft has been retained.");
  const token = session.data.session.access_token;
  const bucket = db.storage.from("quality-wi-images");
  const result = await bucket.upload(image.storagePath, blob, {
    contentType: "image/jpeg",
    upsert: false,
    headers: { Authorization: `Bearer ${token}` },
  });
  assertCurrent();
  // Retry after an acknowledged-or-lost upload uses its immutable, operation-specific object path.
  if (result.error && String(result.error.statusCode) !== "409")
    throw new Error(result.error.message);
}
