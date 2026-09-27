/** Legacy remarks store selection context separately from the user's prose in the body. */
export function reviewQuotes(body: string): string[] {
  return Array.from(body.matchAll(/(?:^|\n\n)Selected text: “([\s\S]*?)”\n/g), (match) => match[1]);
}

/** Match within the original section; never guess when edited text is missing or ambiguous. */
export function reviewTextRange(root: HTMLElement, category: string, quote: string): Range | null {
  if (!quote) return null;
  const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-review-category]"))
    .filter((section) => section.dataset.reviewCategory === category);
  const matches: Range[] = [];
  for (const section of sections) {
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) nodes.push(node as Text);
    const text = nodes.map((item) => item.data).join("");
    const start = text.indexOf(quote);
    if (start < 0) continue;
    if (text.indexOf(quote, start + 1) >= 0) return null;
    const range = document.createRange();
    let offset = 0;
    for (const item of nodes) {
      const end = offset + item.length;
      if (start >= offset && start < end) range.setStart(item, start - offset);
      if (start + quote.length > offset && start + quote.length <= end) range.setEnd(item, start + quote.length - offset);
      offset = end;
    }
    matches.push(range);
  }
  return matches.length === 1 ? matches[0] : null;
}
