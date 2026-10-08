// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NavSelectionTrack, NavSelectionProvider } from "./nav-selection-track";

const animate = vi.fn< (frames: Keyframe[], options: KeyframeAnimationOptions) => { playState: string; cancel: ReturnType<typeof vi.fn> } >(() => ({ playState: "finished", cancel: vi.fn() }));
let reducedMotion = false;
beforeEach(() => {
  reducedMotion = false;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: Number(this.dataset.top ?? 0), left: 0, width: 184, height: Number(this.dataset.height ?? 32), bottom: 0, right: 184, x: 0, y: 0, toJSON() {} };
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); animate.mockClear(); delete (HTMLElement.prototype as Partial<HTMLElement>).animate; });

function Navigation({ active, page = "sop" }: { active: "all" | "review" | "wi"; page?: string }) {
  return <NavSelectionProvider><NavSelectionTrack persistenceKey="quality" key={page}>
    <div className="ui-nav-section">SOPs</div>
    <a className={active === "all" ? "ui-nav-item-active" : ""} data-top="34">All SOPs</a>
    <a className={active === "review" ? "ui-nav-item-active" : ""} data-top="68">Review queue</a>
    <div className="ui-nav-section">Work Instructions</div>
    <a className={active === "wi" ? "ui-nav-item-active" : ""} data-top="260" data-height="40">WI Builder</a>
  </NavSelectionTrack></NavSelectionProvider>;
}

it("uses the same bounce across groups, measuring actual item positions and heights", async () => {
  const view = render(<Navigation active="all" />);
  expect(animate).not.toHaveBeenCalled();
  view.rerender(<Navigation active="review" />);
  await waitFor(() => expect(animate).toHaveBeenCalledTimes(1));
  view.rerender(<Navigation active="wi" />);
  await waitFor(() => expect(animate).toHaveBeenCalledTimes(2));
  expect(animate.mock.calls[0][1]).toEqual(animate.mock.calls[1][1]);
  expect(animate.mock.calls[1]).toEqual([
    [{ transform: "translate(0px, 68px)", width: "184px", height: "32px" }, { transform: "translate(0px, 260px)", width: "184px", height: "40px" }],
    { duration: 280, easing: "cubic-bezier(0.34, 1.45, 0.64, 1)" },
  ]);
});

it("retains the previous position when the route remounts its sidebar", () => {
  const view = render(<Navigation active="review" />);
  view.rerender(<Navigation active="wi" page="wi" />);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(animate.mock.calls[0][0][0]).toMatchObject({ transform: "translate(0px, 68px)" });
});

it("keeps selection visible without animation when reduced motion is requested", async () => {
  reducedMotion = true;
  const view = render(<Navigation active="all" />);
  view.rerender(<Navigation active="wi" />);
  await waitFor(() => expect(screen.getByText("WI Builder").parentElement?.querySelector<HTMLElement>(".ui-nav-selection-indicator")?.style.transform).toBe("translate(0px, 260px)"));
  expect(animate).not.toHaveBeenCalled();
});


it("uses one indicator for nested groups and hides it for collapsed selections", async () => {
  const view = render(<NavSelectionTrack><NavSelectionTrack className="nested">
    <a className="ui-nav-item-active" data-top="80">Product</a>
  </NavSelectionTrack></NavSelectionTrack>);
  expect(view.container.querySelectorAll(".ui-nav-selection-indicator")).toHaveLength(1);
  view.rerender(<NavSelectionTrack><div inert><NavSelectionTrack className="nested">
    <a className="ui-nav-item-active" data-top="80">Product</a>
  </NavSelectionTrack></div></NavSelectionTrack>);
  await waitFor(() => expect(view.container.querySelector<HTMLElement>(".ui-nav-selection-indicator")?.hidden).toBe(true));
});

it("keeps independent panels' saved selector positions separate", () => {
  const view = render(<NavSelectionProvider><NavSelectionTrack key="planning" persistenceKey="planning">
    <a className="ui-nav-item-active" data-top="80">Work orders</a>
  </NavSelectionTrack></NavSelectionProvider>);
  view.rerender(<NavSelectionProvider><NavSelectionTrack key="settings" persistenceKey="settings">
    <a className="ui-nav-item-active" data-top="32">Account</a>
  </NavSelectionTrack></NavSelectionProvider>);
  expect(animate).not.toHaveBeenCalled();
});
