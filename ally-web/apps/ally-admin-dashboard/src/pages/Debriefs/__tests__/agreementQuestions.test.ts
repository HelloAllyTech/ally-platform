import { describe, expect, it } from "vitest";
import "@constants";

import { liveQuestions, sourceNote } from "../session/agreementQuestions";

const q = (measure: string, over: Record<string, unknown> = {}) =>
  ({ measure, answer: true, prefilled: true, saved: null, source: null, ...over }) as never;

describe("the yes/no questions under the verdict", () => {
  it("start Yes with nothing relevant; a comment's No stands", () => {
    const comment = {
      kind: "comment",
      commentId: "c1",
      anchorKind: "transcript",
      turnIndex: 12,
      section: null,
    };
    const out = liveQuestions(
      [
        q("accuracy", { answer: false, prefilled: false, source: comment }),
        q("evidence_specificity"),
      ],
      [],
      {},
    );
    expect(out.map(x => x.answer)).toEqual([false, true]);
    expect(sourceNote(out[0].source)).toBe("From your comment on turn 12");
    expect(sourceNote(out[1].source)).toBeNull();
  });

  it("a hard fail ticked in the panel pre-fills No, and unticking it puts Yes back", () => {
    const qs = [q("accuracy"), q("missed_risk_cue")];
    const ticked = liveQuestions(qs, ["fabricated_quote", "missed_risk_cue"], {});
    expect(ticked.map(x => x.answer)).toEqual([false, false]);
    expect(sourceNote(ticked[1].source)).toBe("From the hard fail you ticked");
    expect(liveQuestions(qs, [], {}).map(x => x.answer)).toEqual([true, true]);
  });

  it("the reviewer's own answer wins; a saved answer stands until they change it", () => {
    const qs = [q("accuracy", { saved: true }), q("missed_risk_cue")];
    expect(liveQuestions(qs, ["fabricated_quote"], {})[0].answer).toBe(true);
    expect(liveQuestions(qs, ["missed_risk_cue"], { missed_risk_cue: true })[1].answer).toBe(true);
  });

  it("notes a comment on a card or on the whole debrief in words", () => {
    expect(
      sourceNote({
        kind: "comment",
        commentId: "c",
        anchorKind: "card",
        turnIndex: null,
        section: "what_worked[0]",
      }),
    ).toMatch(/^From your comment on /);
    expect(
      sourceNote({
        kind: "comment",
        commentId: "c",
        anchorKind: "debrief",
        turnIndex: null,
        section: null,
      }),
    ).toBe("From your comment on the debrief");
  });
});
