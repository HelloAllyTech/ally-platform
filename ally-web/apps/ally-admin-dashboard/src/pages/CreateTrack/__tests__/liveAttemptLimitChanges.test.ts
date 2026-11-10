import { describe, expect, it } from "vitest";

import { TrackItemType } from "@types";

import { getLiveAttemptLimitChanges } from "../trackFormUtils";

type Limits = Record<string, number | null | undefined>;

const savedQuiz = (id: string, maxAttempts: number | null | undefined) => ({
  id,
  type: TrackItemType.QUIZ,
  content: { settings: { passScore: 70, maxAttempts }, questions: [] },
});

const savedAnnotation = (id: string, maxAttempts: number | null | undefined) => ({
  id,
  type: TrackItemType.ANNOTATED_ARTIFACT,
  content: {
    kind: "TRANSCRIPT",
    units: [],
    labels: [],
    targets: [],
    settings: {
      passScore: 70,
      maxAttempts,
      falsePositivePenalty: 1,
      revealKey: "after_each_attempt",
    },
  },
});

const formQuiz = (serverId: string, maxAttempts: number | null | undefined) => ({
  serverId,
  type: TrackItemType.QUIZ,
  quiz: { settings: { passScore: 70, maxAttempts } },
});

const formAnnotation = (serverId: string, maxAttempts: number | null | undefined) => ({
  serverId,
  type: TrackItemType.ANNOTATED_ARTIFACT,
  annotation: { settings: { passScore: 70, maxAttempts, falsePositivePenalty: 1 } },
});

const saved = (quizzes: Limits, annotations: Limits = {}): any => ({
  sections: [
    {
      id: "s1",
      items: [
        ...Object.entries(quizzes).map(([id, limit]) => savedQuiz(id, limit)),
        ...Object.entries(annotations).map(([id, limit]) => savedAnnotation(id, limit)),
      ],
    },
  ],
});

const form = (quizzes: Limits, annotations: Limits = {}): any => ({
  sections: [
    {
      items: [
        ...Object.entries(quizzes).map(([id, limit]) => formQuiz(id, limit)),
        ...Object.entries(annotations).map(([id, limit]) => formAnnotation(id, limit)),
      ],
    },
  ],
});

describe("getLiveAttemptLimitChanges", () => {
  it("reports a raised quiz limit and a move to unlimited", () => {
    expect(getLiveAttemptLimitChanges(saved({ a: 3, b: 3 }), form({ a: 5, b: null }))).toEqual([
      { trackItemId: "a", itemType: TrackItemType.QUIZ, maxAttempts: 5 },
      { trackItemId: "b", itemType: TrackItemType.QUIZ, maxAttempts: null },
    ]);
  });

  it("reports a raised annotation limit with its own item type", () => {
    expect(
      getLiveAttemptLimitChanges(saved({}, { x: 2, y: 2 }), form({}, { x: 4, y: null })),
    ).toEqual([
      { trackItemId: "x", itemType: TrackItemType.ANNOTATED_ARTIFACT, maxAttempts: 4 },
      { trackItemId: "y", itemType: TrackItemType.ANNOTATED_ARTIFACT, maxAttempts: null },
    ]);
  });

  it("ignores unchanged, lowered and already-unlimited items of both kinds", () => {
    expect(
      getLiveAttemptLimitChanges(
        saved({ a: 3, b: 3, c: null }, { x: 2, y: 2, z: null }),
        form({ a: 3, b: 2, c: 9 }, { x: 2, y: 1, z: 7 }),
      ),
    ).toEqual([]);
  });

  it("ignores components that have no attempt limit", () => {
    const savedTrack: any = {
      sections: [{ id: "s1", items: [{ id: "v", type: TrackItemType.VIDEO, content: {} }] }],
    };
    const values: any = {
      sections: [{ items: [{ serverId: "v", type: TrackItemType.VIDEO }] }],
    };
    expect(getLiveAttemptLimitChanges(savedTrack, values)).toEqual([]);
  });
});
