import { describe, expect, it } from "vitest";
import { letterCards, letterPageCounts } from "./letter";
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
  it("keeps long instructions together without losing words, tools or checks", () => {
    const original={...sampleWorkInstruction().cards[0], instruction:Array.from({length:100},(_,i)=>`word${i}`).join(" "), checks:[{key:"torque",label:"Torque",spec:"45 Nm"}]};
    const cards=letterCards([original]);
    expect(cards).toHaveLength(1);
    expect(cards.map(c=>c.instruction).join(" ")).toBe(original.instruction);
    expect(cards.flatMap(c=>c.tools)).toEqual(original.tools);
    expect(cards.flatMap(c=>c.checks)).toEqual(original.checks);
    expect(cards.at(-1)?.part).toBe(cards.length);
  });
});

 it("rejoins legacy parts into one step and retains their reference keys", () => {
   const original=sampleWorkInstruction().cards[0];
   const ref={marker:1,partNumber:"P-100",description:"Bracket",text:"bracket",quantity:1};
   const cards=letterCards([
     {...original,part:1,partCount:2,instruction:"First action.",checks:[],partReferences:[ref]},
     {...original,part:2,partCount:2,instruction:"Second action.",tools:[],photo:undefined,partReferences:[ref]},
   ]);
   expect(cards).toHaveLength(1);
   expect(cards[0].instruction).toBe("First action.\nSecond action.");
   expect(cards[0].partCount).toBe(1);
   expect(cards[0].partReferences).toEqual([ref]);
   expect(cards[0].photo).toEqual(original.photo);
 });

describe("measured Letter pagination", () => {
  it("does not let a tall first step force short later steps onto separate pages", () => {
    expect(letterPageCounts([500, 260, 280, 300], 550, 850)).toEqual([1, 3]);
  });
  it("fits two differently sized steps using their combined height", () => {
    expect(letterPageCounts([500, 300, 450, 350], 800, 850)).toEqual([2, 2]);
  });
  it("moves a whole step past a full setup page and retains oversized steps", () => {
    expect(letterPageCounts([900, 250, 250], 100, 850)).toEqual([0, 1, 2]);
  });
});
