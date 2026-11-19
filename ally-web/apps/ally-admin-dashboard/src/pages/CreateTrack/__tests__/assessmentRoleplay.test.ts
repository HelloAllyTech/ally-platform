import { describe, expect, it } from "vitest";

import { CompletionCriteria, TrackDetail, TrackFormValues, TrackItemType } from "@types";

import {
  assessmentRuleSignature,
  deserializeTrack,
  getRoleplayType,
  hasAssessmentRuleChanges,
  serializeItem,
  validateAssessmentPairs,
  validateTrackForPublish,
} from "../trackFormUtils";

const sent = (completionCriteria: CompletionCriteria) =>
  serializeItem(
    {
      localId: "i",
      type: TrackItemType.ROLEPLAY,
      title: "R",
      description: "",
      scenarioId: 1,
      completionCriteria,
    } as never,
    1,
  ).completionCriteria;

const roleplay = (title: string, completionCriteria: CompletionCriteria, serverId?: string) => ({
  localId: title,
  serverId,
  type: TrackItemType.ROLEPLAY,
  title,
  description: "",
  scenarioId: 1,
  completionCriteria,
});

const course = (...items: ReturnType<typeof roleplay>[]) =>
  ({
    title: "T",
    description: "D",
    coverImageUrl: "c",
    sections: [{ localId: "s", title: "S", description: "", items }],
  }) as unknown as TrackFormValues;

const assessment = (extra: CompletionCriteria = {}): CompletionCriteria => ({
  assessmentMode: true,
  completionLogic: "SCORE",
  minLearnerTurns: 10,
  showResultsToLearner: true,
  ...extra,
});

describe("roleplay type", () => {
  it("is derived from the criteria", () => {
    expect(getRoleplayType({ assessmentMode: true, completionLogic: "PARTICIPATION" })).toBe(
      "ASSESSMENT",
    );
    expect(getRoleplayType({ completionLogic: "PARTICIPATION" })).toBe("TRIAL");
    expect(getRoleplayType({ completionLogic: "SCORE" })).toBe("PRACTICE");
    expect(getRoleplayType({})).toBe("PRACTICE");
  });
});

describe("compactCriteria for roleplays", () => {
  it("Trial sends participation only", () => {
    expect(
      sent({
        completionLogic: "PARTICIPATION",
        minScore: 5,
        minDurationSeconds: 5,
        minLearnerTurns: 4,
        showResultsToLearner: false,
      }),
    ).toEqual({ completionLogic: "PARTICIPATION" });
  });

  it("Practice never carries assessment keys", () => {
    expect(
      sent({ completionLogic: "SCORE", minScore: 60, minLearnerTurns: 10, assessmentPhase: "PRE" }),
    ).toEqual({ completionLogic: "SCORE", minScore: 60 });
  });

  it("Assessment sends SCORE, turns, results, phase and key; never duration", () => {
    expect(
      sent(
        assessment({
          minScore: 70,
          minDurationSeconds: 90,
          assessmentPhase: "POST",
          assessmentPairKey: "k",
        }),
      ),
    ).toEqual({
      assessmentMode: true,
      completionLogic: "SCORE",
      minScore: 70,
      minLearnerTurns: 10,
      showResultsToLearner: true,
      assessmentPhase: "POST",
      assessmentPairKey: "k",
    });
  });

  it("Assessment with no pass mark sends SCORE and no minScore; a phase without a key is dropped", () => {
    expect(sent(assessment({ minScore: 0, assessmentPhase: "PRE" }))).toEqual({
      assessmentMode: true,
      completionLogic: "SCORE",
      minLearnerTurns: 10,
      showResultsToLearner: true,
    });
  });

  it("round-trips through deserializeTrack", () => {
    const payload = sent(
      assessment({ minScore: 70, assessmentPhase: "PRE", assessmentPairKey: "k" }),
    );
    const detail = {
      id: "t",
      title: "T",
      status: "DRAFT",
      sections: [
        {
          id: "s",
          order: 0,
          title: "S",
          items: [
            {
              id: "i1",
              order: 0,
              type: TrackItemType.ROLEPLAY,
              title: "R",
              scenarioId: 1,
              completionCriteria: payload,
            },
          ],
        },
      ],
    } as unknown as TrackDetail;
    const form = deserializeTrack(detail);
    const criteria = form.sections[0].items[0].completionCriteria;
    expect(getRoleplayType(criteria)).toBe("ASSESSMENT");
    expect(criteria).toMatchObject(payload!);
    expect(sent(criteria)).toEqual(payload);
  });

  it("reads a legacy assessment as SCORE with results shown", () => {
    const detail = {
      id: "t",
      title: "T",
      status: "ACTIVE",
      sections: [
        {
          id: "s",
          order: 0,
          items: [
            {
              id: "i1",
              order: 0,
              type: TrackItemType.ROLEPLAY,
              title: "R",
              scenarioId: 1,
              completionCriteria: { assessmentMode: true, completionLogic: "PARTICIPATION" },
            },
          ],
        },
      ],
    } as unknown as TrackDetail;
    const criteria = deserializeTrack(detail).sections[0].items[0].completionCriteria;
    expect(criteria.completionLogic).toBe("SCORE");
    expect(criteria.showResultsToLearner).toBe(true);
    expect(criteria.minLearnerTurns).toBeUndefined();
  });
});

describe("assessment validation", () => {
  const errorsFor = (...items: ReturnType<typeof roleplay>[]) =>
    validateTrackForPublish(course(...items)).map(e => e.message);

  it("accepts a well-formed pre and post in order", () => {
    expect(
      errorsFor(
        roleplay("Pre", assessment({ assessmentPhase: "PRE", assessmentPairKey: "k" })),
        roleplay("Post", assessment({ assessmentPhase: "POST", assessmentPairKey: "k" })),
      ),
    ).toEqual([]);
  });

  it("rejects turns outside 1-50 or fractional", () => {
    for (const turns of [0, 51, 2.5]) {
      expect(errorsFor(roleplay("A", assessment({ minLearnerTurns: turns })))).toEqual([
        "Roleplay: minimum learner turns must be a whole number from 1 to 50",
      ]);
    }
    expect(errorsFor(roleplay("A", assessment({ minLearnerTurns: 50 })))).toEqual([]);
    expect(errorsFor(roleplay("A", assessment({ minLearnerTurns: 1 })))).toEqual([]);
  });

  it("rejects a pair with one half, two PREs, or POST before PRE", () => {
    expect(
      errorsFor(roleplay("Pre", assessment({ assessmentPhase: "PRE", assessmentPairKey: "k" }))),
    ).toHaveLength(1);
    expect(
      errorsFor(
        roleplay("A", assessment({ assessmentPhase: "PRE", assessmentPairKey: "k" })),
        roleplay("B", assessment({ assessmentPhase: "PRE", assessmentPairKey: "k" })),
      ),
    ).toHaveLength(2);
    const reversed = validateAssessmentPairs(
      course(
        roleplay("Post", assessment({ assessmentPhase: "POST", assessmentPairKey: "k" })),
        roleplay("Pre", assessment({ assessmentPhase: "PRE", assessmentPairKey: "k" })),
      ),
    );
    expect(reversed).toEqual([
      expect.objectContaining({
        itemIndex: 0,
        message: "Roleplay: the pre-assessment must come before its post-assessment in the course",
      }),
    ]);
  });

  it("rejects a phase with no pair key", () => {
    expect(errorsFor(roleplay("A", assessment({ assessmentPhase: "PRE" })))).toEqual([
      "Roleplay: pre/post needs both a phase and a paired assessment",
    ]);
  });
});

describe("live-edit change detection", () => {
  const saved = (criteria: CompletionCriteria) =>
    ({
      sections: [
        {
          items: [{ id: "i1", type: TrackItemType.ROLEPLAY, completionCriteria: criteria }],
        },
      ],
    }) as unknown as TrackDetail;

  it("ignores an unchanged assessment and practice-only edits", () => {
    const before = assessment();
    expect(
      hasAssessmentRuleChanges(saved(before), course(roleplay("R", { ...before }, "i1"))),
    ).toBe(false);
    expect(
      hasAssessmentRuleChanges(
        saved({ completionLogic: "SCORE", minScore: 50 }),
        course(roleplay("R", { completionLogic: "SCORE", minScore: 80 }, "i1")),
      ),
    ).toBe(false);
  });

  it("flags a type switch, turns, pass mark, results or pairing change", () => {
    const before = assessment();
    for (const next of [
      { completionLogic: "SCORE_AND_DURATION" } as CompletionCriteria,
      assessment({ minLearnerTurns: 12 }),
      assessment({ minScore: 60 }),
      assessment({ showResultsToLearner: false }),
      assessment({ assessmentPhase: "PRE", assessmentPairKey: "k" }),
    ]) {
      expect(hasAssessmentRuleChanges(saved(before), course(roleplay("R", next, "i1")))).toBe(true);
    }
  });

  it("signature treats missing results flag as shown", () => {
    expect(assessmentRuleSignature({ assessmentMode: true })).toBe(
      assessmentRuleSignature({ assessmentMode: true, showResultsToLearner: true }),
    );
  });
});
