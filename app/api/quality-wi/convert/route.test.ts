import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { evidence, result } from "@/domain/quality-wi/conversion-fixture";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  parse: vi.fn(),
  analyze: vi.fn(),
  read: vi.fn(),
  list: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.auth,
  createApiRateLimiter: () => () => true,
}));
vi.mock("@/lib/quality-wi/conversion/parse-docx", () => ({
  parseWiDocx: mocks.parse,
}));
vi.mock("@/lib/quality-wi/conversion/analyze", () => ({
  analyzeWiDocx: mocks.analyze,
}));
vi.mock("@/lib/quality-wi/conversion/store", () => ({
  readWiConversion: mocks.read,
  listWiConversions: mocks.list,
}));
import { POST, GET } from "./route";
import { POST as importWi } from "./import/route";
const body = {
  id: "e7500000-0000-0000-0000-000000000001",
  workspaceId: "w",
  departmentId: "d",
  storagePath: "users/u/w/source.docx",
  fileName: "Original.docx",
};
const request = (b: unknown = body) =>
  new Request("http://localhost/api/quality-wi/convert", {
    method: "POST",
    body: JSON.stringify(b),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  mocks.auth.mockResolvedValue({
    userId: "u",
    failure: null,
    supabase: {
      rpc: mocks.rpc,
      storage: {
        from: () => ({
          download: mocks.download,
          upload: mocks.upload,
          remove: mocks.remove,
        }),
      },
    },
  });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.download.mockResolvedValue({ data: new Blob(["docx"]), error: null });
  mocks.parse.mockResolvedValue({
    evidence,
    images: new Map([["img1", Buffer.from("image")]]),
  });
  mocks.analyze.mockResolvedValue({ draft: result, model: "test" });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.read.mockResolvedValue({
    id: body.id,
    status: "ready",
    departmentId: "d",
  });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects unauthenticated requests before reading any data", async () => {
  mocks.auth.mockResolvedValue({
    failure: new Response(null, { status: 401 }),
  });
  expect((await POST(request())).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("rejects another user source before opening the source or calling AI", async () => {
  expect(
    (await POST(request({ ...body, storagePath: "users/other/w/source.docx" })))
      .status,
  ).toBe(400);
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.analyze).not.toHaveBeenCalled();
});
it("enforces department access before reading the file", async () => {
  mocks.rpc.mockResolvedValue({ error: { code: "42501", message: "Denied" } });
  expect((await POST(request())).status).toBe(403);
  expect(mocks.download).not.toHaveBeenCalled();
});
it("resumes an existing claim without another analysis or deleting an in-flight source", async () => {
  mocks.rpc.mockResolvedValue({ data: false, error: null });
  expect((await POST(request())).status).toBe(200);
  expect(mocks.analyze).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("reserves images, uploads all, and only then marks the job ready; never creates a WI on conversion", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(mocks.rpc.mock.calls.map((c) => c[0])).toEqual([
    "begin_quality_wi_conversion",
    "prepare_quality_wi_conversion",
    "finish_quality_wi_conversion",
  ]);
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.upload.mock.invocationCallOrder[0]).toBeGreaterThan(
    mocks.rpc.mock.invocationCallOrder[1],
  );
  expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.rpc.mock.invocationCallOrder[2],
  );
  expect(mocks.remove).toHaveBeenCalledWith([body.storagePath]);
});
it("records failure and never marks ready when an image upload fails", async () => {
  mocks.upload.mockResolvedValue({ error: { message: "broken" } });
  expect((await POST(request())).status).toBe(422);
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_quality_wi_conversion",
    expect.objectContaining({
      p_id: body.id,
      p_error: expect.stringContaining("No work instruction was created"),
    }),
  );
});
it("does not store output rejected by the independent audit", async () => {
  mocks.analyze.mockRejectedValue(new Error("Wrong image assignment"));
  expect((await POST(request())).status).toBe(422);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(
    mocks.rpc.mock.calls.some((c) => c[0] === "prepare_quality_wi_conversion"),
  ).toBe(false);
});
it("validates status ids before querying", async () => {
  expect(
    (
      await GET(
        new Request("http://localhost/api/quality-wi/convert?id=invalid"),
      )
    ).status,
  ).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("imports only stored steps, never caller supplied author, numbers or images", async () => {
  await importWi(
    request({
      id: body.id,
      title: "Title",
      purpose: "Scope",
      responsibilities: "Operator",
      createdBy: "spoof",
      documentNumber: "FIP-00001",
      steps: [{ image: { storagePath: "other" } }],
    }),
  );
  expect(mocks.rpc).toHaveBeenCalledWith("import_quality_wi_conversion", {
    p_id: body.id,
    p_title: "Title",
    p_purpose: "Scope",
    p_responsibilities: "Operator",
  });
});

it("lists only scoped job summaries without signing or reading the full conversion", async () => {
  mocks.list.mockResolvedValue([{ id: body.id, status: "processing" }]);
  const response = await GET(new Request("http://localhost/api/quality-wi/convert?workspaceId=w"));
  expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith("w", expect.anything());
  expect(mocks.read).not.toHaveBeenCalled();
});
