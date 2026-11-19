import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RoleplayItemPlayer } from "../RoleplayItemPlayer";
import {
  StartRoleplayItemPayload,
  TrackDetailItem,
  TrackItemStatus,
  TrackItemType,
} from "../../../../../types/tracks";

const { mockStartSimulation } = vi.hoisted(() => ({ mockStartSimulation: vi.fn() }));

const mockUseGetScenarioQuery = vi.fn();
const mockUseGetScenariosQuery = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@api", () => ({
  useGetScenarioQuery: (args: any, opts: any) => mockUseGetScenarioQuery(args, opts),
  useGetScenarioCaseDetailsQuery: () => ({ data: undefined }),
  useGetScenariosQuery: (args: any, opts: any) => {
    const result = mockUseGetScenariosQuery(args);
    return opts?.selectFromResult ? opts.selectFromResult(result ?? {}) : result;
  },
}));

vi.mock("@assets", () => ({
  ArrowDownFilled: () => <span data-testid="arrow-down" />,
  PlayIcon: () => <span data-testid="play-icon" />,
  Refresh: () => <span data-testid="refresh-icon" />,
  TickGreenBackground: () => <span data-testid="tick-icon" />,
}));

/**
 * Faithful stand-in for the real ScenarioCard: the blurb is plain text clamped
 * to two lines, and trigger warnings take its place entirely when present.
 * Neither path can show the learner the full challenge description.
 */
vi.mock("@components", () => ({
  ScenarioCard: ({ title, description, triggerWarnings }: any) => (
    <div data-testid="scenario-card">
      <div>{title}</div>
      {triggerWarnings?.length > 0 ? (
        <div data-testid="card-trigger-warnings">warnings</div>
      ) : (
        <div data-testid="card-blurb">{description}</div>
      )}
    </div>
  ),
}));

vi.mock("@hooks", () => ({
  useStartSimulation: () => ({ startSimulation: mockStartSimulation, isStarting: false }),
}));

vi.mock("@utils", () => ({
  getFormattedDateTime: () => "Jan 1, 2026",
  // The voice/text picker renders the shared segmented control, which joins
  // its classes with this.
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  RichTextRenderer: ({ content }: any) => <div data-testid="rich-text">{content}</div>,
  DropdownField: ({ options, value, onChange, label }: any) => (
    <select
      aria-label={label || "language"}
      data-testid="language-dropdown"
      value={value}
      onChange={e => onChange?.(e.target.value)}
    >
      {options?.map((option: string) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("../RoleplaySessionLogPanel", () => ({
  RoleplaySessionLogPanel: () => <div data-testid="session-log-panel" />,
}));

const ENGLISH = { value: "en-IN", label: "English (India)", language_id: 1 };
const HINDI = { value: "hi-IN", label: "Hindi (India)", language_id: 2 };

const CHALLENGE_DESCRIPTION =
  "<p>You are taking a call from a distressed parent whose teenager has run away.</p>";

const payload: StartRoleplayItemPayload = {
  type: TrackItemType.ROLEPLAY,
  trackItemProgressId: "progress-1",
  scenarioId: 123,
  completionCriteria: null,
  lastScenarioSessionId: null,
};

const buildItem = (description: string | null): TrackDetailItem => ({
  id: "item-1",
  type: TrackItemType.ROLEPLAY,
  order: 1,
  title: "Runaway teenager",
  description,
  scenarioId: 123,
  caseId: null,
  completionCriteria: null,
  contentMeta: null,
  status: TrackItemStatus.UNLOCKED,
  startedAt: null,
  completedAt: null,
  score: null,
  attemptCount: null,
  maxWatchedPct: null,
});

const mockScenario = (overrides: Record<string, unknown> = {}) => {
  mockUseGetScenarioQuery.mockReturnValue({
    data: {
      id: 123,
      title: "Runaway teenager",
      description: CHALLENGE_DESCRIPTION,
      coverImageUrl: "cover.jpg",
      ...overrides,
    },
  });
};

const mockCatalogLanguages = (languages: (typeof ENGLISH)[] | undefined) => {
  mockUseGetScenariosQuery.mockReturnValue({
    data: languages
      ? { data: [{ id: 123, availableLanguages: languages.map(lang => ({ ...lang })) }] }
      : undefined,
  });
};

const renderPlayer = (item: TrackDetailItem = buildItem(null)) =>
  render(
    <RoleplayItemPlayer payload={payload} item={item} trackId="track-1" alreadyCompleted={false} />,
  );

describe("RoleplayItemPlayer — challenge description", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScenario();
    mockCatalogLanguages(undefined);
  });

  it("shows the full challenge description even when the track item has its own blurb", () => {
    // The card blurb prefers the (short) track-item description, so the
    // scenario's actual brief was nowhere on the pre-launch screen.
    renderPlayer(buildItem("Short item blurb"));

    expect(screen.getByTestId("rich-text")).toHaveTextContent(CHALLENGE_DESCRIPTION);
  });

  it("shows the challenge description when trigger warnings take over the card", () => {
    mockScenario({ triggerWarnings: [{ id: 1, name: "Self harm" }] });

    renderPlayer();

    expect(screen.getByTestId("card-trigger-warnings")).toBeInTheDocument();
    expect(screen.getByTestId("rich-text")).toHaveTextContent(CHALLENGE_DESCRIPTION);
  });
});

describe("RoleplayItemPlayer — language selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScenario();
    mockCatalogLanguages([ENGLISH, HINDI]);
  });

  it("offers the roleplay's languages, defaulting to the first", async () => {
    renderPlayer();

    await waitFor(() => expect(screen.getByTestId("language-dropdown")).toHaveValue(ENGLISH.label));
  });

  it("starts the simulation in the language the learner picked", async () => {
    renderPlayer();

    const dropdown = await screen.findByTestId("language-dropdown");
    fireEvent.change(dropdown, { target: { value: HINDI.label } });
    await waitFor(() => expect(dropdown).toHaveValue(HINDI.label));

    fireEvent.click(screen.getByText("Start roleplay"));

    await waitFor(() =>
      expect(mockStartSimulation).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            scenarioId: 123,
            trackItemProgressId: "progress-1",
            languageId: HINDI.language_id,
          }),
        }),
      ),
    );
  });

  it("renders no picker when the roleplay offers no languages", () => {
    mockCatalogLanguages(undefined);

    renderPlayer();

    expect(screen.queryByTestId("language-dropdown")).not.toBeInTheDocument();
  });

  describe("text chat", () => {
    beforeEach(() => {
      localStorage.clear();
      mockStartSimulation.mockClear();
      mockCatalogLanguages([ENGLISH]);
    });

    it("offers no choice and starts a plain voice roleplay when text chat is unavailable", async () => {
      mockScenario();
      renderPlayer();

      expect(screen.queryByTestId("interaction-mode-picker")).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Start roleplay"));

      await waitFor(() => expect(mockStartSimulation).toHaveBeenCalled());
      expect(mockStartSimulation.mock.calls[0][0].params).not.toHaveProperty("interactionMode");
    });

    it("starts the track's roleplay as a text chat when the learner picks it", async () => {
      mockScenario({ textChatAvailable: true });
      renderPlayer();

      fireEvent.click(screen.getByRole("radio", { name: "Text chat" }));
      fireEvent.click(screen.getByText("Start roleplay"));

      await waitFor(() =>
        expect(mockStartSimulation).toHaveBeenCalledWith(
          expect.objectContaining({
            params: expect.objectContaining({
              trackItemProgressId: "progress-1",
              interactionMode: "TEXT",
            }),
          }),
        ),
      );
    });
  });
});

describe("RoleplayItemPlayer — return-to-track context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScenario();
    mockCatalogLanguages(undefined);
    sessionStorage.clear();
  });

  it("stashes exactly the classic context when no guided props are passed", async () => {
    renderPlayer();
    fireEvent.click(screen.getByText("Start roleplay"));
    await waitFor(() => expect(mockStartSimulation).toHaveBeenCalled());
    expect(sessionStorage.getItem("activeTrackContext")).toBe(
      JSON.stringify({ trackId: "track-1", itemId: "item-1" }),
    );
  });

  it("merges the guided journey's extras and calls onBeforeLaunch before leaving", async () => {
    const onBeforeLaunch = vi.fn(() => {
      // The context is stashed after this runs.
      expect(sessionStorage.getItem("activeTrackContext")).toBeNull();
    });
    render(
      <RoleplayItemPlayer
        payload={payload}
        item={buildItem(null)}
        trackId="track-1"
        alreadyCompleted={false}
        trackContextExtras={{ returnTo: "guided", threadId: "thread-1", cardId: "card-1" }}
        onBeforeLaunch={onBeforeLaunch}
      />,
    );
    fireEvent.click(screen.getByText("Start roleplay"));
    await waitFor(() => expect(mockStartSimulation).toHaveBeenCalled());
    expect(onBeforeLaunch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem("activeTrackContext") ?? "{}")).toEqual({
      returnTo: "guided",
      threadId: "thread-1",
      cardId: "card-1",
      trackId: "track-1",
      itemId: "item-1",
    });
  });
});

describe("RoleplayItemPlayer — assessment mode", () => {
  const assessmentPayload = (submittedAt: string | null): StartRoleplayItemPayload => ({
    ...payload,
    completionCriteria: { assessmentMode: true },
    lastScenarioSessionId: submittedAt ? "session-1" : null,
    assessmentSubmittedAt: submittedAt,
  });

  const renderAssessment = (submittedAt: string | null, alreadyCompleted = false) =>
    render(
      <RoleplayItemPlayer
        payload={assessmentPayload(submittedAt)}
        item={buildItem(null)}
        trackId="track-1"
        alreadyCompleted={alreadyCompleted}
      />,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockScenario();
    mockCatalogLanguages([ENGLISH]);
  });

  it("warns that there is one attempt before it is used, and still lets the learner start", async () => {
    renderAssessment(null);

    expect(screen.getByTestId("roleplay-assessment-notice")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("play-icon").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(mockStartSimulation).toHaveBeenCalled());
  });

  it("locks a submitted attempt: no start, no replay, report still reachable", () => {
    renderAssessment("2026-10-26T09:00:00.000Z");

    expect(screen.getByTestId("roleplay-assessment-locked")).toBeInTheDocument();
    expect(screen.queryByTestId("play-icon")).not.toBeInTheDocument();
    expect(screen.queryByTestId("refresh-icon")).not.toBeInTheDocument();
    expect(screen.queryByTestId("language-dropdown")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("roleplay-assessment-submitted"));
    expect(screen.getByTestId("session-log-panel")).toBeInTheDocument();
  });

  it("shows a passed assessment as completed, without a replay button", () => {
    renderAssessment("2026-10-26T09:00:00.000Z", true);

    expect(screen.queryByTestId("roleplay-assessment-submitted")).not.toBeInTheDocument();
    expect(screen.queryByTestId("refresh-icon")).not.toBeInTheDocument();
    expect(screen.getByTestId("roleplay-assessment-locked")).toBeInTheDocument();
  });
});

describe("RoleplayItemPlayer — completion requirement and last attempt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScenario();
    mockCatalogLanguages(undefined);
  });

  const renderWith = (extra: Partial<StartRoleplayItemPayload>, alreadyCompleted = false) =>
    render(
      <RoleplayItemPlayer
        payload={{ ...payload, ...extra }}
        item={buildItem(null)}
        trackId="track-1"
        alreadyCompleted={alreadyCompleted}
      />,
    );

  const attempt = (failureReasons: Array<"INSUFFICIENT_SCORE" | "INSUFFICIENT_DURATION">) => ({
    failureReasons,
    score: 40,
    durationSeconds: 75,
    requiredScore: 60,
    requiredDurationSeconds: 90,
    endedAt: "2026-11-17T10:00:00.000Z",
  });

  it.each([
    [
      { completionLogic: "SCORE" as const, minScore: 60, minDurationSeconds: null },
      "To complete it, score at least 60.",
    ],
    [
      { completionLogic: "DURATION" as const, minScore: null, minDurationSeconds: 90 },
      "To complete it, keep the roleplay going for at least 1 min 30 sec.",
    ],
    [
      { completionLogic: "SCORE_AND_DURATION" as const, minScore: 60, minDurationSeconds: 180 },
      "To complete it, score at least 60 and keep the roleplay going for at least 3 min.",
    ],
    [
      { completionLogic: "PARTICIPATION" as const, minScore: null, minDurationSeconds: null },
      "This completes as soon as you start the roleplay.",
    ],
  ])("states the %o requirement before launch", (roleplayGate, text) => {
    renderWith({ roleplayGate });
    expect(screen.getByTestId("roleplay-requirement")).toHaveTextContent(text);
  });

  it("states nothing when the item has no gate and no server rule", () => {
    renderWith({});
    expect(screen.queryByTestId("roleplay-requirement")).not.toBeInTheDocument();
  });

  it("tells the learner they missed the time requirement", () => {
    renderWith({ lastRoleplayAttempt: attempt(["INSUFFICIENT_DURATION"]) });
    const notice = screen.getByTestId("roleplay-last-attempt");
    expect(notice).toHaveTextContent("Your last attempt didn't complete this roleplay");
    expect(notice).toHaveTextContent(
      "It lasted 1 min 15 sec; this roleplay needs at least 1 min 30 sec.",
    );
    expect(notice).not.toHaveTextContent("You scored");
    expect(notice).toHaveTextContent("Try again when you're ready.");
  });

  it("tells the learner they missed the score", () => {
    renderWith({ lastRoleplayAttempt: attempt(["INSUFFICIENT_SCORE"]) });
    const notice = screen.getByTestId("roleplay-last-attempt");
    expect(notice).toHaveTextContent("You scored 40; this roleplay needs at least 60.");
    expect(notice).not.toHaveTextContent("It lasted");
  });

  it("names both gates when both were missed", () => {
    renderWith({
      lastRoleplayAttempt: attempt(["INSUFFICIENT_DURATION", "INSUFFICIENT_SCORE"]),
    });
    const notice = screen.getByTestId("roleplay-last-attempt");
    expect(notice).toHaveTextContent("It lasted 1 min 15 sec");
    expect(notice).toHaveTextContent("You scored 40");
  });

  it("explains a missing score without inventing one", () => {
    renderWith({
      lastRoleplayAttempt: { ...attempt(["INSUFFICIENT_SCORE"]), score: null },
    });
    expect(screen.getByTestId("roleplay-last-attempt")).toHaveTextContent(
      "It didn't reach the minimum score of 60.",
    );
  });

  it("shows no failure once the item is complete", () => {
    renderWith({ lastRoleplayAttempt: attempt(["INSUFFICIENT_SCORE"]) }, true);
    expect(screen.queryByTestId("roleplay-last-attempt")).not.toBeInTheDocument();
  });
});

describe("RoleplayItemPlayer — turn-based assessment", () => {
  const assessment = (overrides: Record<string, unknown> = {}) => ({
    phase: null,
    requiredTurns: 10,
    showResults: true,
    resultsHidden: false,
    preAssessment: null,
    incompleteStarts: 0,
    submission: null,
    ...overrides,
  });

  const renderTurns = (extra: Partial<StartRoleplayItemPayload>, alreadyCompleted = false) =>
    render(
      <RoleplayItemPlayer
        payload={{
          ...payload,
          completionCriteria: { assessmentMode: true },
          roleplayGate: {
            roleplayType: "ASSESSMENT",
            completionLogic: "SCORE",
            minScore: null,
            minDurationSeconds: null,
            minLearnerTurns: 10,
          },
          assessment: assessment(),
          ...extra,
        }}
        item={buildItem(null)}
        trackId="track-1"
        alreadyCompleted={alreadyCompleted}
      />,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockScenario();
    mockCatalogLanguages([ENGLISH]);
  });

  it("explains the turn minimum in the intro and requirement, never a duration", () => {
    renderTurns({});
    expect(
      screen.getByText(
        "This is an assessment. You get one attempt, and it counts once you've taken at least 10 turns.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("roleplay-requirement")).toHaveTextContent(
      "To count, take at least 10 turns.",
    );
    expect(screen.queryByTestId("roleplay-assessment-notice")).not.toBeInTheDocument();
  });

  it("stashes the turn minimum so the live session can count toward it", async () => {
    renderTurns({});
    fireEvent.click(screen.getByText("Start roleplay"));
    await waitFor(() => expect(mockStartSimulation).toHaveBeenCalled());
    expect(JSON.parse(sessionStorage.getItem("activeTrackContext") ?? "{}")).toMatchObject({
      assessmentRequiredTurns: 10,
      assessmentScenarioId: 123,
    });
  });

  it("tells the learner a short attempt didn't count and lets them start again", () => {
    renderTurns({
      lastRoleplayAttempt: {
        failureReasons: ["INSUFFICIENT_TURNS"],
        score: null,
        durationSeconds: 40,
        requiredScore: null,
        requiredDurationSeconds: null,
        learnerTurns: 4,
        requiredTurns: 10,
        endedAt: "2026-11-17T10:00:00.000Z",
      },
    });
    expect(screen.getByTestId("roleplay-short-attempt")).toHaveTextContent(
      "That attempt was too short to count (4 of 10 turns). Start again when you're ready.",
    );
    expect(screen.getByText("Start roleplay").closest("button")).toBeEnabled();
  });

  it("locks a post until the paired pre is submitted", () => {
    renderTurns({
      assessment: assessment({
        phase: "POST",
        preAssessment: { title: "Baseline call", submitted: false },
      }),
    });
    expect(screen.getByTestId("roleplay-post-locked")).toHaveTextContent(
      "Complete the pre-assessment, Baseline call, first.",
    );
    const start = screen.getByText("Start roleplay").closest("button") as HTMLButtonElement;
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(mockStartSimulation).not.toHaveBeenCalled();
  });

  it("opens a post once its pre is submitted", () => {
    renderTurns({
      assessment: assessment({
        phase: "POST",
        preAssessment: { title: "Baseline call", submitted: true },
      }),
    });
    expect(screen.queryByTestId("roleplay-post-locked")).not.toBeInTheDocument();
    expect(screen.getByText("Start roleplay").closest("button")).toBeEnabled();
  });

  it("shows only 'Submitted' when results are hidden: no score, no report", () => {
    renderTurns(
      {
        assessmentSubmittedAt: "2026-10-26T09:00:00.000Z",
        lastScenarioSessionId: null,
        assessment: assessment({ phase: "PRE", showResults: false, resultsHidden: true }),
      },
      true,
    );
    expect(screen.getByTestId("roleplay-assessment-results-hidden")).toHaveTextContent(
      "Submitted. Your trainer will review your results.",
    );
    expect(screen.queryByTestId("session-log-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("roleplay-assessment-submitted")).not.toBeInTheDocument();
    expect(screen.queryByTestId("play-icon")).not.toBeInTheDocument();
  });
});
