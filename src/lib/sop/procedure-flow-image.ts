"use client";

/**
 * Renders the SOP Procedure process-map as one or more PNGs so the exported .docx shows the real
 * flowchart shapes (terminator pill / process rectangle / decision diamond) — Word can't draw
 * those natively. Builds an SVG of the 4-column map (Input | Process step | Output | RASIC),
 * rasterizes it via a canvas, and returns PNG bytes + display size for ImageRun.
 *
 * A tall flow is split across pages: each page's image is capped to a safe height (so it never
 * reaches the footer) and repeats the column headers, with a "continued" label on later pages.
 *
 * Browser-only (needs <canvas>). Returns [] when it can't rasterize (SSR / no canvas / tainted
 * output), and the exporter falls back to a boxed-paragraph flowchart.
 */

import type { Sop, SopShape } from "@/domain/sop/schema";

// Strokes + text only — shapes have no fill and the image has no background, so the PNG is
// fully transparent and the Word page shows through.
const COLOR = { ink: "#000000", muted: "#555555", line: "#888E96", border: "#333333" };

// Rasterize the SVG at this multiple of its logical size, baked into the SVG's own width/height,
// so the browser renders text crisply instead of up-scaling a low-res raster (which looks washed
// out once Word scales the embedded image back down).
const RASTER_SCALE = 3;

/** On-page display width (printable area ≈ 7in at the document's 0.75in side margins). */
const CONTENT_WIDTH = 672;

/**
 * Cap each page's flow image to this display height so it stays clear of the footer. The flow is
 * given a page break before it, so each page has the full printable body height (~9.25in) available
 * and this leaves comfortable slack below the last node.
 */
const PAGE_MAX_DISPLAY_HEIGHT = 780;

// Flowchart geometry, authored near on-page pixel size so the displayed font is readable (~9-10pt).
const GEOM = {
  W: 700,
  PAD: 16,
  stepFont: 13,
  stepLh: 16,
  sideFont: 11,
  sideLh: 14,
  headerFont: 12,
  headerH: 28,
  nodePadX: 16,
  nodePadY: 12,
  arrowGap: 26,
  nodeW: 216,
  branchStubBandH: 24,
};
// Column text boxes, spaced so the framed side columns leave a clear gap between each frame.
const COL = {
  input: { x: GEOM.PAD, w: 116 },
  step: { x: 148, w: 264 },
  output: { x: 428, w: 116 },
  rasic: { x: 560, w: 124 },
};
/** Horizontal padding from a side column's text to its frame; small enough to keep frames apart. */
const FRAME_PAD = 5;
const CX = COL.step.x + COL.step.w / 2;

type RowLayout = {
  activityId: string;
  step: number;
  shape: SopShape;
  descLines: string[];
  inputLines: string[];
  outputLines: string[];
  rasicLines: string[];
  nodeH: number;
  cellH: number;
  branchBandH: number;
  decisionBranches?: {
    yes: BranchTarget;
    no: BranchTarget;
  };
};

type BranchTarget = {
  activityId?: string | null;
  step?: number;
  description: string;
};

type PositionedRow = {
  row: RowLayout;
  center: number;
  nodeTop: number;
  nodeBottom: number;
};

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch] ?? ch);
}

function canRasterize(): boolean {
  try {
    if (typeof document === "undefined") return false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    canvas.width = 2;
    canvas.height = 2;
    return canvas.toDataURL("image/png").startsWith("data:image/png");
  } catch {
    return false;
  }
}

/** Word-wrap `text` to `maxWidth` px using canvas text measurement. */
function makeTextWrapper(fontPx: number): (text: string, maxWidth: number) => string[] {
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx) ctx.font = `${fontPx}px Inter, Arial, sans-serif`;
  return (text, maxWidth) => {
    const words = (text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    if (!ctx) return [text];
    const lines: string[] = [];
    let line = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${line} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
    return lines;
  };
}

function textBlock(x: number, vCenter: number, lines: string[], anchor: "start" | "middle", fontPx: number, lh: number, color: string): string {
  if (!lines.length) return "";
  const top = vCenter - (lines.length * lh) / 2 + lh * 0.72;
  return lines
    .map(
      (ln, i) =>
        `<text x="${x}" y="${top + i * lh}" font-family="Inter, Arial, sans-serif" font-size="${fontPx}" fill="${color}" text-anchor="${anchor}">${escapeXml(ln)}</text>`,
    )
    .join("");
}

function inputBlock(x: number, vCenter: number, step: number, lines: string[], fontPx: number, lh: number): string {
  const totalLines = lines.length + 1;
  const top = vCenter - (totalLines * lh) / 2 + lh * 0.72;
  const stepLabel = `<text class="input-step-number" x="${x}" y="${top}" font-family="Inter, Arial, sans-serif" font-size="10" font-weight="bold" fill="${COLOR.muted}" text-anchor="start">Step ${step}</text>`;
  const inputText = lines
    .map(
      (line, index) =>
        `<text class="input-step-text" x="${x}" y="${top + (index + 1) * lh}" font-family="Inter, Arial, sans-serif" font-size="${fontPx}" fill="${COLOR.ink}" text-anchor="start">${escapeXml(line)}</text>`,
    )
    .join("");
  return stepLabel + inputText;
}

function arrow(x: number, y1: number, y2: number): string {
  const head = 5;
  return (
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 - head}" stroke="${COLOR.line}" stroke-width="1.3"/>` +
    `<polygon points="${x - head},${y2 - head} ${x + head},${y2 - head} ${x},${y2}" fill="${COLOR.line}"/>`
  );
}

function branchLabel(label: string, x: number, y: number, anchor: "start" | "middle" | "end" = "middle"): string {
  return `<text class="decision-branch-label" x="${x}" y="${y}" font-family="Inter, Arial, sans-serif" font-size="10" font-weight="bold" fill="${COLOR.muted}" text-anchor="${anchor}">${escapeXml(label)}</text>`;
}

function verticalBranch(outcome: "yes" | "no", x: number, y1: number, y2: number): string {
  const head = 5;
  const labelY = y1 + (y2 - y1) / 2 + 3;
  return (
    `<path class="decision-branch decision-branch-${outcome}" data-branch="${outcome}" d="M ${x} ${y1} V ${y2 - head}" fill="none" stroke="${COLOR.line}" stroke-width="1.3"/>` +
    `<polygon class="decision-branch-arrow" points="${x - head},${y2 - head} ${x + head},${y2 - head} ${x},${y2}" fill="${COLOR.line}"/>` +
    branchLabel(outcome === "yes" ? "Yes" : "No", x + 9, labelY, "start")
  );
}

function sideBranch(
  outcome: "yes" | "no",
  startX: number,
  startY: number,
  routeX: number,
  targetX: number,
  targetY: number,
): string {
  const head = 5;
  const points =
    targetX < routeX
      ? `${targetX + head},${targetY - head} ${targetX + head},${targetY + head} ${targetX},${targetY}`
      : `${targetX - head},${targetY - head} ${targetX - head},${targetY + head} ${targetX},${targetY}`;
  const labelX = startX + (routeX - startX) / 2;
  return (
    `<path class="decision-branch decision-branch-${outcome}" data-branch="${outcome}" d="M ${startX} ${startY} H ${routeX} V ${targetY} H ${targetX}" fill="none" stroke="${COLOR.line}" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<polygon class="decision-branch-arrow" points="${points}" fill="${COLOR.line}"/>` +
    branchLabel(outcome === "yes" ? "Yes" : "No", labelX, startY - 6)
  );
}

function endBranch(
  outcome: "yes" | "no",
  centerX: number,
  centerY: number,
  nodeW: number,
): string {
  const head = 4;
  const radius = 7;
  const rightward = outcome === "no";
  const startX = centerX + (rightward ? nodeW / 2 : -nodeW / 2);
  const terminalX = rightward
    ? COL.step.x + COL.step.w - radius
    : COL.step.x + radius;
  const terminalEdgeX = terminalX + (rightward ? -radius : radius);
  const lineEndX = terminalEdgeX + (rightward ? -head : head);
  const arrowPoints = `${lineEndX},${centerY - head} ${lineEndX},${centerY + head} ${terminalEdgeX},${centerY}`;
  const labelX = startX + (terminalEdgeX - startX) / 2;
  return (
    `<path class="decision-branch decision-branch-${outcome} decision-branch-end" data-branch="${outcome}" d="M ${startX} ${centerY} H ${lineEndX}" fill="none" stroke="${COLOR.line}" stroke-width="1.3"/>` +
    `<polygon class="decision-branch-arrow" points="${arrowPoints}" fill="${COLOR.line}"/>` +
    `<circle class="decision-branch-terminal decision-branch-terminal-${outcome}" cx="${terminalX}" cy="${centerY}" r="${radius}" fill="none" stroke="${COLOR.border}" stroke-width="1.3"/>` +
    branchLabel(outcome === "yes" ? "Yes" : "No", labelX, centerY - 8) +
    branchLabel("End", terminalX, centerY + 20)
  );
}

function branchStub(
  outcome: "yes" | "no",
  centerX: number,
  nodeBottom: number,
  nodeW: number,
  destination: string,
): string {
  const badgeGap = 8;
  const badgeW = (nodeW - badgeGap) / 2;
  const badgeH = 17;
  const badgeX = outcome === "yes" ? centerX - nodeW / 2 : centerX + badgeGap / 2;
  const badgeY = nodeBottom + 4;
  const labelX = badgeX + badgeW / 2;
  const label = `${outcome === "yes" ? "Yes" : "No"} → ${destination}`;
  return (
    `<path class="decision-branch decision-branch-${outcome}" data-branch="${outcome}" d="M ${centerX} ${nodeBottom} V ${badgeY - 1} H ${labelX}" fill="none" stroke="${COLOR.line}" stroke-width="1.3"/>` +
    `<rect class="decision-branch-stub decision-branch-stub-${outcome}" x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="4" ry="4" fill="none" stroke="${COLOR.line}" stroke-width="1"/>` +
    branchLabel(label, labelX, badgeY + 12)
  );
}

/** Measure every step's wrapped text and box/row heights once, so rows can be packed onto pages. */
function computeRows(sop: Sop): RowLayout[] {
  const { stepFont, stepLh, sideFont, sideLh, nodePadX, nodePadY, nodeW, branchStubBandH } = GEOM;
  const wrapStep = makeTextWrapper(stepFont);
  const wrapSide = makeTextWrapper(sideFont);
  const roles = sop.procedure.roles;
  const activitiesById = new Map(sop.procedure.activities.map((activity) => [activity.id, activity]));
  const resolveTarget = (activityId: string | null | undefined): BranchTarget => {
    if (activityId === null) return { activityId, description: "End" };
    if (activityId === undefined) return { activityId, description: "Not set" };
    const target = activitiesById.get(activityId);
    return target
      ? {
          activityId,
          step: target.step,
          description: `Step ${target.step}`,
        }
      : { activityId, description: "Missing step" };
  };

  return sop.procedure.activities.map((activity) => {
    const shape: SopShape = activity.shape ?? "process";
    const inputLines = activity.input ? wrapSide(activity.input, COL.input.w) : [];
    const outputLines = activity.output ? wrapSide(activity.output, COL.output.w) : [];
    const rasicLines = roles
      .filter((role) => activity.assignments[role])
      .flatMap((role) => wrapSide(`${activity.assignments[role]}: ${role}`, COL.rasic.w));
    const decision = shape === "decision";
    const branches = activity.decisionBranches;
    const branchBandH =
      decision && branches &&
      (branches.yesTargetActivityId !== undefined || branches.noTargetActivityId !== undefined)
        ? branchStubBandH
        : 0;
    const textW = decision ? nodeW * 0.46 : nodeW - 2 * nodePadX;
    const descLines = wrapStep(activity.description || "—", textW);
    const textH = descLines.length * stepLh;
    const nodeH = decision ? Math.max(textH * 2 + 30, 88) : Math.max(textH + 2 * nodePadY, 44);
    const cellH = Math.max(
      nodeH + branchBandH,
      (inputLines.length + 1) * sideLh,
      outputLines.length * sideLh,
      rasicLines.length * sideLh,
    );
    return {
      activityId: activity.id,
      step: activity.step,
      shape,
      descLines,
      inputLines,
      outputLines,
      rasicLines,
      nodeH,
      cellH,
      branchBandH,
      ...(decision && branches && (branches.yesTargetActivityId !== undefined || branches.noTargetActivityId !== undefined)
        ? {
            decisionBranches: {
              yes: resolveTarget(branches.yesTargetActivityId),
              no: resolveTarget(branches.noTargetActivityId),
            },
          }
        : {}),
    };
  });
}

/** Greedily pack rows into pages whose combined row height stays within `rowsBudget` (logical px). */
function paginate(rows: RowLayout[], rowsBudget: number): RowLayout[][] {
  const pages: RowLayout[][] = [];
  let current: RowLayout[] = [];
  let usedH = 0;
  for (const row of rows) {
    const add = (current.length ? GEOM.arrowGap : 0) + row.cellH;
    if (current.length && usedH + add > rowsBudget) {
      pages.push(current);
      current = [];
      usedH = 0;
    }
    usedH += (current.length ? GEOM.arrowGap : 0) + row.cellH;
    current.push(row);
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}

/** Render one page of the flow as an SVG: repeated column headers + its rows joined by arrows. */
function renderPageSvg(pageRows: RowLayout[], continued: boolean): { svg: string; logicalHeight: number } {
  const { W, PAD, headerH, headerFont, stepFont, stepLh, sideFont, sideLh, arrowGap, nodeW } = GEOM;
  const topBand = continued ? headerH + 18 : headerH;

  let height = topBand + PAD;
  pageRows.forEach((row, i) => {
    height += row.cellH + (i < pageRows.length - 1 ? arrowGap : 0);
  });
  height += PAD;

  const parts: string[] = [];

  if (continued) {
    parts.push(
      `<text x="${PAD}" y="15" font-family="Inter, Arial, sans-serif" font-size="11" font-style="italic" fill="${COLOR.muted}" text-anchor="start">Process flow (continued)</text>`,
    );
  }

  const headerY = topBand - 6;
  const headers: Array<[string, number, "start" | "middle"]> = [
    ["Input", COL.input.x, "start"],
    ["Process step", CX, "middle"],
    ["Output", COL.output.x, "start"],
    ["RASIC", COL.rasic.x, "start"],
  ];
  headers.forEach(([label, x, anchor]) => {
    parts.push(
      `<text x="${x}" y="${headerY}" font-family="Inter, Arial, sans-serif" font-size="${headerFont}" font-weight="bold" fill="${COLOR.muted}" text-anchor="${anchor}">${escapeXml(label)}</text>`,
    );
  });

  // One tall frame around each side column (Input / Output / RASIC), grouping all its items; the
  // Process step column stays open for the flowchart. These restart on each page of a split flow.
  const frameTop = topBand + 4;
  const frameBottom = height - PAD + 4;
  const colFrame = (cx: number, cw: number) =>
    `<rect class="col-frame" x="${cx - FRAME_PAD}" y="${frameTop}" width="${cw + 2 * FRAME_PAD}" height="${frameBottom - frameTop}" rx="5" ry="5" fill="none" stroke="${COLOR.muted}" stroke-width="1"/>`;
  parts.push(colFrame(COL.input.x, COL.input.w), colFrame(COL.output.x, COL.output.w), colFrame(COL.rasic.x, COL.rasic.w));

  let y = topBand + PAD;
  const positionedRows: PositionedRow[] = pageRows.map((row) => {
    // Decision stubs use a small band below the diamond. Center the node and side-column text in
    // the remaining row height so the branch badges never intrude into Input or Output.
    const center = y + (row.cellH - row.branchBandH) / 2;
    const nodeTop = center - row.nodeH / 2;
    const nodeBottom = center + row.nodeH / 2;
    y += row.cellH + arrowGap;
    return { row, center, nodeTop, nodeBottom };
  });
  const positionsById = new Map(positionedRows.map((position) => [position.row.activityId, position]));

  positionedRows.forEach(({ row, center, nodeTop, nodeBottom }) => {

    if (row.shape === "decision") {
      const points = `${CX},${nodeTop} ${CX + nodeW / 2},${center} ${CX},${nodeBottom} ${CX - nodeW / 2},${center}`;
      parts.push(`<polygon points="${points}" fill="none" stroke="${COLOR.border}" stroke-width="1.3"/>`);
    } else {
      const rx = row.shape === "terminator" ? row.nodeH / 2 : 7;
      parts.push(
        `<rect x="${CX - nodeW / 2}" y="${nodeTop}" width="${nodeW}" height="${row.nodeH}" rx="${rx}" ry="${rx}" fill="none" stroke="${COLOR.border}" stroke-width="1.3"/>`,
      );
    }

    parts.push(textBlock(CX, center, row.descLines, "middle", stepFont, stepLh, COLOR.ink));
    parts.push(inputBlock(COL.input.x, center, row.step, row.inputLines, sideFont, sideLh));
    parts.push(textBlock(COL.output.x, center, row.outputLines, "start", sideFont, sideLh, COLOR.ink));
    parts.push(textBlock(COL.rasic.x, center, row.rasicLines, "start", sideFont, sideLh, COLOR.ink));
  });

  positionedRows.forEach(({ row, center, nodeBottom }, index) => {
    const next = positionedRows[index + 1];
    if (row.shape !== "decision" || !row.decisionBranches) {
      if (next) parts.push(arrow(CX, nodeBottom, next.nodeTop));
      return;
    }

    const renderBranch = (outcome: "yes" | "no", target: BranchTarget) => {
      const targetPosition = target.activityId ? positionsById.get(target.activityId) : undefined;

      if (target.activityId === null) {
        parts.push(endBranch(outcome, CX, center, nodeW));
        return;
      }

      // `positionsById` contains this page only. When a decision is the last row on a page and
      // its Yes target starts the next page, both `targetPosition` and `next` are undefined.
      // Require a real position before treating equality as the ordinary vertical branch.
      if (outcome === "yes" && targetPosition && targetPosition === next) {
        parts.push(verticalBranch(outcome, CX, nodeBottom, targetPosition.nodeTop));
        return;
      }

      if (targetPosition && targetPosition.row.activityId !== row.activityId) {
        const routeX = outcome === "yes" ? COL.step.x - 7 : COL.step.x + COL.step.w;
        const startX = outcome === "yes" ? CX - nodeW / 2 : CX + nodeW / 2;
        const targetX = outcome === "yes" ? CX - nodeW / 2 : CX + nodeW / 2;
        parts.push(sideBranch(outcome, startX, center, routeX, targetX, targetPosition.center));
        return;
      }

      parts.push(branchStub(outcome, CX, nodeBottom, nodeW, target.description));
    };

    renderBranch("yes", row.decisionBranches.yes);
    renderBranch("no", row.decisionBranches.no);
  });

  // Intrinsic size is RASTER_SCALE× the logical viewBox so the SVG rasterizes at high resolution.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * RASTER_SCALE}" height="${height * RASTER_SCALE}" viewBox="0 0 ${W} ${height}">${parts.join("")}</svg>`;
  return { svg, logicalHeight: height };
}

export type ProcedureFlowPage = {
  svg: string;
  logicalWidth: number;
  logicalHeight: number;
  displayWidth: number;
  displayHeight: number;
};

/** Exported for tests; builds one SVG per page, splitting a tall flow so it never hits the footer. */
export function buildProcedureSvgPages(sop: Sop): ProcedureFlowPage[] {
  const rows = computeRows(sop);
  const budgetLogical = Math.round((PAGE_MAX_DISPLAY_HEIGHT * GEOM.W) / CONTENT_WIDTH);
  // Reserve the header band (+ "continued" band) and top/bottom padding from each page's budget.
  const rowsBudget = Math.max(budgetLogical - (GEOM.headerH + 18 + 2 * GEOM.PAD), 200);
  return paginate(rows, rowsBudget).map((pageRows, index) => {
    const { svg, logicalHeight } = renderPageSvg(pageRows, index > 0);
    return {
      svg,
      logicalWidth: GEOM.W,
      logicalHeight,
      displayWidth: CONTENT_WIDTH,
      displayHeight: Math.round((logicalHeight * CONTENT_WIDTH) / GEOM.W),
    };
  });
}

async function svgToPng(svg: string, logicalW: number, logicalH: number): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => reject(new Error("svg load timeout")), 8000);
      image.onload = () => {
        clearTimeout(timer);
        resolve(image);
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject(new Error("svg load error"));
      };
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(logicalW * RASTER_SCALE);
    canvas.height = Math.round(logicalH * RASTER_SCALE);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    // No background fill — leave the canvas transparent so the exported PNG has a clear background.
    // The SVG's intrinsic size already equals the canvas, so draw 1:1 for crisp text.
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One rasterized PNG per flow page (empty array when canvas isn't available — caller falls back). */
export async function renderProcedureFlowImages(
  sop: Sop,
): Promise<Array<{ data: Uint8Array; width: number; height: number }>> {
  if (!sop.procedure.activities.length || !canRasterize()) return [];
  try {
    const images: Array<{ data: Uint8Array; width: number; height: number }> = [];
    for (const page of buildProcedureSvgPages(sop)) {
      const data = await svgToPng(page.svg, page.logicalWidth, page.logicalHeight);
      images.push({ data, width: page.displayWidth, height: page.displayHeight });
    }
    return images;
  } catch {
    return [];
  }
}
