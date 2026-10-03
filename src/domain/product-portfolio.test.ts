import { describe, expect, it } from "vitest";
import { portfolioInsertionPosition, sortPortfolioProducts } from "./product-portfolio";

const products = [
  { id: "a", createdAt: "2026-01-01", portfolioPosition: 1024 },
  { id: "b", createdAt: "2026-01-02", portfolioPosition: 2048 },
  { id: "c", createdAt: "2026-01-03", portfolioPosition: 3072 },
];

describe("portfolio ordering", () => {
  it("places a moved product before, between, or after existing siblings without changing them", () => {
    for (let index = 0; index <= products.length; index++) {
      const moved = { id: "moved", createdAt: "2026-02-01", portfolioPosition: portfolioInsertionPosition(products, index) };
      const ordered = sortPortfolioProducts([...products, moved]);
      expect(ordered[index].id).toBe("moved");
      expect(ordered.filter((product) => product.id !== "moved")).toEqual(products);
    }
  });
  it("preserves a new position after serialization and repeated reorders", () => {
    const siblings = products.filter((product) => product.id !== "c");
    const moved = { ...products[2], portfolioPosition: portfolioInsertionPosition(siblings, 0) };
    const reloaded = JSON.parse(JSON.stringify([...siblings, moved]));
    expect(sortPortfolioProducts(reloaded).map((product) => product.id)).toEqual(["c", "a", "b"]);
    expect(Number.isFinite(portfolioInsertionPosition([], 0))).toBe(true);
  });
  it("provides deterministic ordering for older cached products and equal positions", () => {
    const cached = [{ id: "z", createdAt: "2026-01-01" }, { id: "a", createdAt: "2026-01-01" }];
    expect(sortPortfolioProducts(cached).map((product) => product.id)).toEqual(["a", "z"]);
    expect(sortPortfolioProducts([...cached, products[1]])[0].id).toBe("b");
  });
  it("rejects exhausted position gaps rather than silently saving an ambiguous order", () => {
    expect(() => portfolioInsertionPosition([{ portfolioPosition: 1024 }, { portfolioPosition: 1024 }], 1)).toThrow();
  });
});
