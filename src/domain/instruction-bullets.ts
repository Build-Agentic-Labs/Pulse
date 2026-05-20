const bulletLinePattern = /^(\s*)-\s?(.*)$/;
const existingListPattern = /^\s*(?:[-*]|\d+[.)])\s+/;

export function applyInstructionBullets(value: string) {
  if (!value.trim()) {
    return "- ";
  }

  return value
    .split("\n")
    .map((line) => {
      if (!line.trim()) {
        return line;
      }

      if (existingListPattern.test(line)) {
        return line.replace(/^\s*[*]\s+/, "- ");
      }

      return `- ${line.trim()}`;
    })
    .join("\n");
}

export function resolveBulletEnter(value: string, selectionStart: number, selectionEnd: number) {
  const lineStart = value.lastIndexOf("\n", Math.max(selectionStart - 1, 0)) + 1;
  const nextLineBreak = value.indexOf("\n", selectionStart);
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
  const currentLine = value.slice(lineStart, lineEnd);
  const match = currentLine.match(bulletLinePattern);

  if (!match) {
    return null;
  }

  const [, indent = "", body = ""] = match;

  if (!body.trim()) {
    const before = value.slice(0, lineStart);
    const after = value.slice(lineEnd).replace(/^\n/, "");
    return {
      value: before + after,
      selectionStart: lineStart,
    };
  }

  const insert = `\n${indent}- `;
  return {
    value: value.slice(0, selectionStart) + insert + value.slice(selectionEnd),
    selectionStart: selectionStart + insert.length,
  };
}
