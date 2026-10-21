import {
  MAX_BUCKET_SORT_BUCKETS,
  MAX_BUCKET_SORT_DESCRIPTION,
  MAX_BUCKET_SORT_EXPLANATION,
  MAX_BUCKET_SORT_ITEM_TEXT,
  MAX_BUCKET_SORT_ITEMS,
  MAX_BUCKET_SORT_LABEL,
  MIN_BUCKET_SORT_BUCKETS,
  MIN_BUCKET_SORT_ITEMS,
} from "@constants";
import { BucketSortContent } from "@types";

/*
 * Pure helpers for the Bucket sort editor. The rules mirror ally-be's
 * `validateBucketSortContent`; the server stays authoritative, these just let
 * a trainer see a problem before they hit save.
 */

const newId = () => crypto.randomUUID();

/** Two empty buckets and two empty items, each item pre-assigned to a different bucket. */
export const createBucketSortTemplate = (): BucketSortContent => {
  const buckets = [
    { id: newId(), label: "", description: "" },
    { id: newId(), label: "", description: "" },
  ];
  return {
    intro: "",
    buckets,
    items: buckets.map(bucket => ({
      id: newId(),
      text: "",
      bucketId: bucket.id,
      explanation: "",
    })),
  };
};

export const validateBucketSort = (content: BucketSortContent | undefined): string[] => {
  if (!content) return ["add buckets and items"];
  const problems: string[] = [];
  const { buckets, items } = content;

  if (buckets.length < MIN_BUCKET_SORT_BUCKETS || buckets.length > MAX_BUCKET_SORT_BUCKETS) {
    problems.push(
      `needs between ${MIN_BUCKET_SORT_BUCKETS} and ${MAX_BUCKET_SORT_BUCKETS} buckets`,
    );
  }
  if (items.length < MIN_BUCKET_SORT_ITEMS || items.length > MAX_BUCKET_SORT_ITEMS) {
    problems.push(`needs between ${MIN_BUCKET_SORT_ITEMS} and ${MAX_BUCKET_SORT_ITEMS} items`);
  }

  const names = new Set<string>();
  buckets.forEach((bucket, index) => {
    const name = bucket.label.trim();
    if (!name) {
      problems.push(`bucket ${index + 1} needs a name`);
      return;
    }
    if (name.length > MAX_BUCKET_SORT_LABEL) {
      problems.push(`bucket "${name}" name is too long (max ${MAX_BUCKET_SORT_LABEL})`);
    }
    if (names.has(name.toLowerCase())) problems.push(`two buckets are both called "${name}"`);
    names.add(name.toLowerCase());
    if ((bucket.description ?? "").length > MAX_BUCKET_SORT_DESCRIPTION) {
      problems.push(`bucket "${name}" hint is too long (max ${MAX_BUCKET_SORT_DESCRIPTION})`);
    }
  });

  const bucketIds = new Set(buckets.map(b => b.id));
  items.forEach((item, index) => {
    const text = item.text.trim();
    if (!text) {
      problems.push(`item ${index + 1} needs some text`);
      return;
    }
    if (text.length > MAX_BUCKET_SORT_ITEM_TEXT) {
      problems.push(`item ${index + 1} is too long (max ${MAX_BUCKET_SORT_ITEM_TEXT})`);
    }
    if (!bucketIds.has(item.bucketId)) {
      problems.push(`item ${index + 1} needs a bucket to belong in`);
    }
    if ((item.explanation ?? "").length > MAX_BUCKET_SORT_EXPLANATION) {
      problems.push(
        `item ${index + 1} explanation is too long (max ${MAX_BUCKET_SORT_EXPLANATION})`,
      );
    }
  });

  for (const bucket of buckets) {
    if (bucket.label.trim() && !items.some(item => item.bucketId === bucket.id)) {
      problems.push(`no item belongs in "${bucket.label.trim()}"`);
    }
  }
  return problems;
};

/** Trim text and drop empty optional fields so the server never stores blanks. */
export const serializeBucketSort = (content: BucketSortContent): BucketSortContent => ({
  ...(content.intro?.trim() ? { intro: content.intro.trim() } : {}),
  buckets: content.buckets.map(bucket => ({
    id: bucket.id,
    label: bucket.label.trim(),
    ...(bucket.description?.trim() ? { description: bucket.description.trim() } : {}),
  })),
  items: content.items.map(item => ({
    id: item.id,
    text: item.text.trim(),
    bucketId: item.bucketId,
    ...(item.explanation?.trim() ? { explanation: item.explanation.trim() } : {}),
  })),
});
