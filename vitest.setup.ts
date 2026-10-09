import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library auto-cleanup registers itself only when test globals are enabled;
// this repo keeps globals off, so unmount rendered trees between tests explicitly.
afterEach(() => {
  cleanup();
});

// jsdom has no top layer. Model open/close for component contracts; real browser
// checks verify focus containment and background inertness (these stubs do not).
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function () { this.open = false; };
}
