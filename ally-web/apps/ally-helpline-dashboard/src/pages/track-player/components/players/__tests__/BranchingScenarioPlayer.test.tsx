import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BranchingScenarioPlayer } from "../BranchingScenarioPlayer";
import { StartBranchingScenarioItemPayload, TrackItemType } from "../../../../../types/tracks";

const recordResult = vi.fn();
const startItem = vi.fn();

vi.mock("@api", () => ({
  useRecordBranchingResultMutation: () => [recordResult, { isLoading: false }],
  useStartTrackItemMutation: () => [startItem, { isLoading: false }],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const payload = (
  overrides: Partial<StartBranchingScenarioItemPayload> = {},
): StartBranchingScenarioItemPayload => ({
  type: TrackItemType.BRANCHING_SCENARIO,
  trackItemProgressId: "p1",
  intro: "Intro text",
  startNodeId: "s",
  passScore: 60,
  maxAttempts: 2,
  attemptsUsed: 0,
  bestScore: null,
  completed: false,
  endingsReached: [],
  exhausted: false,
  nextRoundAt: null,
  recap: [],
  nodes: [
    {
      id: "s",
      title: "Start",
      text: "Scene one",
      image: { url: "https://x/y.png", alt: "A room" },
      choices: [
        { id: "c1", text: "Listen", nextNodeId: "mid" },
        { id: "c2", text: "Interrupt", nextNodeId: "bad" },
      ],
    },
    { id: "mid", text: "Scene two", choices: [{ id: "c3", text: "Ask", nextNodeId: "good" }] },
    { id: "good", text: "Went well", outcome: "POSITIVE", takeaway: "Listening works" },
    { id: "bad", text: "Went badly", outcome: "NEGATIVE" },
  ],
  ...overrides,
});

const result = (overrides = {}) => ({
  endingNodeId: "good",
  score: 100,
  passScore: 60,
  passed: true,
  attemptsUsed: 1,
  maxAttempts: 2,
  attemptsLeft: 1,
  bestScore: 100,
  endingsReached: ["good"],
  itemCompleted: true,
  exhausted: false,
  nextRoundAt: null,
  recap: [],
  completion: {
    completed: true,
    unlockedItemIds: [],
    sectionCompleted: false,
    trackCompleted: false,
  },
  ...overrides,
});

const renderPlayer = (p = payload()) => {
  const onCompleted = vi.fn();
  const onRequestNext = vi.fn();
  const onBackToCourse = vi.fn();
  render(
    <BranchingScenarioPlayer
      payload={p}
      itemId="item-1"
      onCompleted={onCompleted}
      onRequestNext={onRequestNext}
      onBackToCourse={onBackToCourse}
    />,
  );
  return { onCompleted, onRequestNext, onBackToCourse };
};

const mockResolve = (value: unknown) =>
  recordResult.mockReturnValue({ unwrap: () => Promise.resolve(value) });

describe("BranchingScenarioPlayer", () => {
  beforeEach(() => {
    recordResult.mockReset();
    startItem.mockReset();
    vi.useRealTimers();
  });

  it("renders the intro, scene, image alt and choices as buttons", () => {
    renderPlayer();
    expect(screen.getByText("Intro text")).toBeTruthy();
    expect(screen.getByText("Scene one")).toBeTruthy();
    expect(screen.getByAltText("A room")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Listen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Interrupt" })).toBeTruthy();
  });

  it("advances on a choice and shows the trail chip without posting", () => {
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    expect(screen.getByText("Scene two")).toBeTruthy();
    expect(screen.getByText(/tracks2.branching.youChose/)).toBeTruthy();
    expect(recordResult).not.toHaveBeenCalled();
  });

  it("posts the path at an ending and offers Continue when passed", async () => {
    mockResolve(result());
    const { onCompleted, onRequestNext } = renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() =>
      expect(recordResult).toHaveBeenCalledWith({ itemId: "item-1", path: ["c1", "c3"] }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "tracks2.branching.continueCourse" }),
    );
    expect(onCompleted).toHaveBeenCalled();
    expect(onRequestNext).toHaveBeenCalled();
    expect(screen.getByText("Listening works")).toBeTruthy();
  });

  it("offers Try again on a fail with attempts left and restarts", async () => {
    mockResolve(
      result({
        score: 0,
        passed: false,
        itemCompleted: false,
        attemptsLeft: 1,
        endingNodeId: "bad",
      }),
    );
    const { onCompleted } = renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    fireEvent.click(await screen.findByRole("button", { name: "tracks2.branching.tryAgain" }));
    expect(onCompleted).not.toHaveBeenCalled();
    expect(screen.getByText("Scene one")).toBeTruthy();
  });

  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const recap = [
    { endingNodeId: "bad", score: 0, at: "2026-10-21T08:00:00Z" },
    { endingNodeId: "good", score: 40, at: "2026-10-21T08:05:00Z" },
  ];
  const resolveStart = (value: unknown) =>
    startItem.mockReturnValue({ unwrap: () => Promise.resolve(value) });

  it("shows the recap and countdown when the item opens exhausted", () => {
    const { onRequestNext, onBackToCourse } = renderPlayer(
      payload({ exhausted: true, nextRoundAt: inHours(23.5), recap }),
    );
    expect(
      screen.getByRole("heading", { name: "tracks2.branching.exhaustedHeading" }),
    ).toBeTruthy();
    expect(screen.getByText(/newRoundIn.*waitHour.*23/)).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Went badly");
    expect(rows[0].textContent).toContain("tracks2.branching.outcome.NEGATIVE");
    expect(rows[1].textContent).toContain("Listening works");
    expect(rows[1].textContent).toContain("recapScore");
    expect(screen.queryByRole("button", { name: "tracks2.branching.startNewRound" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Listen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "tracks2.branching.backToCourse" }));
    // Leaves to the overview; it must not advance to the next item, which is still locked.
    expect(onBackToCourse).toHaveBeenCalled();
    expect(onRequestNext).not.toHaveBeenCalled();
  });

  it("omits scores from the recap when there is no pass mark", () => {
    renderPlayer(payload({ passScore: null, exhausted: true, nextRoundAt: inHours(2), recap }));
    expect(screen.queryByText(/recapScore/)).toBeNull();
  });

  it("switches to the exhausted screen after the final failed run", async () => {
    mockResolve(
      result({
        passed: false,
        itemCompleted: false,
        attemptsLeft: 0,
        score: 0,
        endingNodeId: "bad",
        exhausted: true,
        nextRoundAt: inHours(24),
        recap,
      }),
    );
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    expect(
      await screen.findByRole("heading", { name: "tracks2.branching.exhaustedHeading" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "tracks2.branching.tryAgain" })).toBeNull();
  });

  it("re-fetches the start payload on a 400 'used all attempts' and shows the recap", async () => {
    recordResult.mockReturnValue({
      unwrap: () =>
        Promise.reject({
          status: 400,
          data: { message: "You have used all attempts for this scenario." },
        }),
    });
    resolveStart(payload({ exhausted: true, nextRoundAt: inHours(10), recap }));
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    expect(
      await screen.findByRole("heading", { name: "tracks2.branching.exhaustedHeading" }),
    ).toBeTruthy();
    expect(startItem).toHaveBeenCalledWith({ itemId: "item-1" });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("falls back to the plain message when the re-fetch fails", async () => {
    recordResult.mockReturnValue({
      unwrap: () =>
        Promise.reject({
          status: 400,
          data: { message: "You have used all attempts for this scenario." },
        }),
    });
    startItem.mockReturnValue({ unwrap: () => Promise.reject(new Error("offline")) });
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    expect(await screen.findByText("tracks2.branching.attemptsExhausted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "tracks2.branching.tryAgain" })).toBeNull();
  });

  it("offers a new round once nextRoundAt passes and restarts from the first scene", async () => {
    vi.useFakeTimers();
    renderPlayer(payload({ exhausted: true, nextRoundAt: inHours(0.01), recap }));
    expect(screen.queryByRole("button", { name: "tracks2.branching.startNewRound" })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByText("tracks2.branching.newRoundReady")).toBeTruthy();
    resolveStart(payload({ attemptsUsed: 0 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "tracks2.branching.startNewRound" }));
    });
    expect(startItem).toHaveBeenCalledWith({ itemId: "item-1" });
    expect(screen.getByText("Scene one")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Listen" })).toBeTruthy();
  });

  it("shows no score UI when there is no pass mark", async () => {
    mockResolve(result({ passScore: null }));
    renderPlayer(payload({ passScore: null }));
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    await screen.findByRole("button", { name: "tracks2.branching.continueCourse" });
    expect(screen.queryByText(/scoreVsPass/)).toBeNull();
  });
});
