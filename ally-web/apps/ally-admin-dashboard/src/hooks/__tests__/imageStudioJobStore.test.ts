import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeneratedImage } from "@types";

import {
  IMAGE_POLL_LOST_MESSAGE,
  IMAGE_TIMED_OUT_MESSAGE,
  imageJobStore,
} from "../imageStudioJobStore";

const image = (id: string, overrides: Partial<GeneratedImage> = {}): GeneratedImage => ({
  id,
  batchId: "b",
  slotKind: "scene",
  styleId: "watercolour",
  description: "d",
  altText: "",
  status: "queued",
  referenceIds: [],
  createdAt: "2026-11-09T00:00:00Z",
  ...overrides,
});

const waitUntil = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  expect(condition()).toBe(true);
};

describe("imageJobStore", () => {
  beforeEach(() => imageJobStore.resetForTests({ intervalMs: 1 }));
  afterEach(() => imageJobStore.resetForTests());

  it("polls every unsettled image across slots in one request, and stops once all are settled", async () => {
    imageJobStore.add("slot-a", [image("a1")]);
    imageJobStore.add("slot-b", [image("b1", { status: "running" })]);
    const poll = vi
      .fn()
      .mockResolvedValueOnce([image("a1", { status: "succeeded", imageUrl: "https://b/a1" })])
      .mockResolvedValueOnce([image("b1", { status: "failed", error: "Too busy" })]);

    imageJobStore.ensurePolling(poll);

    await waitUntil(() => imageJobStore.get("slot-b").images[0].status === "failed");
    expect(poll.mock.calls[0][0]).toEqual(["a1", "b1"]);
    expect(poll.mock.calls[1][0]).toEqual(["b1"]);
    expect(imageJobStore.get("slot-a").images[0].imageUrl).toBe("https://b/a1");
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("gives up on an image after the time cap", async () => {
    imageJobStore.resetForTests({ intervalMs: 1, maxWaitMs: 5 });
    imageJobStore.add("slot", [image("slow")]);
    const poll = vi.fn().mockResolvedValue([image("slow", { status: "running" })]);

    imageJobStore.ensurePolling(poll);

    await waitUntil(() => imageJobStore.get("slot").images[0].status === "failed");
    expect(imageJobStore.get("slot").images[0].error).toBe(IMAGE_TIMED_OUT_MESSAGE);
  });

  it("survives a few failed polls, and says so when it loses touch", async () => {
    imageJobStore.add("slot", [image("x")]);
    const poll = vi.fn().mockRejectedValue(new Error("network"));

    imageJobStore.ensurePolling(poll);

    await waitUntil(() => imageJobStore.get("slot").error === IMAGE_POLL_LOST_MESSAGE);
    expect(poll).toHaveBeenCalledTimes(5);
    // Resuming clears the notice and polls again.
    poll.mockResolvedValue([image("x", { status: "succeeded", imageUrl: "https://b/x" })]);
    imageJobStore.ensurePolling(poll);
    await waitUntil(() => imageJobStore.get("slot").images[0].status === "succeeded");
    expect(imageJobStore.get("slot").error).toBeUndefined();
  });

  it("clear and remove forget a slot's images", () => {
    imageJobStore.add("slot", [image("a"), image("b")]);
    imageJobStore.remove("slot", "a");
    expect(imageJobStore.get("slot").images.map(i => i.id)).toEqual(["b"]);
    imageJobStore.clear("slot");
    expect(imageJobStore.get("slot").images).toEqual([]);
  });
});
