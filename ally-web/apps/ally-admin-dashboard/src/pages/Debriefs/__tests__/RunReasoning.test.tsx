import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { DebriefCardsData, DebriefRunDetail } from "@types";

import { draftChanges } from "../draftChanges";
import { DraftChanges, HowItWasMade, ReplyTraces } from "../RunReasoning";

const cards = (over: Partial<DebriefCardsData> = {}): DebriefCardsData => ({
  opening: "You stayed with Meena.",
  important_moment: null,
  what_worked: [
    {
      skill: "Open questions",
      turn_index: 1,
      quote: "What brings you?",
      lead: "Good start.",
      body: "It let her lead.",
    },
  ],
  work_on_this: [
    {
      skill: "Exploring risk",
      turn_index: 3,
      quote: "Tell me more.",
      lead: "Ask about safety.",
      why: "It shows whether she is at risk.",
      try_saying: "Have you thought of ending your life?",
    },
  ],
  practise_next: null,
  reflective_question: "What made it hard?",
  progress_note: null,
  ...over,
});

const run = (over: Partial<DebriefRunDetail> = {}): DebriefRunDetail => ({
  id: "run-1",
  scenarioSessionId: "s1",
  mode: "shadow",
  status: "published",
  skipReason: null,
  recipeKey: "standard",
  releaseVersion: 2,
  language: "en",
  fallbackRung: 0,
  revisionRounds: 1,
  estimatedCostUsd: "0.12",
  actualCostUsd: null,
  ceilingUsd: "0.50",
  evaluatorOverall: "8.6",
  evaluatorHardFails: [],
  checkFailures: [],
  steps: [],
  workspace: {},
  cards: cards(),
  error: null,
  ...over,
});

describe("draftChanges", () => {
  it("lists only the sections that changed, added or removed", () => {
    const before = cards();
    const after = cards({
      opening: "A sharper opening.",
      what_worked: [],
      practise_next: { skill: "Exploring risk", reason: "Ask directly." },
    });
    expect(draftChanges(before, after)).toEqual([
      { section: "opening", before: "You stayed with Meena.", after: "A sharper opening." },
      { section: "what_worked[0]", before: expect.stringContaining("Good start."), after: null },
      { section: "practise_next", before: null, after: "Exploring risk · Ask directly." },
    ]);
  });

  it("finds nothing when the drafts are the same", () => {
    expect(draftChanges(cards(), cards())).toEqual([]);
  });
});

describe("HowItWasMade (reasoning out loud)", () => {
  it("says why each step ran, what it got, what it thought, what it made, and the outcome", () => {
    render(
      <HowItWasMade
        run={run({
          steps: [
            {
              step: "analyst",
              label: "Reading your session…",
              status: "done",
              startedAt: "2026-11-10T00:00:00Z",
              ms: 4200,
              model: "gemini-2.5-pro",
              estimatedUsd: 0.02,
              why: "Builds the evidence map the Writer writes from.",
              inputs: ["the transcript (12 turns)", "the scenario"],
              reasoning: "Turn 3 explored the cue but never asked about safety.",
              output: "4 skills read: 2 observed, 1 partial, 1 missed",
              budgetLeftUsd: 0.41,
            },
            {
              step: "progress_reader",
              label: "",
              status: "skipped",
              startedAt: "2026-11-10T00:00:05Z",
              ms: 0,
              note: "no history",
              why: "Skipped: this learner has no earlier debriefs to follow up.",
            },
          ],
          workspace: {
            evidence: { behaviours: [] },
            decision: { status: "published", round: 1, why: "Published round 1: it scored 8.6." },
          },
        })}
      />,
    );
    const [analyst, progress] = screen.getAllByTestId("run-step");
    const a = within(analyst);
    expect(a.getByText("Analyst")).toBeTruthy();
    expect(a.getByText("Builds the evidence map the Writer writes from.")).toBeTruthy();
    expect(a.getByText("the transcript (12 turns) · the scenario")).toBeTruthy();
    expect(a.getByText("Turn 3 explored the cue but never asked about safety.")).toBeTruthy();
    expect(a.getByText(/4 skills read/)).toBeTruthy();
    expect(a.getByText(/\$0\.41 left/)).toBeTruthy();
    expect(a.getByText("Show what it produced")).toBeTruthy();
    expect(
      within(progress).getByText("Skipped: this learner has no earlier debriefs to follow up."),
    ).toBeTruthy();
    expect(within(screen.getByTestId("run-decision")).getByText(/Published round 1/)).toBeTruthy();
  });

  it("says when a run predates the reasoning, and still lists its steps", () => {
    render(
      <HowItWasMade
        run={run({
          steps: [
            {
              step: "writer",
              label: "",
              status: "done",
              startedAt: "2026-10-01T00:00:00Z",
              ms: 9000,
              note: null,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(/made before steps recorded their reasoning/)).toBeTruthy();
    expect(screen.getByText("Writer")).toBeTruthy();
  });
});

describe("DraftChanges", () => {
  it("shows what each revision was asked to fix and what changed", () => {
    render(
      <DraftChanges
        run={run({
          workspace: {
            drafts: [
              { round: 0, cards: cards(), critique: [] },
              {
                round: 1,
                cards: cards({ opening: "A sharper opening." }),
                critique: [{ section: "opening", note: "Name what she said." }],
              },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText("Revision 1: 1 section changed")).toBeTruthy();
    expect(screen.getByText(/Name what she said\./)).toBeTruthy();
    expect(screen.getByText("A sharper opening.")).toBeTruthy();
  });

  it("says when the first draft stood", () => {
    render(
      <DraftChanges
        run={run({ workspace: { drafts: [{ round: 0, cards: cards(), critique: [] }] } })}
      />,
    );
    expect(screen.getByText("The first draft was not revised.")).toBeTruthy();
  });
});

describe("ReplyTraces", () => {
  it("shows each reply's lookups and nothing when there were no replies", () => {
    const { container, rerender } = render(<ReplyTraces run={run()} />);
    expect(container.textContent).toBe("");
    rerender(
      <ReplyTraces
        run={run({
          workspace: {
            replyTraces: [
              {
                at: "2026-11-10T06:00:00Z",
                model: "gemini-2.5-flash",
                turns: 2,
                costUsd: 0.002,
                tools: [
                  {
                    name: "search_guidance",
                    topic: "asking about suicide",
                    ok: true,
                    ms: 40,
                    found: "1 passage(s)",
                  },
                ],
                stoppedBy: "budget",
              },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText(/Searched guidance “asking about suicide”: 1 passage/)).toBeTruthy();
    expect(screen.getByText(/the reply's budget was nearly spent/)).toBeTruthy();
  });
});
