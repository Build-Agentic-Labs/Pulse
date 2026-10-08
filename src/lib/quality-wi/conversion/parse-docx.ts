import { createHash } from "node:crypto";
import path from "node:path";
import PizZip from "pizzip";
import { DOMParser, type Element } from "@xmldom/xmldom";
import sharp from "sharp";
import type { ConversionEvidence } from "@/domain/quality-wi/conversion";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const all = (e: Element, ns: string, name: string) =>
  Array.from(e.getElementsByTagNameNS(ns, name));
function xml(value: string) {
  if (value.length > 4_000_000 || /<!DOCTYPE|<!ENTITY/i.test(value))
    throw new Error(
      "The DOCX contains unsupported XML. Save a fresh DOCX copy and retry.",
    );
  return new DOMParser({
    onError: (level, message) => {
      if (level !== "warning")
        throw new Error(`Invalid DOCX XML: ${message.slice(0, 120)}`);
    },
  }).parseFromString(value, "application/xml").documentElement!;
}
export type ParsedWiDocx = {
  evidence: ConversionEvidence;
  images: Map<string, Buffer>;
};
/** No external links, macros, remote images or file-system paths are executed. */
export async function parseWiDocx(buffer: Buffer): Promise<ParsedWiDocx> {
  if (!buffer.length || buffer.length > 20 * 1024 * 1024)
    throw new Error("Upload a DOCX no larger than 20 MB.");
  let zip: PizZip;
  try {
    zip = new PizZip(buffer);
  } catch {
    throw new Error(
      "This file is not a readable DOCX. Save it as .docx and retry.",
    );
  }
  const entries = Object.values(zip.files);
  let expanded = 0;
  for (const entry of entries) {
    const data = (entry as unknown as { _data?: { uncompressedSize?: number } })
      ._data;
    expanded += data?.uncompressedSize ?? 0;
  }
  if (entries.length > 4000 || expanded > 80 * 1024 * 1024)
    throw new Error(
      "This DOCX expands beyond the conversion limit. Split it into smaller documents.",
    );
  const readXml = (name: string) => {
    const f = zip.file(name);
    if (!f) throw new Error("The DOCX is missing its document structure.");
    return xml(f.asText());
  };
  const doc = readXml("word/document.xml"),
    rels = readXml("word/_rels/document.xml.rels");
  const relationships = new Map(
    Array.from(rels.childNodes)
      .filter((n) => n.nodeType === 1)
      .map((n) => {
        const e = n as Element;
        return [
          e.getAttribute("Id"),
          {
            target: e.getAttribute("Target") ?? "",
            external: e.getAttribute("TargetMode") === "External",
          },
        ] as const;
      }),
  );
  const evidence: ConversionEvidence = {
    blocks: [],
    assets: [],
    warnings: [],
    hash: createHash("sha256").update(buffer).digest("hex"),
  };
  const images = new Map<string, Buffer>();
  let totalText = 0,
    totalImageBytes = 0;
  if (all(doc, W, "ins").length || all(doc, W, "del").length)
    throw new Error(
      "Accept or reject tracked changes in Word before converting this document.",
    );
  if (
    doc.getElementsByTagNameNS("urn:schemas-microsoft-com:vml", "shape")
      .length ||
    all(doc, W, "object").length
  )
    throw new Error(
      "This document contains legacy drawings or embedded objects. Convert them to pictures in Word before importing.",
    );
  if (all(doc, W, "txbxContent").length)
    evidence.warnings.push(
      "The source contains text boxes. Check their reading order in the converted steps.",
    );
  for (const kind of ["header", "footer"]) {
    const parts = entries.filter((e) =>
      new RegExp(`^word/${kind}\\d+\\.xml$`).test(e.name),
    );
    for (const part of parts) {
      const root = xml(part.asText());
      const t = all(root, W, "t")
        .map((n) => n.textContent)
        .join(" ")
        .trim();
      if (t)
        evidence.blocks.push({
          id: `${kind}-${evidence.blocks.length}`,
          text: `${kind}: ${t}`,
          imageIds: [],
        });
      if (all(root, A, "blip").length)
        evidence.warnings.push(
          `Source ${kind} graphics are not imported as procedure images.`,
        );
    }
  }
  const numberingPart = zip.file("word/numbering.xml");
  const numbering = numberingPart ? xml(numberingPart.asText()) : null;
  const body = all(doc, W, "body")[0];
  if (!body) throw new Error("The DOCX has no document body.");
  const paragraphs = all(body, W, "p");
  if (paragraphs.length > 3000)
    throw new Error(
      "This document has too many paragraphs. Split it into smaller WIs.",
    );
  for (const [index, p] of paragraphs.entries()) {
    const sourceId = `p${index}`,
      text = all(p, W, "t")
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
    totalText += text.length;
    if (totalText > 100_000)
      throw new Error(
        "This document has too much text. Split it into smaller WIs.",
      );
    const context: string[] = [];
    const style = all(p, W, "pStyle")[0]?.getAttributeNS(W, "val");
    if (style) context.push(`Paragraph style: ${style}`);
    const num = all(p, W, "numPr")[0];
    if (num) {
      const numId = all(num, W, "numId")[0]?.getAttributeNS(W, "val"),
        level = all(num, W, "ilvl")[0]?.getAttributeNS(W, "val") ?? "0";
      const definition =
        numbering &&
        all(numbering, W, "num").find(
          (n) => n.getAttributeNS(W, "numId") === numId,
        );
      const abstractId =
        definition &&
        all(definition, W, "abstractNumId")[0]?.getAttributeNS(W, "val");
      const abstract =
        numbering &&
        all(numbering, W, "abstractNum").find(
          (n) => n.getAttributeNS(W, "abstractNumId") === abstractId,
        );
      const format =
        abstract &&
        all(abstract, W, "lvl").find(
          (n) => n.getAttributeNS(W, "ilvl") === level,
        );
      context.push(
        `Word list ${numId}, level ${level}, format ${format && all(format, W, "numFmt")[0]?.getAttributeNS(W, "val")}, pattern ${format && all(format, W, "lvlText")[0]?.getAttributeNS(W, "val")}`,
      );
    }
    let ancestor = p.parentNode;
    while (ancestor && ancestor !== body) {
      if ((ancestor as Element).localName === "tc") {
        const cell = ancestor as Element,
          row = cell.parentNode as Element,
          table = row.parentNode as Element;
        context.push(
          `Table ${all(body, W, "tbl").indexOf(table) + 1}, row ${all(table, W, "tr").indexOf(row) + 1}, cell ${all(row, W, "tc").indexOf(cell) + 1}`,
        );
        break;
      }
      ancestor = ancestor.parentNode;
    }
    const imageIds: string[] = [];
    for (const blip of all(p, A, "blip")) {
      if (evidence.assets.length >= 40)
        throw new Error(
          "This WI has more than 40 images. Split it into smaller WIs so every image can be reviewed.",
        );
      const id = `img${evidence.assets.length + 1}`;
      imageIds.push(id);
      const rid =
          blip.getAttributeNS(R, "embed") || blip.getAttributeNS(R, "link"),
        rel = relationships.get(rid);
      const entryName = rel
        ? path.posix.normalize(path.posix.join("word", rel.target))
        : "";
      let placementNode = blip.parentNode;
      while (
        placementNode &&
        placementNode !== p &&
        !["anchor", "inline"].includes(
          (placementNode as Element).localName ?? "",
        )
      )
        placementNode = placementNode.parentNode;
      const anchor =
        (placementNode as Element | null)?.localName === "anchor"
          ? (placementNode as Element)
          : undefined;
      const placement = anchor
        ? `Floating image; horizontal ${all(anchor, WP, "positionH")[0]?.textContent ?? ""}; vertical ${all(anchor, WP, "positionV")[0]?.textContent ?? ""}; units EMU`
        : "Inline image";
      const asset = {
        placement,
        id,
        name: path.posix.basename(entryName) || id,
        sourceId,
        width: 0,
        height: 0,
        available: false,
      };
      evidence.assets.push(asset);
      if (!rel || rel.external || !entryName.startsWith("word/media/")) {
        evidence.warnings.push(
          `${id}: linked or external image was not retrieved. Supply an embedded copy if needed.`,
        );
        continue;
      }
      const entry = zip.file(entryName);
      if (!entry)
        throw new Error(`The source image ${id} is missing from the DOCX.`);
      const raw = entry.asNodeBuffer();
      if (raw.length > 20 * 1024 * 1024)
        throw new Error(`Source image ${id} is too large.`);
      let pic = blip.parentNode?.parentNode as Element | undefined;
      if (!pic)
        throw new Error(`The source image ${id} has no placement information.`);
      // The blip belongs to a pic:pic; its DrawingML transform is independent of ZIP order.
      while (pic.parentNode && pic.localName !== "pic")
        pic = pic.parentNode as Element;
      const transform = all(pic, A, "xfrm")[0],
        crop = all(pic, A, "srcRect")[0];
      try {
        const metadata = await sharp(raw, {
          limitInputPixels: 40_000_000,
        }).metadata();
        if (
          !metadata.width ||
          !metadata.height ||
          !["png", "jpeg", "webp", "gif", "tiff"].includes(
            metadata.format ?? "",
          )
        )
          throw new Error("unsupported format");
        let pipeline = sharp(raw, { limitInputPixels: 40_000_000 });
        const [l, t, r, b] = ["l", "t", "r", "b"].map(
          (k) => Number(crop?.getAttribute(k) || 0) / 100000,
        );
        if (
          [l, t, r, b].some((n) => !Number.isFinite(n) || n < 0) ||
          l + r >= 1 ||
          t + b >= 1
        )
          throw new Error("unsupported crop");
        if (l || t || r || b) {
          const left = Math.round(metadata.width * l),
            top = Math.round(metadata.height * t);
          pipeline = pipeline.extract({
            left,
            top,
            width: Math.max(1, Math.round(metadata.width * (1 - r)) - left),
            height: Math.max(1, Math.round(metadata.height * (1 - b)) - top),
          });
        }
        if (["1", "true"].includes(transform?.getAttribute("flipH") ?? ""))
          pipeline = pipeline.flop();
        if (["1", "true"].includes(transform?.getAttribute("flipV") ?? ""))
          pipeline = pipeline.flip();
        const rotation = Number(transform?.getAttribute("rot") || 0) / 60000;
        if (!Number.isFinite(rotation)) throw new Error("invalid rotation");
        if (rotation)
          pipeline = pipeline.rotate(rotation, { background: "#ffffff" });
        const { data, info } = await pipeline
          .resize({
            width: 1568,
            height: 1568,
            fit: "inside",
            withoutEnlargement: true,
          })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 90 })
          .toBuffer({ resolveWithObject: true });
        totalImageBytes += data.length;
        if (totalImageBytes > 15 * 1024 * 1024)
          throw new Error("image budget exceeded");
        asset.width = info.width;
        asset.height = info.height;
        asset.available = true;
        images.set(id, data);
      } catch (error) {
        if (error instanceof Error && error.message === "image budget exceeded")
          throw new Error(
            "The combined images are too large. Split this WI into smaller documents.",
          );
        evidence.warnings.push(
          `${id} (${asset.name}) could not be decoded with its Word formatting. It remains unassigned; replace it in the draft if required.`,
        );
      }
    }
    if (text || imageIds.length)
      evidence.blocks.push({
        id: sourceId,
        text,
        imageIds,
        ...(context.length ? { context: context.join("; ") } : {}),
      });
  }
  if (numbering && all(doc, W, "numPr").length)
    evidence.warnings.push(
      "Word list formatting was supplied as context. Verify any original numbered cross-references against the new step numbers.",
    );
  if (evidence.blocks.length > 500)
    throw new Error(
      "This WI has more than 500 content blocks. Split it into smaller WIs.",
    );
  if (!evidence.blocks.some((b) => b.text))
    throw new Error(
      "No readable procedure text was found. Supply a DOCX with text and embedded pictures.",
    );
  if (all(doc, WP, "anchor").length)
    evidence.warnings.push(
      "The source uses floating images. Check image-to-step assignments where captions and image content differ.",
    );
  return { evidence, images };
}
