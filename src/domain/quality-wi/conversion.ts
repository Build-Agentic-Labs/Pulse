import type { WiImage, WiStep } from "./schema";
export type SourceBlock = {
  id: string;
  text: string;
  imageIds: string[];
  context?: string;
};
export type SourceAsset = {
  id: string;
  name: string;
  sourceId: string;
  width: number;
  height: number;
  available: boolean;
  placement?: string;
};
export type ConversionEvidence = {
  blocks: SourceBlock[];
  assets: SourceAsset[];
  warnings: string[];
  hash: string;
};
export type ConversionMetadata = {
  title: string;
  author: string;
  documentNumber: string;
  revision: string;
  date: string;
  department: string;
  sourceIds: string[];
};
export type ConversionDraft = {
  title: string;
  purpose: string;
  responsibilities: string;
  metadata: ConversionMetadata;
  steps: {
    title: string;
    instruction: string;
    imageId: string | null;
    sourceIds: string[];
  }[];
  images: {
    imageId: string;
    description: string;
    disposition: "step" | "reference" | "branding" | "unusable";
    reason: string;
  }[];
  coverage: { sourceId: string; stepNumbers: number[]; reason: string }[];
  warnings: string[];
};
export type ConversionSource = {
  fileName: string;
  hash: string;
  metadata: ConversionMetadata;
  warnings: string[];
  model: string;
  convertedAt: string;
};
export type ConversionUploadImage = WiImage & {
  sourceImageId: string;
  stepId: string;
};
export type PreparedWiConversion = {
  title: string;
  purpose: string;
  responsibilities: string;
  steps: WiStep[];
  uploads: ConversionUploadImage[];
  source: ConversionSource;
  evidence: ConversionEvidence;
  analysis: Pick<ConversionDraft, "images" | "coverage">;
};
export type ConversionReview = {
  id: string;
  status: "processing" | "ready" | "imported" | "failed";
  departmentId: string;
  fileName: string;
  error?: string;
  payload?: PreparedWiConversion;
};

export type ConversionJob = Omit<ConversionReview, "payload"> & { createdAt: string };

function object(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw new Error("The conversion returned an invalid object.");
  return x as Record<string, unknown>;
}
function text(x: unknown, limit: number, allowEmpty = false): string {
  if (typeof x !== "string" || x.length > limit || (!allowEmpty && !x.trim()))
    throw new Error("The conversion returned missing or oversized text.");
  return x.trim();
}
function array(x: unknown, max: number): unknown[] {
  if (!Array.isArray(x) || x.length > max)
    throw new Error("The conversion returned an invalid list.");
  return x;
}
/** Reject invented references and unaccounted content instead of silently dropping them. */
export function validateWiConversion(
  raw: unknown,
  evidence: ConversionEvidence,
): ConversionDraft {
  const r = object(raw),
    blocks = new Set(evidence.blocks.map((b) => b.id)),
    assets = new Map(evidence.assets.map((a) => [a.id, a]));
  const refs = (x: unknown, required = true) => {
    const ids = array(x, 500).map((v) => text(v, 50));
    if ((required && !ids.length) || ids.some((id) => !blocks.has(id)))
      throw new Error("A converted field has no valid source evidence.");
    return [...new Set(ids)];
  };
  const meta = object(r.metadata);
  const metadata: ConversionMetadata = {
    title: text(meta.title, 300, true),
    author: text(meta.author, 300, true),
    documentNumber: text(meta.documentNumber, 100, true),
    revision: text(meta.revision, 100, true),
    date: text(meta.date, 100, true),
    department: text(meta.department, 200, true),
    sourceIds: refs(
      meta.sourceIds,
      Object.entries(meta).some(
        ([k, v]) => k !== "sourceIds" && typeof v === "string" && v.trim(),
      ),
    ),
  };
  const metadataEvidence = evidence.blocks.filter((block) =>
    metadata.sourceIds.includes(block.id),
  );
  const normalize = (value: string) =>
    value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  if (!metadataEvidence.some((block) => block.imageIds.length)) {
    const original = normalize(
      metadataEvidence.map((block) => block.text).join(" "),
    );
    for (const key of ["author", "documentNumber", "date"] as const) {
      if (metadata[key] && !original.includes(normalize(metadata[key])))
        throw new Error(
          `The original ${key} could not be verified against the source.`,
        );
    }
  }
  const steps = array(r.steps, 150).map((x) => {
    const s = object(x);
    const imageId = s.imageId === null ? null : text(s.imageId, 50);
    if (imageId && !assets.get(imageId)?.available)
      throw new Error("A step references an unavailable source image.");
    return {
      title: text(s.title, 300),
      instruction: text(s.instruction, 12000),
      imageId,
      sourceIds: refs(s.sourceIds),
    };
  });
  if (!steps.length)
    throw new Error("No usable work instruction steps were found.");
  const images = array(r.images, 40).map((x) => {
    const i = object(x),
      imageId = text(i.imageId, 50),
      disposition = text(
        i.disposition,
        30,
      ) as ConversionDraft["images"][number]["disposition"];
    if (
      !assets.has(imageId) ||
      !["step", "reference", "branding", "unusable"].includes(disposition)
    )
      throw new Error("An image could not be accounted for.");
    if ((disposition === "step") !== steps.some((s) => s.imageId === imageId))
      throw new Error("An image assignment conflicts with its description.");
    return {
      imageId,
      disposition,
      description: text(i.description, 2000),
      reason: text(i.reason, 2000),
    };
  });
  if (
    new Set(images.map((i) => i.imageId)).size !== assets.size ||
    images.length !== assets.size
  )
    throw new Error("The conversion did not account for every source image.");
  const coverage = array(r.coverage, 500).map((x) => {
    const c = object(x),
      sourceId = text(c.sourceId, 50);
    if (!blocks.has(sourceId))
      throw new Error("The conversion invented source content.");
    const stepNumbers = array(c.stepNumbers, 150).map((n) => {
      if (
        typeof n !== "number" ||
        !Number.isInteger(n) ||
        n < 1 ||
        n > steps.length
      )
        throw new Error("The converted step order is invalid.");
      if (!steps[n - 1].sourceIds.includes(sourceId))
        throw new Error("Step evidence and source coverage disagree.");
      return n;
    });
    return { sourceId, stepNumbers, reason: text(c.reason, 1000) };
  });
  if (
    coverage.length !== blocks.size ||
    new Set(coverage.map((c) => c.sourceId)).size !== blocks.size
  )
    throw new Error(
      "Some source content was not accounted for. Please retry the conversion.",
    );
  if (
    steps.some((s, index) =>
      s.sourceIds.some(
        (id) =>
          !coverage
            .find((c) => c.sourceId === id)
            ?.stepNumbers.includes(index + 1),
      ),
    )
  )
    throw new Error("A step is missing from its source coverage.");
  return {
    title: text(r.title, 300),
    purpose: text(r.purpose, 12000, true),
    responsibilities: text(r.responsibilities, 12000, true),
    metadata,
    steps,
    images,
    coverage,
    warnings: array(r.warnings, 80).map((x) => text(x, 2000)),
  };
}
export function conversionImageName(title: string, sourceName: string): string {
  const stem = title
    .normalize("NFKC")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${stem || sourceName.replace(/\.[^.]+$/u, "").slice(0, 120) || "Reference image"}.jpg`;
}
/** A source name is evidence, never an identity lookup or an authorization assignment. */
export function buildWiConversion(
  draft: ConversionDraft,
  evidence: ConversionEvidence,
  input: {
    id: string;
    workspaceId: string;
    fileName: string;
    model: string;
    now: string;
  },
  uuid: () => string,
): PreparedWiConversion {
  const uploads: ConversionUploadImage[] = [];
  const add = (sourceImageId: string, stepId: string, title: string) => {
    const asset = evidence.assets.find((a) => a.id === sourceImageId)!;
    const id = uuid();
    const image = {
      id,
      sourceImageId,
      stepId,
      name: conversionImageName(title, asset.name),
      storagePath: `${input.workspaceId}/${input.id}/${stepId}/${id}.jpg`,
      width: asset.width,
      height: asset.height,
    };
    uploads.push(image);
    return image;
  };
  const steps = draft.steps.map((s, index) => {
    const id = uuid();
    return {
      id,
      position: index + 1,
      title: s.title,
      instruction: s.instruction,
      image: s.imageId ? add(s.imageId, id, s.title) : null,
    };
  });
  for (const asset of evidence.assets)
    if (asset.available && !uploads.some((u) => u.sourceImageId === asset.id))
      add(asset.id, uuid(), asset.name.replace(/\.[^.]+$/, ""));
  return {
    title: draft.title,
    purpose: draft.purpose,
    responsibilities: draft.responsibilities,
    steps,
    uploads,
    evidence,
    analysis: { images: draft.images, coverage: draft.coverage },
    source: {
      fileName: input.fileName,
      hash: evidence.hash,
      metadata: draft.metadata,
      warnings: [...new Set([...evidence.warnings, ...draft.warnings])],
      model: input.model,
      convertedAt: input.now,
    },
  };
}
export function validateConversionAudit(raw: unknown): {
  blocking: string[];
  warnings: string[];
} {
  const r = object(raw);
  return {
    blocking: array(r.blocking, 40).map((v) => text(v, 2000)),
    warnings: array(r.warnings, 80).map((v) => text(v, 2000)),
  };
}

export function readConversionSource(
  value: unknown,
): ConversionSource | undefined {
  try {
    const s = object(value),
      m = object(s.metadata);
    return {
      fileName: text(s.fileName, 255),
      hash: text(s.hash, 64),
      model: text(s.model, 150),
      convertedAt: text(s.convertedAt, 100),
      warnings: array(s.warnings, 100).map((w) => text(w, 2000)),
      metadata: {
        title: text(m.title, 300, true),
        author: text(m.author, 300, true),
        documentNumber: text(m.documentNumber, 100, true),
        revision: text(m.revision, 100, true),
        date: text(m.date, 100, true),
        department: text(m.department, 200, true),
        sourceIds: array(m.sourceIds, 500).map((id) => text(id, 50)),
      },
    };
  } catch {
    return undefined;
  }
}

/** Model emits one canonical set of step references; coverage is computed, never guessed twice. */
export function normalizeWiExtraction(
  raw: unknown,
  evidence: ConversionEvidence,
): ConversionDraft {
  const r = object(raw),
    metadata = object(r.metadata);
  const steps = array(r.steps, 150).map((value) => {
    const step = object(value);
    const sourceIds = array(step.sourceIds, 500).map((id) => text(id, 50));
    const image = evidence.assets.find((asset) => asset.id === step.imageId);
    return {
      ...step,
      imageId: step.imageId,
      sourceIds: [
        ...new Set([...sourceIds, ...(image ? [image.sourceId] : [])]),
      ],
    };
  });
  const excluded = new Map(
    array(r.excludedBlocks, 500).map((value) => {
      const item = object(value),
        id = text(item.sourceId, 50);
      if (!evidence.blocks.some((block) => block.id === id))
        throw new Error("The conversion invented an excluded source block.");
      return [id, text(item.reason, 1000)] as const;
    }),
  );
  const metadataIds = array(metadata.sourceIds, 500);
  const detailIds = array(r.detailSourceIds, 500).map((id) => text(id, 50));
  if (detailIds.some((id) => !evidence.blocks.some((block) => block.id === id)))
    throw new Error("Document details reference unknown source content.");
  const images = array(r.images, 40).map((value) => {
    const image = object(value),
      used = steps.some((step) => step.imageId === image.imageId);
    if (
      !["step", "reference", "branding", "unusable"].includes(
        String(image.disposition),
      )
    )
      throw new Error("Unknown source image classification.");
    if (used && ["branding", "unusable"].includes(String(image.disposition)))
      throw new Error("A step uses a branding or unusable image.");
    return {
      ...image,
      imageId: image.imageId,
      disposition: used
        ? "step"
        : image.disposition === "step"
          ? "reference"
          : image.disposition,
    };
  });
  const coverage = evidence.blocks.map((block) => {
    const stepNumbers = steps.flatMap((step, index) =>
      step.sourceIds.includes(block.id) ? [index + 1] : [],
    );
    const imageNotes = evidence.assets
      .filter((asset) => asset.sourceId === block.id)
      .map((asset) => images.find((image) => image.imageId === asset.id));
    const reason = stepNumbers.length
      ? "Used in procedure steps"
      : metadataIds.includes(block.id)
        ? "Original document metadata"
        : detailIds.includes(block.id)
          ? "Purpose, scope or responsibilities"
          : (excluded.get(block.id) ??
            (imageNotes.length && imageNotes.every(Boolean)
              ? "Source images accounted for in image mapping"
              : ""));
    if (!reason)
      throw new Error(
        `Source block ${block.id} was not accounted for. Please retry the conversion.`,
      );
    return { sourceId: block.id, stepNumbers, reason };
  });
  return validateWiConversion({ ...r, steps, images, coverage }, evidence);
}

/** Bounded AI corrections update content only; account identity and storage paths never enter this contract. */
export function applyWiConversionCorrection(
  raw: unknown,
  correction: unknown,
): unknown {
  const r = object(raw),
    p = object(correction),
    steps = [...array(r.steps, 150)],
    images = [...array(r.images, 40)];
  const edited = new Set<number>();
  for (const value of array(p.stepEdits, 150)) {
    const edit = object(value),
      index = edit.stepNumber;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 1 ||
      index > steps.length ||
      edited.has(index)
    )
      throw new Error("Invalid corrected step number.");
    edited.add(index);
    steps[index - 1] = object(edit.step);
  }
  const editedImages = new Set<string>();
  for (const value of array(p.imageEdits, 40)) {
    const image = object(value),
      id = text(image.imageId, 50),
      index = images.findIndex((value) => object(value).imageId === id);
    if (index < 0 || editedImages.has(id))
      throw new Error("Invalid corrected image reference.");
    editedImages.add(id);
    images[index] = image;
  }
  const details = p.details === null ? {} : object(p.details);
  if (
    Object.keys(details).some(
      (key) =>
        !["title", "purpose", "responsibilities", "detailSourceIds"].includes(
          key,
        ),
    )
  )
    throw new Error("Invalid corrected details.");
  return {
    ...r,
    ...details,
    steps: p.replacementSteps === null ? steps : array(p.replacementSteps, 150),
    images,
    metadata: p.metadata === null ? r.metadata : object(p.metadata),
    excludedBlocks:
      p.excludedBlocks === null
        ? r.excludedBlocks
        : array(p.excludedBlocks, 500),
    warnings: array(p.warnings, 80),
  };
}
