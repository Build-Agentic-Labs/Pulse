import { describe, expect, it } from "vitest";
import { mergeAnnotationDocuments } from "./photo-annotation-drafts";
import type { PhotoAnnotationDocument } from "@/domain/photo-annotations";
const arrow = {id:"a",type:"arrow" as const,color:"red",strokeWidth:3,x1:0,y1:0,x2:1,y2:1};
const doc = (items: PhotoAnnotationDocument["items"]): PhotoAnnotationDocument => ({version:2,items});
describe("annotation rebasing", () => {
 it("accepts remote edits when local marks are untouched", () => {
  expect(mergeAnnotationDocuments(doc([arrow]),doc([arrow]),doc([])).items).toEqual([]);
 });
 it("keeps edited and deleted local marks while accepting unrelated remote additions", () => {
  const second={...arrow,id:"b"}; const remote={...arrow,id:"c"};
  expect(mergeAnnotationDocuments(doc([arrow,second]),doc([{...arrow,color:"blue"}]),doc([arrow,second,remote])).items)
   .toEqual([{...arrow,color:"blue"},remote]);
 });
});
