import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, any>();
vi.mock("../segmentStore", () => ({
  segmentStore: {
    put: vi.fn(async (s: any) => void stored.set(s.id, s)),
    remove: vi.fn(
      async (chatId: number, index: number) => void stored.delete(`${chatId}:${index}`),
    ),
    get: vi.fn(async (chatId: number, index: number) => stored.get(`${chatId}:${index}`)),
    all: vi.fn(async () => [...stored.values()]),
  },
}));

import { SegmentUploader } from "../SegmentUploader";

const blob = () => new Blob(["audio"], { type: "audio/webm" });

describe("SegmentUploader", () => {
  let api: { getUploadUrl: any; finalize: any };
  beforeEach(() => {
    vi.useFakeTimers();
    stored.clear();
    api = {
      getUploadUrl: vi.fn(async (_c: number, i: number) => ({ url: `https://s3/${i}` })),
      finalize: vi.fn(async () => ({ status: "finalized", missing: [] })),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uploads each segment to its presigned URL and forgets it once S3 has it", async () => {
    const up = new SegmentUploader(7, api);
    up.enqueue(0, blob(), "audio/webm");
    up.enqueue(1, blob(), "audio/webm");
    await vi.runAllTimersAsync();
    await up.finish(2, 60);
    expect((fetch as any).mock.calls.map((c: any[]) => c[0])).toEqual([
      "https://s3/0",
      "https://s3/1",
    ]);
    expect(api.finalize).toHaveBeenCalledWith({ chatId: 7, segmentCount: 2, durationSeconds: 60 });
    expect(stored.size).toBe(0);
  });

  it("retries a failed upload with backoff and keeps it until it lands", async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true });
    const up = new SegmentUploader(7, api);
    up.enqueue(0, blob(), "audio/webm");
    expect(stored.has("7:0")).toBe(true);
    await vi.runAllTimersAsync();
    expect((fetch as any).mock.calls).toHaveLength(2);
    expect(stored.has("7:0")).toBe(false);
  });

  it("re-sends the segments the server reports missing, then finalizes", async () => {
    const up = new SegmentUploader(7, api);
    stored.set("7:1", { id: "7:1", chatId: 7, index: 1, blob: blob(), contentType: "audio/webm" });
    api.finalize
      .mockRejectedValueOnce({ data: { missing: [1] } })
      .mockResolvedValueOnce({ status: "finalized", missing: [] });
    const done = up.finish(2, 60);
    await vi.runAllTimersAsync();
    await expect(done).resolves.toEqual({ missing: [] });
    expect((fetch as any).mock.calls.map((c: any[]) => c[0])).toEqual(["https://s3/1"]);
  });

  it("finishes with what arrived, flagged partial, when segments never come", async () => {
    const up = new SegmentUploader(7, api);
    api.finalize.mockImplementation(async (args: any) => {
      if (args.allowPartial) return { status: "finalized", missing: [3] };
      throw { data: { missing: [3] } };
    });
    const done = up.finish(4, 120);
    await vi.runAllTimersAsync();
    await expect(done).resolves.toEqual({ missing: [3] });
    expect(api.finalize).toHaveBeenLastCalledWith(expect.objectContaining({ allowPartial: true }));
  });
});
