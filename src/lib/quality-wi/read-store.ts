import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type {
  QualityWi,
  WiImage,
  WiRevision,
  WiStep,
} from "@/domain/quality-wi/schema";
import { wiTemplateDocument } from "@/domain/quality-wi/schema";
import { qualityWiClient } from "./client";

const LIST_FIELDS =
  "id,workspace_id,department_id,title,document_number,version,has_changes,published_revision_id,updated_at,department:departments!quality_work_instructions_department_id_fkey(code,name)";
type Row = Record<string, unknown>;
function mapDocument(row: Row): QualityWi {
  const department = row.department as { code: string; name: string } | null;
  return {
    authorName: typeof row.author_name === "string" ? row.author_name : undefined,
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    departmentId: String(row.department_id),
    departmentCode: department?.code ?? "",
    departmentName: department?.name ?? "",
    title: String(row.title ?? ""),
    purpose: String(row.purpose ?? ""),
    responsibilities: String(row.responsibilities ?? ""),
    documentNumber: row.document_number as string | null,
    version: Number(row.version),
    hasChanges: Boolean(row.has_changes),
    publishedRevisionId: row.published_revision_id as string | null,
    updatedAt: String(row.updated_at),
    steps: [],
  };
}
function mapStep(row: Row): WiStep {
  return {
    id: String(row.id),
    position: Number(row.position),
    title: String(row.title),
    instruction: String(row.instruction),
    image: row.image as WiImage | null,
  };
}
async function pages<T>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await read(from, from + 499);
    if (result.error) throw new Error(result.error.message);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
export async function listQualityWis(
  workspaceId: string,
  client?: SupabaseClient<Database>,
): Promise<QualityWi[]> {
  const db = qualityWiClient(client);
  const rows = await pages((from, to) =>
    db
      .from("quality_work_instructions")
      .select(LIST_FIELDS)
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => mapDocument(row as unknown as Row));
}
export async function loadQualityWi(
  workspaceId: string,
  id: string,
  client?: SupabaseClient<Database>,
): Promise<QualityWi> {
  const db = qualityWiClient(client);
  const result = await db.rpc("load_quality_wi_document", {
    p_workspace: workspaceId,
    p_id: id,
  });
  if (result.error) throw new Error(result.error.message);
  if (!result.data)
    throw new Error("Work instruction is unavailable in this organization.");
  const row = result.data as unknown as Row;
  return { ...mapDocument(row), steps: (row.steps as Row[]).map(mapStep) };
}
export async function listWiRevisions(
  document: QualityWi,
  client?: SupabaseClient<Database>,
): Promise<WiRevision[]> {
  const db = qualityWiClient(client);
  const rows = await pages((from, to) =>
    db
      .from("quality_wi_revisions")
      .select("id,revision_index,snapshot,change_description,published_at")
      .eq("wi_id", document.id)
      .order("revision_index", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => {
    const snapshot = row.snapshot as unknown as {
      title: string;
      purpose: string;
      responsibilities: string;
      documentNumber: string;
      revisionDate: string;
      revisionDescription: string;
      authorName?: string;
      revisionAuthorName?: string;
      steps: Omit<WiStep, "position">[];
    };
    const steps = snapshot.steps.map((step, index) => ({
      ...step,
      position: index + 1,
    }));
    return {
      id: row.id,
      revisionIndex: row.revision_index,
      publishedAt: row.published_at,
      changeDescription: row.change_description,
      authorName: snapshot.revisionAuthorName?.trim() || "Not recorded",
      steps,
      snapshot: wiTemplateDocument(
        { ...document, ...snapshot, steps },
        row.revision_index,
        snapshot.revisionDate,
        snapshot.revisionDescription,
      ),
    };
  });
}
export async function signWiImages(
  document: QualityWi,
  client?: SupabaseClient<Database>,
): Promise<QualityWi> {
  const paths = document.steps.flatMap((step) =>
    step.image ? [step.image.storagePath] : [],
  );
  if (!paths.length) return document;
  const result = await qualityWiClient(client)
    .storage.from("quality-wi-images")
    .createSignedUrls(paths, 900);
  if (result.error) throw new Error(result.error.message);
  const urls = new Map(result.data.map((item) => [item.path, item.signedUrl]));
  return {
    ...document,
    steps: document.steps.map((step) => ({
      ...step,
      image: step.image
        ? { ...step.image, url: urls.get(step.image.storagePath) ?? undefined }
        : null,
    })),
  };
}
