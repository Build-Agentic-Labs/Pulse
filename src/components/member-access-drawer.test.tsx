import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemberAccessDrawer } from "./member-access-drawer";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("opens a labeled modal and keeps content mounted until the close animation ends", () => {
  vi.useFakeTimers();
  const show = vi.fn();
  HTMLDialogElement.prototype.showModal = show;
  HTMLDialogElement.prototype.close = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const close = vi.fn();
  render(<MemberAccessDrawer name="Test member" description="Member details" onClose={close}><button>Permission control</button></MemberAccessDrawer>);
  expect(show).toHaveBeenCalled();
  expect(screen.getByText("Test member")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close member access", hidden: true }));
  expect(close).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(180));
  expect(close).toHaveBeenCalledOnce();
});

it("closes on a backdrop click but keeps inside clicks open", () => {
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const close = vi.fn();
  render(<MemberAccessDrawer name="Test member" description="Details" onClose={close}><button>Permission control</button></MemberAccessDrawer>);
  const dialog = document.querySelector("dialog")!;
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({ left: 600, right: 1000, top: 0, bottom: 800 } as DOMRect);
  fireEvent.mouseDown(dialog, { clientX: 700, clientY: 400 });
  fireEvent.click(dialog, { clientX: 700, clientY: 400 });
  act(() => vi.advanceTimersByTime(180));
  expect(close).not.toHaveBeenCalled();
  fireEvent.mouseDown(dialog, { clientX: 200, clientY: 400 });
  fireEvent.click(dialog, { clientX: 200, clientY: 400 });
  expect(close).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(180));
  expect(close).toHaveBeenCalledOnce();
});
