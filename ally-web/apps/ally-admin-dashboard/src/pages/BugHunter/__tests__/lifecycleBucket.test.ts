import { describe, expect, it } from "vitest";

import { BugFinding, BugFindingStatus } from "@types";

import {
  bucketOf,
  bucketOfStatus,
  countByBucket,
  defaultBucket,
  emptyBucketCounts,
  LIFECYCLE_BUCKETS,
  parseBucket,
  statusesInBucket,
} from "../lifecycleBucket";

const finding = (status: BugFindingStatus, id: string, createdAt = "2026-08-17"): BugFinding =>
  ({ id, status, createdAt, title: id, repo: null }) as unknown as BugFinding;

describe("bucketOf", () => {
  it("puts a plan parked on a person under Needs you, and a working plan under In progress", () => {
    const parked = {
      ...finding(BugFindingStatus.COORDINATING, "plan"),
      attention: { kind: "merge", stepId: "s", stepIndex: 1, repo: "ally-ai", prUrl: "u" },
    } as BugFinding;
    expect(bucketOf(parked)).toBe("needs_you");
    expect(bucketOf(finding(BugFindingStatus.COORDINATING, "plan"))).toBe("in_progress");
  });
});

describe("bucketOfStatus", () => {
  /**
   * The property the tab counts rest on. If a status fell through to no tab
   * the counts would silently sum to less than the list.
   */
  it("classifies every status, with no status in two tabs", () => {
    const statuses = Object.values(BugFindingStatus);
    const claimed = LIFECYCLE_BUCKETS.flatMap(statusesInBucket);

    expect(claimed).toHaveLength(statuses.length);
    expect(new Set(claimed).size).toBe(statuses.length);
    statuses.forEach(status => expect(LIFECYCLE_BUCKETS).toContain(bucketOfStatus(status)));
  });

  it("puts the five tabs in the order a reader asks them", () => {
    expect(LIFECYCLE_BUCKETS).toEqual(["needs_you", "failed", "in_progress", "backlog", "done"]);
  });

  it("puts the two statuses that stop dead on a human decision under Needs you, and nothing else", () => {
    expect(statusesInBucket("needs_you").sort()).toEqual(
      [BugFindingStatus.PENDING_APPROVAL, BugFindingStatus.NEEDS_INPUT].sort(),
    );
  });

  it("groups each tab as specified", () => {
    expect(statusesInBucket("failed").sort()).toEqual(
      [BugFindingStatus.FAILED, BugFindingStatus.RELEASE_FAILED].sort(),
    );
    expect(statusesInBucket("in_progress").sort()).toEqual(
      [
        BugFindingStatus.QUEUED,
        BugFindingStatus.FIXING,
        BugFindingStatus.COORDINATING,
        BugFindingStatus.RELEASING,
        BugFindingStatus.PR_OPENED,
      ].sort(),
    );
    expect(statusesInBucket("backlog").sort()).toEqual(
      [BugFindingStatus.NEW, BugFindingStatus.APPROVED, BugFindingStatus.BLOCKED].sort(),
    );
    expect(statusesInBucket("done").sort()).toEqual(
      [
        BugFindingStatus.MERGED,
        BugFindingStatus.RELEASED,
        BugFindingStatus.DISMISSED,
        BugFindingStatus.REJECTED,
        BugFindingStatus.CANCELLED,
      ].sort(),
    );
  });

  // BLOCKED reads like a bug waiting on a person and is not: it waits on an
  // earlier repo in its own multi-repo plan, which is Bug Hunter's problem.
  it("does not treat BLOCKED as waiting on a human", () => {
    expect(bucketOfStatus(BugFindingStatus.BLOCKED)).toBe("backlog");
  });

  // A human stopped it on purpose, so it is not a red job to chase.
  it("treats a cancelled session as done rather than failed", () => {
    expect(bucketOfStatus(BugFindingStatus.CANCELLED)).toBe("done");
    expect(bucketOfStatus(BugFindingStatus.FAILED)).toBe("failed");
  });

  // Only six of eighty-eight merged fixes on prod were releasable, and the list
  // payload can't tell which — so a merge is history, not a question for you.
  it("files a merged fix under Done, not Needs you", () => {
    expect(bucketOfStatus(BugFindingStatus.MERGED)).toBe("done");
  });
});

describe("parseBucket", () => {
  it("reads the current tab names", () => {
    LIFECYCLE_BUCKETS.forEach(bucket => expect(parseBucket(bucket)).toBe(bucket));
  });

  // Links pasted into chat before the tabs still land on what they meant.
  it("maps the old chip values onto the tab each now lives under", () => {
    expect(parseBucket("problem")).toBe("failed");
    expect(parseBucket("queued")).toBe("backlog");
    expect(parseBucket("in_flight")).toBe("in_progress");
    expect(parseBucket("in_review")).toBe("in_progress");
    expect(parseBucket("shipped")).toBe("done");
    expect(parseBucket("closed")).toBe("done");
  });

  it("treats anything else as no tab at all, rather than as an error", () => {
    expect(parseBucket(null)).toBeNull();
    expect(parseBucket("")).toBeNull();
    expect(parseBucket("all")).toBeNull();
    expect(parseBucket("nonsense")).toBeNull();
  });
});

describe("countByBucket", () => {
  it("sums to the number of findings", () => {
    const findings = [
      finding(BugFindingStatus.PENDING_APPROVAL, "a"),
      finding(BugFindingStatus.NEEDS_INPUT, "b"),
      finding(BugFindingStatus.FAILED, "c"),
      finding(BugFindingStatus.FIXING, "d"),
      finding(BugFindingStatus.MERGED, "e"),
      finding(BugFindingStatus.RELEASED, "f"),
      finding(BugFindingStatus.DISMISSED, "g"),
    ];

    const counts = countByBucket(findings);
    const total = LIFECYCLE_BUCKETS.reduce((sum, bucket) => sum + counts[bucket], 0);

    expect(total).toBe(findings.length);
    expect(counts).toEqual({ needs_you: 2, failed: 1, in_progress: 1, backlog: 0, done: 3 });
  });

  it("reports zeroes rather than omitting empty tabs, so the strip never reflows", () => {
    const counts = countByBucket([]);
    LIFECYCLE_BUCKETS.forEach(bucket => expect(counts[bucket]).toBe(0));
  });
});

describe("defaultBucket", () => {
  const counts = (patch: Partial<Record<string, number>>) => ({ ...emptyBucketCounts(), ...patch });

  it("opens on Needs you when it has anything in it", () => {
    expect(defaultBucket(counts({ needs_you: 1, in_progress: 4, done: 400 }))).toBe("needs_you");
  });

  it("opens on In progress otherwise — even when In progress is empty", () => {
    expect(defaultBucket(counts({ in_progress: 3, done: 400 }))).toBe("in_progress");
    expect(defaultBucket(counts({ backlog: 50, done: 400 }))).toBe("in_progress");
  });

  // On prod "everything" was 456 closed rows around 44 open ones.
  it("never opens on Done just because Done is the biggest", () => {
    expect(defaultBucket(counts({ done: 900 }))).not.toBe("done");
  });

  // A sweep scope asks for one sweep's bugs, which usually sit in Backlog or
  // Done; an empty In progress beside "10 found" reads as a broken link.
  it("opens a sweep scope on its first non-empty tab", () => {
    expect(defaultBucket(counts({ backlog: 7, done: 3 }), { scoped: true })).toBe("backlog");
    expect(defaultBucket(counts({ needs_you: 1, backlog: 7 }), { scoped: true })).toBe("needs_you");
    expect(defaultBucket(counts({}), { scoped: true })).toBe("needs_you");
  });
});
