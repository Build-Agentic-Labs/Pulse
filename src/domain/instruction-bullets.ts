export type InstructionFormat = "steps" | "bullets" | "note" | "check";
export const instructionListPattern = /^([ \t]*)([-*•]|\d+[.)]|[A-Z]+[.)])(?:[ \t]+|$)(.*)$/;
export function letterLabel(number: number): string {
  let label = "";
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return label;
}
function letterNumber(label: string) { return [...label].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0); }
function nextMarker(marker: string) {
  if (/^\d/.test(marker)) return `${parseInt(marker, 10) + 1}${marker.at(-1)}`;
  if (/^[A-Z]/.test(marker)) return `${letterLabel(letterNumber(marker.slice(0, -1)) + 1)}${marker.at(-1)}`;
  return marker;
}
function renumberLetters(value: string) {
  let previous: string | undefined;
  return value.split("\n").map(line => {
    const match = line.match(instructionListPattern);
    if (match && /^[A-Z0-9]/.test(match[2])) {
      const sameKind = previous && /^[A-Z]/.test(previous) === /^[A-Z]/.test(match[2]);
      const marker = sameKind ? nextMarker(previous!) : match[2];
      previous = marker;
      return `${match[1]}${marker} ${match[3]}`;
    }
    if (!/^[ \t]+\S/.test(line)) previous = undefined;
    return line;
  }).join("\n");
}
export function formatInstruction(value: string, start: number, end: number, format: InstructionFormat) {
  const from = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextBreak = value.indexOf("\n", last);
  const to = nextBreak < 0 ? value.length : nextBreak;
  let index = 0;
  const lines = value.slice(from, to).split("\n").map(line => {
    const body = line.replace(instructionListPattern, "$3").replace(/^[ \t]*(?:Note|Check):[ \t]*/i, "");
    if (!line.trim() && to > from) return line;
    const marker = format === "steps" ? `${letterLabel(++index)}.` : format === "bullets" ? "-" : format === "note" ? "Note:" : "Check:";
    return `${marker} ${body}`;
  }).join("\n");
  const formatted = value.slice(0, from) + lines + value.slice(to);
  const result = format === "steps" ? renumberLetters(formatted) : formatted;
  return {value:result, selectionStart:format === "steps" ? renumberLetters(formatted.slice(0, from + lines.length)).length : from + lines.length};
}
export function applyInstructionBullets(value: string) { return formatInstruction(value, 0, value.length, "bullets").value; }

export function resolveBulletEnter(value: string, selectionStart: number, selectionEnd: number, softBreak = false) {
  const lineStart = selectionStart === 0 ? 0 : value.lastIndexOf("\n", selectionStart - 1) + 1;
  const breakAt = value.indexOf("\n", selectionStart);
  const lineEnd = breakAt < 0 ? value.length : breakAt;
  const line = value.slice(lineStart, lineEnd);
  let match = line.match(instructionListPattern);
  // Indented lines created by Shift+Enter belong to the preceding item.
  if (!match && /^[ \t]+/.test(line)) {
    const preceding = value.slice(0, Math.max(0, lineStart - 1)).split("\n");
    for (let i = preceding.length - 1; i >= 0; i--) {
      match = preceding[i].match(instructionListPattern);
      if (match || !/^[ \t]+/.test(preceding[i])) break;
    }
  }
  if (!match) return null;
  if (selectionStart === lineStart && line.match(instructionListPattern)) {
    return {value:value.slice(0, selectionStart) + "\n" + value.slice(selectionEnd), selectionStart:selectionStart + 1};
  }
  if (!softBreak && line.match(instructionListPattern) && !match[3].trim()) {
    return {value:value.slice(0,lineStart) + value.slice(lineEnd), selectionStart:lineStart};
  }
  const prefix = softBreak ? `${match[1]}  ` : `${match[1]}${nextMarker(match[2])} `;
  const insert = `\n${prefix}`;
  const raw = value.slice(0,selectionStart) + insert + value.slice(selectionEnd);
  return {value:softBreak ? raw : renumberLetters(raw), selectionStart:selectionStart + insert.length};
}

export type InstructionBlock = {kind:"text"|"list"|"note"|"check"; marker?:string; body:string; raw:string};
export function instructionBlocks(text: string): InstructionBlock[] {
  const blocks: InstructionBlock[] = [];
  for (const line of text.split("\n")) {
    const list = line.match(instructionListPattern);
    const note = line.match(/^[ \t]*(Note|Check):[ \t]*(.*)$/i);
    if (list) blocks.push({kind:"list",marker:list[2],body:list[3],raw:line});
    else if (note) blocks.push({kind:note[1].toLowerCase() as "note"|"check",marker:`${note[1].toLowerCase() === "note" ? "Note" : "Check"}:`,body:note[2],raw:line});
    else if (/^[ \t]+\S/.test(line) && blocks.at(-1)?.kind !== "text" && blocks.length) {
      const previous = blocks[blocks.length - 1];
      previous.body += `\n${line.trimStart()}`;
      previous.raw += `\n${line}`;
    } else blocks.push({kind:"text",body:line,raw:line});
  }
  return blocks;
}
