// The panel renders two payload shapes: working memory (#3) and the Stage
// Director. The working-memory card must stay exactly as it was; the director
// card leads with the thought paragraph and shows none of WM's empty sections.
import "@constants";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { en } from "@constants";
import type { MonologueTurn } from "@types";

import { InternalMonologuePanel } from "../InternalMonologuePanel";

const t = en.internalMonologue;

const WM_TURN: MonologueTurn = {
  type: "monologue.turn",
  turn: 1,
  counsellorSaid: "How have you been sleeping?",
  clientSaid: "Fine.",
  stanceFrom: null,
  stanceTo: "Guarded",
  turnsInStance: 1,
  arc: ["Guarded", "Open"],
  score: 10,
  affect: "wary",
  appraisal: null,
  register: null,
  disclosed: [],
  withheld: [],
  threadsOpened: [],
  threadsClosed: [],
  recalled: [],
  retrieveCues: [],
  events: [],
  sections: { backstory: "Asha, 34" },
  missed: false,
  updatesMissed: 0,
};

const SD_TURN = (overrides: Record<string, unknown> = {}): MonologueTurn =>
  ({
    type: "monologue.turn",
    mode: "stage_director",
    turn: 2,
    thought: "He keeps asking about sleep. I don't want to get into the pills yet.",
    thoughtTurnsOld: 0,
    missed: false,
    events: [{ label: "Open question", score: 5 }],
    score: 15,
    stanceTo: "Guarded",
    arc: ["Guarded", "Open"],
    counsellorSaid: "What keeps you up?",
    clientSaid: "Work, mostly.",
    ...overrides,
  }) as MonologueTurn;

describe("InternalMonologuePanel", () => {
  it("renders a working-memory turn as before", () => {
    render(<InternalMonologuePanel turns={[WM_TURN]} />);
    const card = screen.getByTestId("monologue-turn-1");
    expect(within(card).getByText(t.nowAt("Guarded"))).toBeInTheDocument();
    expect(within(card).getByText(t.feels("wary"))).toBeInTheDocument();
    expect(within(card).getByText(t.sentToActor)).toBeInTheDocument();
    expect(within(card).queryByText(t.thoughtHeading)).not.toBeInTheDocument();
  });

  it("leads a Stage Director turn with the thought, plus state, score, events and exchange", () => {
    render(<InternalMonologuePanel turns={[SD_TURN()]} />);
    const card = screen.getByTestId("monologue-turn-2");

    expect(within(card).getByText(t.thoughtHeading)).toBeInTheDocument();
    expect(screen.getByTestId("monologue-thought-2")).toHaveTextContent(
      "He keeps asking about sleep. I don't want to get into the pills yet.",
    );
    expect(within(card).getByText(/Turn 2 · Guarded/)).toBeInTheDocument();
    expect(within(card).getByText(/score 15/)).toBeInTheDocument();
    expect(within(card).getByText(t.credited("Open question (+5)"))).toBeInTheDocument();
    expect(within(card).getByText("What keeps you up?")).toBeInTheDocument();
    // None of working memory's sections exist on this payload.
    expect(within(card).queryByText(t.sentToActor)).not.toBeInTheDocument();
    expect(within(card).queryByText(t.thoughtMissed)).not.toBeInTheDocument();
    expect(within(card).queryByText(t.thoughtAge(1))).not.toBeInTheDocument();
  });

  it("says when the thought is old or missed", () => {
    render(<InternalMonologuePanel turns={[SD_TURN({ missed: true, thoughtTurnsOld: 2 })]} />);
    const card = screen.getByTestId("monologue-turn-2");
    expect(within(card).getByText(t.thoughtMissed)).toBeInTheDocument();
    expect(within(card).getByText(t.thoughtAge(2))).toBeInTheDocument();
  });

  it("renders both shapes in one feed", () => {
    render(<InternalMonologuePanel turns={[WM_TURN, SD_TURN({ thought: "" })]} />);
    expect(screen.getByTestId("monologue-turn-1")).toBeInTheDocument();
    expect(screen.getByTestId("monologue-thought-2")).toHaveTextContent(t.noThought);
  });
});
