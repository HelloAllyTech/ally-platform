import { describe, expect, it } from "vitest";

import { TrackItemType } from "@types";

import { getLiveQuizAttemptChanges } from "../trackFormUtils";

const saved = (limits: Record<string, number | null | undefined>): any => ({
  sections: [
    {
      id: "s1",
      items: Object.entries(limits).map(([id, maxAttempts]) => ({
        id,
        type: TrackItemType.QUIZ,
        content: { settings: { passScore: 70, maxAttempts }, questions: [] },
      })),
    },
  ],
});

const form = (limits: Record<string, number | null | undefined>): any => ({
  sections: [
    {
      items: Object.entries(limits).map(([serverId, maxAttempts]) => ({
        serverId,
        type: TrackItemType.QUIZ,
        quiz: { settings: { passScore: 70, maxAttempts } },
      })),
    },
  ],
});

describe("getLiveQuizAttemptChanges", () => {
  it("reports a raised limit and a move to unlimited", () => {
    expect(getLiveQuizAttemptChanges(saved({ a: 3, b: 3 }), form({ a: 5, b: null }))).toEqual([
      { trackItemId: "a", maxAttempts: 5 },
      { trackItemId: "b", maxAttempts: null },
    ]);
  });

  it("ignores unchanged, lowered and already-unlimited quizzes", () => {
    expect(
      getLiveQuizAttemptChanges(saved({ a: 3, b: 3, c: null }), form({ a: 3, b: 2, c: 9 })),
    ).toEqual([]);
  });
});
