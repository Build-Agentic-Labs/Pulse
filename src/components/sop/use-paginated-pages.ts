import { useEffect, useRef, useState } from "react";
import { packBlocks, type MeasuredBlock, type PagePlan } from "@/domain/sop/pagination";
import type { PrintBlock } from "./print-blocks";

const FONTS_READY_TIMEOUT_MS = 3000;
const REMEASURE_DEBOUNCE_MS = 150;

export interface PaginatedSegments {
  sections: readonly PrintBlock[];
  trailing: readonly PrintBlock[];
}

export function usePaginatedPages({ sections, trailing }: PaginatedSegments) {
  const offscreenRef = useRef<HTMLDivElement | null>(null);
  const [sectionPages, setSectionPages] = useState<PagePlan[]>([]);
  const [trailingPages, setTrailingPages] = useState<PagePlan[]>([]);
  const [measuring, setMeasuring] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMeasuring(true);

    // getBoundingClientRect ignores margins, and this document's spacing is
    // margin-driven (.sop-export-section margin-top, p margin-bottom) — rect
    // heights would under-measure every page and the page box would clip the
    // shortfall. Successive offsetTops inside a position:relative segment
    // container attribute every margin to a block, so the sum matches the
    // real flowed layout exactly.
    function measureSegment(root: HTMLElement, blocks: readonly PrintBlock[], segment: string): MeasuredBlock[] {
      const container = root.querySelector<HTMLElement>(`[data-segment="${segment}"]`);
      if (!container) return [];
      const nodes = blocks.map((block) =>
        container.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`),
      );
      const bottom = container.scrollHeight;
      return blocks.map((block, index) => {
        const node = nodes[index];
        const top = node?.offsetTop ?? 0;
        const nextTop = nodes[index + 1]?.offsetTop ?? bottom;
        const height = Math.max(0, nextTop - top);
        const probe = node?.querySelector<HTMLElement>("p") ?? node;
        const raw = probe ? window.getComputedStyle(probe).lineHeight : "normal";
        const parsed = Number.parseFloat(raw);
        // Two different heights on purpose. `height` is the flow delta —
        // margins included — and is what a placement costs the page.
        // `contentHeight` is the text box alone and is what line arithmetic
        // divides; rounding the margin-inflated delta would invent a phantom
        // line at the end of every cut paragraph.
        const contentHeight = probe ? probe.getBoundingClientRect().height : undefined;
        return {
          id: block.id,
          category: block.category,
          sectionTitle: block.sectionTitle,
          keepWithNext: block.keepWithNext,
          splittable: block.splittable,
          height,
          contentHeight: block.splittable ? contentHeight : undefined,
          lineHeight: block.splittable
            ? (Number.isFinite(parsed) && parsed > 0 ? parsed : height)
            : undefined,
        };
      });
    }

    function usableHeight(root: HTMLElement): number {
      // The probe page replicates the real article: header + empty body + footer
      // at fixed 11in. The body's clientHeight IS the usable space — measured,
      // never hardcoded, because the header grows when a long title wraps.
      const body = root.querySelector<HTMLElement>("[data-measure-body]");
      if (!body) return 0;
      const paddingTop = Number.parseFloat(window.getComputedStyle(body).paddingTop) || 0;
      return body.clientHeight - paddingTop;
    }

    function continuationHeadingHeight(root: HTMLElement): number {
      // The "(cont.)" heading occupies real height on continuation pages; the
      // packer must budget it or those pages overfill by one heading. Read the
      // sentinel's offsetTop, not the section's offsetHeight — the h2's bottom
      // margin escapes by collapse and offsetHeight would under-budget it.
      return root.querySelector<HTMLElement>("[data-measure-cont-end]")?.offsetTop ?? 0;
    }

    async function measure(): Promise<void> {
      try {
        // Measuring before webfonts settle makes every height wrong by a few
        // percent, and reproduces only on cold loads. The race keeps a hung
        // fonts promise from blanking the preview forever.
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, FONTS_READY_TIMEOUT_MS)),
        ]);
        const root = offscreenRef.current;
        if (!root || cancelled) return;

        const usable = usableHeight(root);
        const contHeading = continuationHeadingHeight(root);
        const measuredSections = measureSegment(root, sections, "sections");
        const measuredTrailing = measureSegment(root, trailing, "trailing");

        if (cancelled) return;
        setSectionPages(packBlocks(measuredSections, usable, contHeading));
        setTrailingPages(packBlocks(measuredTrailing, usable, contHeading));
        setFailed(false);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`SOP preview pagination failed; falling back to the unpaginated layout: ${detail}`);
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setMeasuring(false);
      }
    }

    let timer = window.setTimeout(() => { void measure(); }, REMEASURE_DEBOUNCE_MS);
    let observerPrimed = false;
    const observer = new ResizeObserver(() => {
      // ResizeObserver fires once immediately on observe(); that initial
      // delivery would bypass the debounce and double-measure every change.
      if (!observerPrimed) {
        observerPrimed = true;
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void measure(); }, REMEASURE_DEBOUNCE_MS);
    });
    if (offscreenRef.current) observer.observe(offscreenRef.current);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [sections, trailing]);

  return { sectionPages, trailingPages, measuring, failed, offscreenRef };
}
