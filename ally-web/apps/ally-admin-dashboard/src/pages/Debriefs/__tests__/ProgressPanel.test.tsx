import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);

/* eslint-disable import/first */
import { DebriefSessionProgress } from "@types";

import { ProgressPanel } from "../session/ProgressPanel";
/* eslint-enable import/first */

const RUN = "run-1";

const FULL: DebriefSessionProgress = {
  shownAs: "card",
  sessions: 6,
  skills: [
    {
      skill: "empathy",
      trend: "more_consistent",
      why: "She named the client's feelings in four of the last five sessions.",
      evidence: [
        { run_id: "this", turn_index: 12 },
        { run_id: "run-old", turn_index: 4 },
      ],
      fhs: "agrees",
      learnerLine: "You named feelings more often.",
      hiddenFromLearner: false,
    },
  ],
  followups: [
    {
      point: "Ask about sleep before moving on.",
      status: "partly",
      evidence: [{ run_id: RUN, turn_index: 3 }],
    },
    { point: "Summarise before closing.", status: "not_yet", evidence: [] },
  ],
  focus: {
    skill: "goals",
    why: "Goals came up late in each session.",
    learner_line: "Next time, agree one goal early.",
    practise_next: true,
  },
  vetoes: [],
  windowSessionIds: ["s1", "s2"],
  createdAt: "2026-11-12T10:00:00Z",
};

const renderPanel = (
  progress: DebriefSessionProgress | null,
  over: { pastSessions?: number | null; onTurn?: (n: number) => void } = {},
) =>
  render(
    <MemoryRouter>
      <ProgressPanel
        progress={progress}
        runId={RUN}
        pastSessions={over.pastSessions}
        onTurn={over.onTurn ?? vi.fn()}
      />
    </MemoryRouter>,
  );

describe("Session › Progress", () => {
  it("shows each skill's trend, why, evidence, cross-check and what the learner saw", () => {
    const onTurn = vi.fn();
    renderPanel(FULL, { onTurn });
    const skill = screen.getByTestId("progress-skill");
    expect(within(skill).getByText("Empathy, warmth and genuineness")).toBeInTheDocument();
    expect(within(skill).getByTestId("progress-trend")).toHaveTextContent(
      "Getting more consistent",
    );
    expect(skill).toHaveTextContent("four of the last five sessions");
    expect(within(skill).getByTestId("progress-cross-check")).toHaveTextContent(
      "Foundational Skills levels: Agree",
    );
    expect(within(skill).getByTestId("progress-learner-saw")).toHaveTextContent(
      "The learner saw: “You named feelings more often.”",
    );
    expect(within(skill).queryByTestId("progress-held-back")).toBeNull();

    // This session's turn scrolls the roleplay; an earlier session's opens its page.
    fireEvent.click(within(skill).getByTestId("progress-turn-link"));
    expect(onTurn).toHaveBeenCalledWith(12);
    expect(within(skill).getByTestId("progress-run-link")).toHaveAttribute(
      "href",
      "/debriefs/sessions/run-old",
    );

    expect(screen.getByTestId("progress-shown-as")).toHaveTextContent("progress card");
    const followups = screen.getAllByTestId("progress-followup");
    expect(followups[0]).toHaveTextContent("Ask about sleep before moving on.");
    expect(followups[0]).toHaveTextContent("Partly");
    // Evidence naming this run's own id is a turn link too.
    fireEvent.click(within(followups[0]).getByTestId("progress-turn-link"));
    expect(onTurn).toHaveBeenCalledWith(3);
    expect(followups[1]).toHaveTextContent("Not yet");

    const focus = screen.getByTestId("progress-focus");
    expect(focus).toHaveTextContent("Collaborative goal-setting");
    expect(focus).toHaveTextContent("Linked to Practise this next");
    expect(focus).toHaveTextContent("Next time, agree one goal early.");

    // No system words reach the page.
    const text = screen.getByTestId("session-progress").textContent ?? "";
    for (const jargon of ["veto", "FHS", "run_id", "fhs", "more_consistent"])
      expect(text).not.toContain(jargon);
  });

  it("says when there is no reading, and why when this was the first session", () => {
    const { unmount } = renderPanel(null, { pastSessions: 0 });
    expect(screen.getByText("No progress reading for this session")).toBeInTheDocument();
    expect(screen.getByText(/first debriefed session/)).toBeInTheDocument();
    unmount();
    renderPanel(null);
    expect(screen.getByText("No progress reading for this session")).toBeInTheDocument();
    expect(screen.getByText(/learner progress is on/)).toBeInTheDocument();
  });

  it("shows a held-back skill as Too early to tell with the plain reason, not shown to the learner", () => {
    renderPanel({
      ...FULL,
      skills: [
        {
          skill: "hope",
          trend: "too_early",
          why: "Hope came up twice.",
          evidence: [],
          fhs: "absent",
          learnerLine: "",
          hiddenFromLearner: false,
        },
      ],
      vetoes: [
        { skill: "hope", veto: "too_few_sessions", detail: "2 sessions" },
        { skill: "rapport", veto: "contradicted_by_fhs", detail: null },
        { skill: "other", veto: "other_skill" },
      ],
    });
    const [hope, rapport, other] = screen.getAllByTestId("progress-skill");
    expect(within(hope).getByTestId("progress-trend")).toHaveTextContent("Too early to tell");
    expect(within(hope).getByTestId("progress-held-back")).toHaveTextContent(
      "Held back: fewer than 3 sessions gave a chance to show this skill",
    );
    expect(within(hope).getByTestId("progress-cross-check")).toHaveTextContent("No levels");
    expect(within(hope).getByTestId("progress-learner-saw")).toHaveTextContent(
      "Not shown to the learner",
    );
    // A held-back skill the reading didn't list still shows with its reason.
    expect(rapport).toHaveTextContent("Rapport-building and self-disclosure");
    expect(rapport).toHaveTextContent(
      "Held back: the Foundational Skills levels went the other way",
    );
    expect(other).toHaveTextContent("Held back: not one of the 14 foundational skills");
  });

  it("keeps a 'worth another look' trend for staff but says the learner wasn't told", () => {
    renderPanel({
      ...FULL,
      skills: [
        {
          skill: "harm",
          trend: "worth_another_look",
          why: "Safety questions came later each time.",
          evidence: [{ run_id: "this", turn_index: 8 }],
          fhs: "disagrees",
          learnerLine: null,
          hiddenFromLearner: true,
        },
      ],
      focus: null,
      followups: [],
    });
    const skill = screen.getByTestId("progress-skill");
    expect(within(skill).getByTestId("progress-trend")).toHaveTextContent("Worth another look");
    expect(within(skill).getByTestId("progress-cross-check")).toHaveTextContent("Disagree");
    expect(within(skill).getByTestId("progress-learner-saw")).toHaveTextContent(
      "Not shown to the learner",
    );
    expect(within(skill).queryByTestId("progress-held-back")).toBeNull();
    expect(screen.getByText("No earlier points to follow up.")).toBeInTheDocument();
    expect(screen.queryByTestId("progress-focus")).toBeNull();
  });
});
