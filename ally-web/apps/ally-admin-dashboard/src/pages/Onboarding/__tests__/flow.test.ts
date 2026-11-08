import { describe, expect, it } from "vitest";

import {
  NOTHING_PASSED,
  isMultiSelect,
  passedFromStep,
  screenFor,
  splitQuestion,
  stepPosition,
} from "../flow";

import type { BotDraftView } from "../types";

const view = (over: Partial<BotDraftView> = {}): BotDraftView =>
  ({
    id: "d1",
    status: "active",
    step: "reading",
    source: { website: "https://sunrise.example/", description: null },
    crawl: { status: "running", finishedAt: null },
    safety: { name: "Mental health safety", on: true },
    conversation: { pending: "", gaps: null, questionsLeft: 3 },
    transcript: [],
    ...over,
  }) as unknown as BotDraftView;

const safetyThenAnswers = (answers: number) => [
  { id: "0", role: "owner", text: "Looks right", at: "" },
  { id: "1", role: "builder", text: "I've turned on **Mental health safety**.", at: "" },
  { id: "2", role: "builder", text: "Who will mostly talk to your assistant?", at: "" },
  ...Array.from({ length: answers }, (_, i) => ({
    id: `o${i}`,
    role: "owner",
    text: "Both",
    at: "",
  })),
];

describe("one screen at a time (chunk 20d)", () => {
  it("keeps the reading result up until the owner moves on", () => {
    expect(screenFor(view(), NOTHING_PASSED)).toBe("reading");
    expect(screenFor(view({ step: "learned" }), NOTHING_PASSED)).toBe("reading");
    expect(screenFor(view({ step: "learned" }), { ...NOTHING_PASSED, reading: true })).toBe(
      "learned",
    );
  });

  it("shows safety before the first question, and not again once one is answered", () => {
    const gaps = (answers: number) =>
      view({ step: "gaps", transcript: safetyThenAnswers(answers) as never });
    expect(screenFor(gaps(0), { ...NOTHING_PASSED, reading: true })).toBe("safety");
    expect(screenFor(gaps(0), { ...NOTHING_PASSED, reading: true, safety: true })).toBe("question");
    expect(screenFor(gaps(1), { ...NOTHING_PASSED, reading: true })).toBe("question");
  });

  it("goes design → building → make it yours → share → live", () => {
    const all = { reading: true, safety: true, built: false, make: false };
    expect(screenFor(view({ step: "design" }), all)).toBe("design");
    // The builder writes the assistant in the design turn: Building shows while it does.
    expect(screenFor(view({ step: "design" }), all, true)).toBe("building");
    expect(screenFor(view({ step: "building" }), all)).toBe("building");
    // Built: the finished build stays up until Continue.
    expect(screenFor(view({ step: "share" }), all)).toBe("building");
    expect(screenFor(view({ step: "share" }), { ...all, built: true })).toBe("make");
    expect(screenFor(view({ step: "share" }), { ...all, built: true, make: true })).toBe("share");
    expect(screenFor(view({ step: "published", status: "published" }), all)).toBe("live");
  });

  it("resumes past everything before the draft's step", () => {
    expect(passedFromStep(view({ step: "share" }), {})).toEqual({
      reading: true,
      safety: true,
      built: true,
      make: false,
    });
    expect(passedFromStep(view({ step: "share" }), { make: true }).make).toBe(true);
    expect(passedFromStep(view({ step: "reading" }), {}).reading).toBe(false);
  });

  it("counts each question as a step in the footer", () => {
    const v = view({ step: "gaps", transcript: safetyThenAnswers(1) as never });
    const position = stepPosition("question", v);
    // Start, Reading, Learned, Safety, 1 answered + 3 left, Design, Building, Make it yours, Share.
    expect(position).toMatchObject({ number: 6, total: 12, name: "A few questions" });
    expect(stepPosition("share", v).number).toBe(12);
  });

  it("splits the builder's message into the question and the line under it", () => {
    expect(
      splitQuestion(
        "Which languages should it reply in? It replies in the language each person writes in, from the ones you choose.",
      ),
    ).toEqual({
      lead: "",
      title: "Which languages should it reply in?",
      subtitle: "It replies in the language each person writes in, from the ones you choose.",
    });
    expect(
      splitQuestion(
        "One thing I couldn't find: your fees. Price is one of the first things people ask.",
      ),
    ).toEqual({
      lead: "",
      title: "One thing I couldn't find: your fees.",
      subtitle: "Price is one of the first things people ask.",
    });
    expect(
      splitQuestion(
        "Done. I added those fees to What we learned. One thing I couldn't find: your cancellation policy. People often ask before they book.",
      ),
    ).toEqual({
      lead: "Done. I added those fees to What we learned.",
      title: "One thing I couldn't find: your cancellation policy.",
      subtitle: "People often ask before they book.",
    });
  });

  it("knows the language question takes several answers", () => {
    expect(isMultiSelect(["English", "Hindi", "Marathi", "Tamil", "Other"])).toBe(true);
    expect(isMultiSelect(["Clients or customers", "My team", "Both"])).toBe(false);
  });
});
