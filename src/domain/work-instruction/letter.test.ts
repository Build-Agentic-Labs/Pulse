import { describe, expect, it } from "vitest";
import { letterCards } from "./letter";
import { sampleWorkInstruction } from "./sample";
import { paginateWorkInstruction } from "./paginate";
import { releasedPrintLayout, WORK_INSTRUCTION_LAYOUTS } from "./schema";
import { fingerprintWorkInstruction, snapshotForRelease } from "./release";

describe("Letter print layout", () => {
  it("uses two steps on page one and three on continuations", () => {
    const doc = sampleWorkInstruction();
    expect(paginateWorkInstruction({...doc, cards:doc.cards.slice(0,8)}, WORK_INSTRUCTION_LAYOUTS.letter).map(p=>p.cards.length)).toEqual([2,3,3]);
  });
  it("preserves legacy releases and records letter on new snapshots without altering the hash", () => {
    const doc = sampleWorkInstruction();
    expect(releasedPrintLayout(doc).id).toBe("v2");
    const snapshot = snapshotForRelease(doc);
    expect(releasedPrintLayout(snapshot).id).toBe("letter");
    expect(fingerprintWorkInstruction(snapshot)).toBe(fingerprintWorkInstruction(doc));
  });
  it("continues long instructions without losing words or duplicating tools and checks", () => {
    const original={...sampleWorkInstruction().cards[0], instruction:Array.from({length:100},(_,i)=>`word${i}`).join(" "), checks:[{key:"torque",label:"Torque",spec:"45 Nm"}]};
    const cards=letterCards([original]);
    expect(cards.length).toBeGreaterThan(1);
    expect(cards.map(c=>c.instruction).join(" ")).toBe(original.instruction);
    expect(cards.flatMap(c=>c.tools)).toEqual(original.tools);
    expect(cards.flatMap(c=>c.checks)).toEqual(original.checks);
    expect(cards.at(-1)?.part).toBe(cards.length);
  });
});
