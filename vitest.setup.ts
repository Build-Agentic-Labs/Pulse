import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library auto-cleanup registers itself only when test globals are enabled;
// this repo keeps globals off, so unmount rendered trees between tests explicitly.
afterEach(() => {
  cleanup();
});
