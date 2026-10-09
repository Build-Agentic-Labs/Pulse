import { wiPdfFromPages } from "./pdf-pages";
import type { GeneralWorkInstruction } from "@/domain/quality/work-instruction-template";
import { WI_TEMPLATE_CONFIDENTIAL_LINE } from "@/domain/quality/work-instruction-template";
import type { WiStep } from "@/domain/quality-wi/schema";
import { wiImageToPng, fetchWiImageBlob } from "./render-image";
import { fillWiPhotoRows, wrapWiPdfText } from "./pdf-layout";

const WIDTH = 816,
  HEIGHT = 1056,
  LEFT = 40,
  RIGHT = 776,
  BOTTOM = 954;
async function loadImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error("A PDF image could not be rendered."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Local, two-times-resolution Letter pages. No document content is sent to a conversion service. */
export async function buildQualityWiPdf(
  model: GeneralWorkInstruction,
  steps: WiStep[],
) {
  await document.fonts.ready;
  const logo = await loadImage(await fetchWiImageBlob("/sop/ana-logo.png"));
  const images = new Map<string, HTMLImageElement>();
  for (const step of steps)
    if (step.showPhoto !== false && step.image) {
      const png = await wiImageToPng(step.image);
      images.set(
        step.image.id,
        await loadImage(
          new Blob([new Uint8Array(png.data)], { type: "image/png" }),
        ),
      );
    }
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) throw new Error("PDF preview is unavailable in this browser.");
  function lines(text: string, width: number, size: number, bold = false) {
    probe!.font = `${bold ? "bold " : ""}${size}px Arial`;
    return wrapWiPdfText(
      text,
      width,
      (value) => probe!.measureText(value).width,
    );
  }
  const title = lines(
    model.title || "Untitled work instruction",
    376,
    16,
    true,
  );
  // Center the whole identity block beside the logo, including wrapped titles.
  // The label and number belong to the title, rather than to fixed page baselines.
  const identityHeight = 9 + 6 + title.length * 20 + 5 + 10;
  const headerHeight = Math.max(84, identityHeight + 28);
  if (headerHeight > 590)
    throw new Error(
      "Shorten the title before previewing on Letter paper.",
    );
  const canvases: HTMLCanvasElement[] = [];
  let context!: CanvasRenderingContext2D;
  let y = 0;
  function text(
    value: string[],
    x: number,
    top: number,
    size = 12,
    bold = false,
    leading = 16,
    color = "#202428",
  ) {
    context.fillStyle = color;
    context.font = `${bold ? "bold " : ""}${size}px Arial`;
    value.forEach((line, index) =>
      context.fillText(line, x, top + index * leading),
    );
  }
  function rule(x: number, top: number, end: number, bottom = top) {
    context.strokeStyle = "#aaa";
    context.lineWidth = 0.7;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(end, bottom);
    context.stroke();
  }
  function newPage() {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * 2;
    canvas.height = HEIGHT * 2;
    const drawing = canvas.getContext("2d");
    if (!drawing)
      throw new Error("PDF preview is unavailable in this browser.");
    context = drawing;
    context.scale(2, 2);
    context.fillStyle = "white";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    canvases.push(canvas);
    const identityTop = 40 + (headerHeight - identityHeight) / 2;
    context.drawImage(logo, LEFT + 10, 40 + (headerHeight - 26) / 2, 90, 26);
    text([`WORK INSTRUCTION${model.isDraft ? " · DRAFT" : ""}`], 158, identityTop + 9, 9, false, 16, "#5b6167");
    text(title, 158, identityTop + 31, 16, true, 20);
    text([model.documentNumber], 158, identityTop + identityHeight, 10, true);
    text(["Rev"], 558, 56, 9, true);
    text(["Release date"], 627, 56, 9, true);
    text([model.revision || "—"], 558, 80, 10);
    text(lines(model.revisionDate, 137, 9), 627, 80, 9);
    rule(LEFT, 40, RIGHT);
    rule(LEFT, 40 + headerHeight, RIGHT);
    for (const x of [LEFT, 546, 615, RIGHT])
      rule(x, 40, x, 40 + headerHeight);
    rule(546, 64, RIGHT);
    y = 40 + headerHeight;
  }
  newPage();
  for (const [label, value] of [
    ["Purpose / scope", model.purpose],
    ["Responsibilities", model.responsibilities],
  ]) {
    const content = lines(value, 600, 12);
    const height = Math.max(50, content.length * 16 + 20);
    if (y + height > BOTTOM - 100)
      throw new Error(
        "Keep the purpose and responsibilities brief; put detailed actions in the steps.",
      );
    text([label], LEFT, y + 20, 11, true);
    text(content, LEFT + 130, y + 20);
    y += height;
    rule(LEFT, y, RIGHT);
  }
  let pageStart = y;
  let pending: { height: number; hasPhoto: boolean; maxHeight?: number; draw: (top: number, height: number) => void }[] = [];
  function finishStepsPage() {
    const heights = fillWiPhotoRows(pending, BOTTOM - pageStart);
    y = pageStart;
    pending.forEach((row, index) => {
      row.draw(y, heights[index]);
      y += heights[index];
    });
    pending = [];
  }
  for (let index = 0; index < model.steps.length; index++) {
    const step = model.steps[index];
    const image = step.showPhoto !== false && step.image ? images.get(step.image) : undefined;
    const showPhoto = Boolean(image);
    const divider = LEFT + (RIGHT - LEFT) * 0.6;
    const textX = showPhoto ? divider + 12 : LEFT + 12;
    const titleX = textX + 25;
    const instruction = lines(step.instruction, RIGHT - titleX - 12, 12);
    const heading = lines(step.title, RIGHT - titleX - 12, 12, true);
    const headingHeight = heading.length * 16 + 24;
    // Wide reference screenshots need less height than portrait photographs.
    const minimumHeight = image
      ? Math.max(80, Math.min(220, (divider - LEFT - 6) * image.height / image.width + 6))
      : 80;
    let offset = 0,
      part = 0;
    do {
      if (BOTTOM - y < Math.max(minimumHeight, headingHeight + 30)) {
        finishStepsPage();
        newPage();
        pageStart = y;
      }
      const capacity = Math.floor((BOTTOM - y - headingHeight - 20) / 17);
      if (capacity < 1)
        throw new Error(
          "Shorten the step title before previewing this layout.",
        );
      const chunk = instruction.slice(offset, offset + capacity);
      const rowHeight = Math.min(
        BOTTOM - y,
        Math.max(minimumHeight, headingHeight + chunk.length * 17 + 20),
      );
      const continued = part > 0;
      pending.push({ height: rowHeight, hasPhoto: showPhoto,
        maxHeight: image ? Math.max(rowHeight, (divider - LEFT - 6) * image.height / image.width + 6) : rowHeight,
        draw(top, height) {
        rule(LEFT, top, RIGHT);
        if (showPhoto) rule(divider, top, divider, top + height);
        text([String(index + 1)], textX, top + 22, 12, true);
        text(heading, titleX, top + 22, 12, true);
        if (continued) text(["(continued)"], textX, top + headingHeight - 3, 9);
        text(chunk, titleX, top + headingHeight + 12, 12, false, 17);
        if (image) {
          const scale = Math.min(
            (divider - LEFT - 6) / image.width,
            (height - 6) / image.height,
          );
          const width = image.width * scale,
            imageHeight = image.height * scale;
          context.drawImage(
            image,
            LEFT + (divider - LEFT - width) / 2,
            top + (height - imageHeight) / 2,
            width,
            imageHeight,
          );
        }
        rule(LEFT, top + height, RIGHT);
      }});
      y += rowHeight;
      offset += chunk.length;
      part++;
    } while (offset < instruction.length);
  }
  finishStepsPage();
  function historyPage() {
    newPage(); y += 30;
    text(["Revision history"], LEFT, y, 16, true); y += 22;
    rule(LEFT, y, RIGHT);
    ["Revision", "Release date", "Description of change", "Document Owner"].forEach((label, i) => text([label], [48, 128, 248, 588][i], y + 18, 10, true));
    y += 30; rule(LEFT, y, RIGHT);
  }
  historyPage();
  const history = model.revisionHistory ?? [];
  if (!history.length) text(["No published revisions yet."], LEFT, y + 25, 11);
  for (const row of history) {
    const cells = [row.revision, row.releaseDate, row.description, row.authorName].map((value, i) => lines(value, [64, 104, 324, 180][i], 10));
    let offset = 0;
    const length = Math.max(...cells.map(cell => cell.length));
    while (offset < length) {
      if (BOTTOM - y < 42) historyPage();
      const count = Math.min(length - offset, Math.floor((BOTTOM - y - 16) / 14));
      cells.forEach((cell, i) => text(cell.slice(offset, offset + count), [48, 128, 248, 588][i], y + 19, 10, false, 14));
      const end = y + count * 14 + 16;
      for (const x of [LEFT, 120, 240, 580, RIGHT]) rule(x, y, x, end);
      y = end; rule(LEFT, y, RIGHT); offset += count;
    }
  }
  const pages: Uint8Array[] = [];
  for (let index = 0; index < canvases.length; index++) {
    context = canvases[index].getContext("2d")!;
    rule(LEFT, 980, RIGHT);
    const author = lines(`Document Owner: ${model.authorName?.trim() || "Not recorded"}`, 540, 9);
    if (author.length > 2) throw new Error("The author name is too long for the footer.");
    text(author, LEFT, 1000, 9, false, 11);
    text(
      [
        `Page ${index + 1} of ${canvases.length}`,
      ],
      610,
      1000,
      9,
    );

    text(
      lines(WI_TEMPLATE_CONFIDENTIAL_LINE, RIGHT - LEFT, 7),
      LEFT,
      1030,
      7,
      false,
      9,
    );
    const png = await new Promise<Blob>((resolve, reject) =>
      canvases[index].toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Could not prepare a PDF page.")),
        "image/png",
      ),
    );
    pages.push(new Uint8Array(await png.arrayBuffer()));
  }
  return wiPdfFromPages(
    pages,
    model.title || "Work instruction",
    `${model.documentNumber} · ${model.isDraft ? "Working draft" : `Revision ${model.revision}`}`,
  );
}
