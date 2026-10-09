// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BackupSettings } from "./backup-settings";
const running = { ready: false, problems: [], backups: [{ id: "test", state: "running", phase: "testing", updatedAt: "2026-10-09T12:00:00Z" }] };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("retains backup progress while hidden, stops polling and refreshes on return", async () => {
 vi.useFakeTimers();
 const fetcher = vi.fn().mockResolvedValue({ok: true, json: async () => running}); vi.stubGlobal("fetch", fetcher);
 const view = render(<BackupSettings {...{active:true}} />);
 await act(async () => {});
 expect(fetcher).toHaveBeenCalledTimes(1);
 await act(async () => { vi.advanceTimersByTime(3000); });
 expect(fetcher).toHaveBeenCalledTimes(2);
 view.rerender(<BackupSettings {...{active:false}} />);
 await act(async () => { vi.advanceTimersByTime(30000); });
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(screen.getByText("running · testing")).toBeInTheDocument();
 view.rerender(<BackupSettings {...{active:true}} />);
 await act(async () => {});
 expect(fetcher).toHaveBeenCalledTimes(3);
});
it("coalesces slow refreshes and skips reads while the document is hidden", async () => {
 vi.useFakeTimers();
 let finish!: (value: unknown) => void;
 const fetcher = vi.fn().mockResolvedValueOnce({ok: true,json:async()=>running}).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
 vi.stubGlobal("fetch",fetcher);
 render(<BackupSettings />); await act(async()=>{});
 await act(async()=>{vi.advanceTimersByTime(3000)});
 await act(async()=>{vi.advanceTimersByTime(9000)});
 expect(fetcher).toHaveBeenCalledTimes(2);
 await act(async()=>{finish({ok:true,json:async()=>running})});
 const visibility = vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
 await act(async()=>{vi.advanceTimersByTime(9000)});
 expect(fetcher).toHaveBeenCalledTimes(2);
 visibility.mockReturnValue("visible");
 await act(async()=>{document.dispatchEvent(new Event("visibilitychange"))});
 expect(fetcher).toHaveBeenCalledTimes(3);
 await act(async()=>{finish({ok:true,json:async()=>running})});
 visibility.mockRestore();
});

it("reads fresh status after creation even when an older read is pending", async () => {
 const idle = {ready:true,problems:[],backups:[]};
 let finish!: (value: unknown) => void;
 let reads = 0;
 const fetcher = vi.fn((_url: string, options?: RequestInit) => {
  if (options?.method === "POST") return Promise.resolve({ok:true,json:async()=>({})});
  reads++;
  if (reads === 2) return new Promise(resolve => {finish=resolve});
  return Promise.resolve({ok:true,json:async()=>reads === 1 ? idle : running});
 });
 vi.stubGlobal("fetch",fetcher);
 render(<BackupSettings />); await act(async()=>{});
 fireEvent.change(screen.getByLabelText("Backup password"),{target:{value:"local-test-password"}});
 fireEvent.change(screen.getByLabelText("Confirm password"),{target:{value:"local-test-password"}});
 await act(async()=>{document.dispatchEvent(new Event("visibilitychange"))});
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Create backup"}))});
 expect(reads).toBe(2);
 await act(async()=>{finish({ok:true,json:async()=>idle})});
 expect(reads).toBe(3);
 expect(screen.getByText("running · testing")).toBeInTheDocument();
});
