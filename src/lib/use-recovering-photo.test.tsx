import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRecoveringPhoto, photoUrlNeedsRefresh } from "./use-recovering-photo";
const { refresh } = vi.hoisted(() => ({refresh:vi.fn()}));
vi.mock("@/domain/supabase-planner", () => ({refreshSignedMediaUrl:refresh}));
afterEach(()=> {vi.clearAllMocks();});
describe("photo URL recovery",()=>{
 it("recognizes expiring signed URLs",()=>{
  const token = `x.${btoa(JSON.stringify({exp:100}))}.x`;
  expect(photoUrlNeedsRefresh(`https://example.test/a?token=${token}`,100_000)).toBe(true);
  expect(photoUrlNeedsRefresh("data:image/png;base64,abc")).toBe(false);
 });
 it("recovers errors again after reconnect and exposes a manual retry after failure",async()=>{
  refresh.mockResolvedValueOnce("https://example.test/fresh").mockResolvedValueOnce(undefined).mockResolvedValueOnce("https://example.test/retry");
  const {result}=renderHook(()=>useRecoveringPhoto("https://example.test/old","photo/path"));
  act(()=>result.current.onError());
  await waitFor(()=>expect(result.current.source).toContain("fresh"));
  act(()=>result.current.onError());
  expect(result.current.failed).toBe(true);
  act(()=>window.dispatchEvent(new Event("online")));
  await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(result.current.failed).toBe(true));
  await act(async()=>{await result.current.retry();});
  expect(result.current.failed).toBe(false);expect(result.current.source).toContain("retry");
 });
 it("ignores a late refresh belonging to the previous photo",async()=>{
  let finish!:(url:string)=>void;
  refresh.mockImplementationOnce(()=>new Promise<string>(resolve=>{finish=resolve;}));
  const {result,rerender}=renderHook(({url,path})=>useRecoveringPhoto(url,path),{initialProps:{url:"https://example.test/one",path:"one"}});
  act(()=>result.current.onError());
  rerender({url:"https://example.test/two",path:"two"});
  await act(async()=>finish("https://example.test/one-fresh"));
  expect(result.current.source).toBe("https://example.test/two");
 });
 it("refreshes expired links without waiting for an image error",async()=>{
  refresh.mockResolvedValueOnce("https://example.test/current");
  const token=`x.${btoa(JSON.stringify({exp:1}))}.x`;
  const {result}=renderHook(()=>useRecoveringPhoto(`https://example.test/a?token=${token}`,"expired"));
  await waitFor(()=>expect(result.current.source).toBe("https://example.test/current"));
 });
});
