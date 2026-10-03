import type { PortfolioCategory } from "./types";

export const PRODUCT_CATEGORIES: ReadonlyArray<{ id: PortfolioCategory; label: string }> = [
  { id: "generators", label: "Generators" },
  { id: "compressors", label: "Compressors" },
  { id: "hybrid", label: "Hybrid" },
  { id: "power-modules", label: "Power Modules" },
  { id: "trailers", label: "Trailers" },
];
export function portfolioCategoryLabel(category?: PortfolioCategory) {
  return PRODUCT_CATEGORIES.find((item) => item.id === category)?.label ?? "Uncategorized";
}

/** A stable order also handles older cached products that have no saved position yet. */
export function sortPortfolioProducts<T extends { id: string; createdAt: string; portfolioPosition?: number }>(products: readonly T[]): T[] {
  return [...products].sort((left, right) =>
    (left.portfolioPosition ?? Number.MAX_SAFE_INTEGER) - (right.portfolioPosition ?? Number.MAX_SAFE_INTEGER)
    || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

/** Insert between neighbors without rewriting other products or their planner data. */
export function portfolioInsertionPosition(products: readonly { portfolioPosition?: number }[], index: number): number {
  const previous = index > 0 ? products[index - 1]?.portfolioPosition : undefined;
  const next = products[index]?.portfolioPosition;
  const position = previous === undefined ? (next ?? 1024) - 1024
    : next === undefined ? previous + 1024 : previous + (next - previous) / 2;
  if (!Number.isFinite(position) || position === previous || position === next) {
    throw new Error("These products are too closely ordered. Move the product to the end first, then try again.");
  }
  return position;
}
