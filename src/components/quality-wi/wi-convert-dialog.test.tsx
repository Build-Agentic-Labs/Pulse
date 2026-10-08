import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WiConvertDialog from "./wi-convert-dialog";
import { wiConversionRequest } from "@/lib/quality-wi/conversion-client";
import { uploadConversionSource } from "@/lib/sop/conversion-upload";
import {
  buildWiConversion,
  type ConversionReview,
} from "@/domain/quality-wi/conversion";
import { evidence, result } from "@/domain/quality-wi/conversion-fixture";
vi.mock("@/lib/quality-wi/conversion-client", () => ({
  wiConversionRequest: vi.fn(),
}));
vi.mock("@/lib/sop/conversion-upload", () => ({
  uploadConversionSource: vi.fn(),
  removeConversionSource: vi.fn(),
}));
const props = {
  workspaceId: "w",
  userId: "u",
  departmentId: "d",
  departmentName: "Manufacturing",
  onClose: vi.fn(),
  onImported: vi.fn(),
};
const payload = buildWiConversion(
  result,
  evidence,
  {
    id: "job",
    workspaceId: "w",
    fileName: "Original.docx",
    model: "test",
    now: "today",
  },
  () => crypto.randomUUID(),
);
const ready: ConversionReview = {
  id: "job",
  status: "ready",
  departmentId: "d",
  fileName: "Original.docx",
  payload,
};
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function () {
      this.setAttribute("open", "");
    },
  });
  vi.mocked(uploadConversionSource).mockResolvedValue("users/u/w/f.docx");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function start() {
  render(<WiConvertDialog {...props} />);
  fireEvent.change(screen.getByLabelText("Source work instruction"), {
    target: { files: [new File(["docx"], "Original.docx")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Convert DOCX" }));
}
it("rejects invalid files before upload", async () => {
  render(<WiConvertDialog {...props} />);
  fireEvent.change(screen.getByLabelText("Source work instruction"), {
    target: { files: [new File(["pdf"], "other.pdf")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Convert DOCX" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a DOCX");
  expect(uploadConversionSource).not.toHaveBeenCalled();
});
it("reviews exact source names and creates a new draft only on explicit import", async () => {
  vi.mocked(wiConversionRequest)
    .mockResolvedValueOnce(ready)
    .mockResolvedValueOnce({ id: "job" });
  await start();
  await screen.findByText("Proposed steps");
  expect(screen.getByText("Jaylynn Johnson")).toBeTruthy();
  expect(screen.getByText("FIP-00001")).toBeTruthy();
  expect(props.onImported).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
  await waitFor(() => expect(props.onImported).toHaveBeenCalledWith("job"));
});
it("retries the same import after a lost response without running AI again", async () => {
  vi.mocked(wiConversionRequest)
    .mockResolvedValueOnce(ready)
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce({ id: "job" });
  await start();
  await screen.findByText("Proposed steps");
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Delivery Photos WI" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
  await screen.findByText("Response lost");
  fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
  await waitFor(() => expect(props.onImported).toHaveBeenCalledWith("job"));
  const calls = vi
    .mocked(wiConversionRequest)
    .mock.calls.filter((c) => c[1].endsWith("/import"));
  expect(calls).toHaveLength(2);
  expect(calls[0][2]).toEqual(calls[1][2]);
  expect(calls[0][2]).toMatchObject({ id: "job", title: "Delivery Photos WI" });
  expect(uploadConversionSource).toHaveBeenCalledTimes(1);
});
it("does not navigate or update after the account scope unmounts", async () => {
  let resolve!: (r: ConversionReview) => void;
  vi.mocked(wiConversionRequest).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r as typeof resolve;
      }),
  );
  await start();
  await waitFor(() => expect(wiConversionRequest).toHaveBeenCalled());
  cleanup();
  await act(async () => resolve({ ...ready, status: "imported" }));
  expect(props.onImported).not.toHaveBeenCalled();
});
it("opens a saved table conversion without another upload", async () => {
  vi.mocked(wiConversionRequest).mockResolvedValue(ready);
  vi.useFakeTimers();
  render(<WiConvertDialog {...props} conversionId="job" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(screen.getByText("Proposed steps")).toBeTruthy();
  expect(uploadConversionSource).not.toHaveBeenCalled();
  expect(wiConversionRequest).toHaveBeenCalledWith(
    "u",
    "/api/quality-wi/convert?id=job",
    undefined,
    expect.any(AbortSignal),
  );
});

it("hands off the running conversion without waiting for AI or opening a draft", async () => {
  const started = vi.fn();
  vi.mocked(wiConversionRequest).mockImplementation(() => new Promise(() => {}));
  render(<WiConvertDialog {...props} onStarted={started} />);
  fireEvent.change(screen.getByLabelText("Source work instruction"), { target: { files: [new File(["docx"], "Original.docx")] } });
  fireEvent.click(screen.getByRole("button", { name: "Convert DOCX" }));
  await waitFor(() => expect(started).toHaveBeenCalledWith(expect.objectContaining({ status: "processing", fileName: "Original.docx", departmentId: "d" })));
  expect(props.onImported).not.toHaveBeenCalled();
});
