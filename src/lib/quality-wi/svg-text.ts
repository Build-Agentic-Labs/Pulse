/** Canvas refuses some SVG foreignObject images. Convert styled text boxes to native SVG text. */
export function nativeSvgText(markup: string) {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = parsed.documentElement;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image export is unavailable.");
  const ns = "http://www.w3.org/2000/svg";
  for (const foreign of [...svg.querySelectorAll("foreignObject")]) {
    const box = foreign.querySelector("div");
    if (!box) continue;
    const style = box.getAttribute("style") ?? "";
    const attribute = (key: string, fallback: string) =>
      style.match(new RegExp(`(?:^|;)${key}:([^;]+)`))?.[1] ?? fallback;
    const x = Number(foreign.getAttribute("x")),
      y = Number(foreign.getAttribute("y")),
      width = Number(foreign.getAttribute("width")),
      height = Number(foreign.getAttribute("height"));
    const size = parseFloat(attribute("font-size", "20px")),
      color = attribute("color", "#1a1a1a"),
      align = attribute("text-align", "left");
    const padding = size * 0.35;
    context.font = `500 ${size}px Arial`;
    const lines: string[] = [];
    for (const paragraph of (box.textContent ?? "").split("\n")) {
      let current = "";
      for (const char of paragraph) {
        if (
          current &&
          context.measureText(current + char).width > width - padding * 2
        ) {
          lines.push(current);
          current = "";
        }
        current += char;
      }
      lines.push(current);
    }
    const group = parsed.createElementNS(ns, "g"),
      rect = parsed.createElementNS(ns, "rect");
    for (const [name, value] of Object.entries({
      x,
      y,
      width,
      height,
      fill: "white",
      "fill-opacity": 0.94,
      stroke: style.match(/border:[^;]*?(#[a-fA-F0-9]+)/)?.[1] ?? "#ffcc00",
      "stroke-width": 2,
    }))
      rect.setAttribute(name, String(value));
    group.append(rect);
    const available = Math.max(
      1,
      Math.floor((height - padding * 2) / (size * 1.35)),
    );
    lines.slice(0, available).forEach((line, index) => {
      const text = parsed.createElementNS(ns, "text");
      text.setAttribute(
        "x",
        String(
          align === "center"
            ? x + width / 2
            : align === "right"
              ? x + width - padding
              : x + padding,
        ),
      );
      text.setAttribute("y", String(y + padding + size + index * size * 1.35));
      text.setAttribute("font-size", String(size));
      text.setAttribute("font-family", "Arial");
      text.setAttribute("font-weight", "500");
      text.setAttribute("fill", color);
      text.setAttribute(
        "text-anchor",
        align === "center" ? "middle" : align === "right" ? "end" : "start",
      );
      text.textContent = line;
      group.append(text);
    });
    foreign.replaceWith(group);
  }
  return new XMLSerializer().serializeToString(svg);
}
