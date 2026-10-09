import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { AnnexesEditor } from "./annexes-editor";
import type { SopAnnexFile } from "@/lib/sop/annex-files";

const file: SopAnnexFile = {
  id: "file-a",
  workspaceId: "local",
  sopId: "sop-a",
  annexId: "annex-a",
  storagePath: "local/form.pdf",
  originalName: "Form.pdf",
  contentType: "application/pdf",
  sizeBytes: 10,
  uploadedBy: "author",
  createdAt: "",
  updatedAt: "",
};
function props(
  overrides: Partial<ComponentProps<typeof AnnexesEditor>> = {},
): ComponentProps<typeof AnnexesEditor> {
  return {
    sopId: "sop-a",
    rows: [{ id: "annex-a", label: "Form", description: "Original" }],
    files: [file],
    uploadingAnnexId: null,
    uploadStatus: null,
    onChange: vi.fn(),
    onUpload: vi.fn(),
    onOpen: vi.fn(),
    onRename: vi.fn().mockResolvedValue(undefined),
    onRemoveFile: vi.fn(),
    onRemoveRow: vi.fn(),
    ...overrides,
  };
}
describe("Annex editor interaction contracts", () => {
  it("applies edits to the latest rows without overwriting a concurrent description change", () => {
    const onChange = vi.fn();
    render(<AnnexesEditor {...props({ onChange })} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Form name" }), {
      target: { value: "Updated" },
    });
    const update = onChange.mock.calls[0][0];
    expect(
      update([
        { id: "annex-a", label: "Form", description: "Concurrent change" },
      ]),
    ).toEqual([
      { id: "annex-a", label: "Updated", description: "Concurrent change" },
    ]);
  });
  it("retains failed rename input and allows retry", async () => {
    const onRename = vi
      .fn()
      .mockRejectedValueOnce(new Error("Try again"))
      .mockResolvedValueOnce(undefined);
    render(<AnnexesEditor {...props({ onRename })} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Form.pdf" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Attachment name" }), {
      target: { value: " Revised.pdf " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save attachment name" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    expect(
      screen.getByRole("textbox", { name: "Attachment name" }),
    ).toHaveValue(" Revised.pdf ");
    fireEvent.click(
      screen.getByRole("button", { name: "Save attachment name" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Attachment name" }),
      ).not.toBeInTheDocument(),
    );
    expect(onRename).toHaveBeenNthCalledWith(2, file, "Revised.pdf");
  });
  it("keeps attachments readable while disabling authoring controls", () => {
    const onOpen = vi.fn();
    render(<AnnexesEditor {...props({ disabled: true, onOpen })} />);
    expect(screen.getByRole("textbox", { name: "Form name" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Add form" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove attachment" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Form.pdf" }));
    expect(onOpen).toHaveBeenCalledWith(file);
  });
});
