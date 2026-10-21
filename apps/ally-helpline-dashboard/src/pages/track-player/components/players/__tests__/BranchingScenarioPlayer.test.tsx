import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BranchingScenarioPlayer } from "../BranchingScenarioPlayer";
import { StartBranchingScenarioItemPayload, TrackItemType } from "../../../../../types/tracks";

const recordResult = vi.fn();

vi.mock("@api", () => ({
  useRecordBranchingResultMutation: () => [recordResult, { isLoading: false }],
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
  render(
    <BranchingScenarioPlayer
      payload={p}
      itemId="item-1"
      onCompleted={onCompleted}
      onRequestNext={onRequestNext}
    />,
  );
  return { onCompleted, onRequestNext };
};

const mockResolve = (value: unknown) =>
  recordResult.mockReturnValue({ unwrap: () => Promise.resolve(value) });

describe("BranchingScenarioPlayer", () => {
  beforeEach(() => recordResult.mockReset());

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

  it("shows the exhausted message when no attempts are left", async () => {
    mockResolve(result({ passed: false, itemCompleted: false, attemptsLeft: 0, score: 0 }));
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    expect(await screen.findByText("tracks2.branching.attemptsExhausted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "tracks2.branching.tryAgain" })).toBeNull();
  });

  it("treats a 400 'used all attempts' as exhausted", async () => {
    recordResult.mockReturnValue({
      unwrap: () =>
        Promise.reject({
          status: 400,
          data: { message: "You have used all attempts for this scenario." },
        }),
    });
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    expect(await screen.findByText("tracks2.branching.attemptsExhausted")).toBeTruthy();
  });

  it("shows no score UI when there is no pass mark", async () => {
    mockResolve(result({ passScore: null }));
    renderPlayer(payload({ passScore: null }));
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    await screen.findByRole("button", { name: "tracks2.branching.continueCourse" });
    expect(screen.queryByText(/scoreVsPass/)).toBeNull();
  });
});
