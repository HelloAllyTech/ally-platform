import { describe, expect, it } from "vitest";

import { createBucketSortTemplate, serializeBucketSort, validateBucketSort } from "./bucketSort";

const filled = () => {
  const t = createBucketSortTemplate();
  t.buckets[0].label = "Helps";
  t.buckets[1].label = "Harms";
  t.items[0].text = "Reflect feelings";
  t.items[1].text = "Give advice fast";
  return t;
};

describe("bucketSort", () => {
  it("template is incomplete until the trainer fills it in", () => {
    expect(validateBucketSort(createBucketSortTemplate()).length).toBeGreaterThan(0);
    expect(validateBucketSort(filled())).toEqual([]);
  });

  it("flags duplicate bucket names and empty buckets", () => {
    const t = filled();
    t.buckets[1].label = " helps ";
    expect(validateBucketSort(t).join()).toContain("both called");
    const u = filled();
    u.items[1].bucketId = u.buckets[0].id;
    expect(validateBucketSort(u).join()).toContain("no item belongs");
  });

  it("serialises trimmed text and drops blank optionals", () => {
    const t = filled();
    t.items[0].explanation = "  ";
    t.buckets[0].description = " hint ";
    const out = serializeBucketSort(t);
    expect(out.intro).toBeUndefined();
    expect(out.items[0]).not.toHaveProperty("explanation");
    expect(out.buckets[0].description).toBe("hint");
  });
});
