// @vitest-environment jsdom
import { expect, it, vi, afterEach } from "vitest";
import { nativeSvgText } from "./svg-text";
afterEach(() => vi.restoreAllMocks());
it("exports text annotations without foreignObject and retains escaped content", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text: string) => ({ width: text.length * 5 }),
  } as unknown as CanvasRenderingContext2D);
  const markup =
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject x="10" y="20" width="200" height="100"><div style="font-size:12px;color:#111;text-align:left;border:2px solid #ffcc00">Confirm &lt;record&gt;</div></foreignObject></svg>';
  const output = nativeSvgText(markup);
  expect(output).not.toContain("foreignObject");
  expect(output).toContain("Confirm &lt;record&gt;");
  expect(output).toContain("<rect");
});
