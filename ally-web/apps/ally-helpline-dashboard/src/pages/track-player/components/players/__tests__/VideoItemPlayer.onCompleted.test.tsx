import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VideoItemPlayer } from "../VideoItemPlayer";
import { StartVideoItemPayload, TrackItemType } from "../../../../../types/tracks";

const { reportVideoProgress } = vi.hoisted(() => ({ reportVideoProgress: vi.fn() }));

vi.mock("@assets", () => ({
  TickGreenBackground: () => <span data-testid="tick-icon" />,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  ProgressVideoPlayer: () => <div data-testid="progress-video-player" />,
}));

vi.mock("@api", () => ({
  useReportVideoProgressMutation: () => [reportVideoProgress],
}));

vi.mock("@hooks", async () => {
  const actual = await vi.importActual<typeof import("../../../../../hooks/useVideoWatchProgress")>(
    "../../../../../hooks/useVideoWatchProgress",
  );
  return { useVideoWatchProgress: actual.useVideoWatchProgress };
});

const payload: StartVideoItemPayload = {
  type: TrackItemType.VIDEO,
  trackItemProgressId: "progress-1",
  // "loom" renders the manual player with "Mark as watched".
  source: "loom",
  url: "https://example.com/video.mp4",
  durationSeconds: 300,
  requiredWatchPct: 50,
  maxWatchedPct: 60,
};

const completion = {
  completed: true,
  unlockedItemIds: [],
  sectionCompleted: false,
  trackCompleted: false,
  maxWatchedPct: 100,
};

describe("VideoItemPlayer — optional onCompleted (guided journey)", () => {
  beforeEach(() => {
    reportVideoProgress.mockReset();
  });

  it("calls onCompleted once when a report first comes back completed", async () => {
    reportVideoProgress.mockReturnValue({ unwrap: () => Promise.resolve(completion) });
    const onCompleted = vi.fn();
    render(
      <VideoItemPlayer
        payload={payload}
        itemId="item-1"
        trackId="track-1"
        alreadyCompleted={false}
        onCompleted={onCompleted}
      />,
    );

    fireEvent.click(screen.getByText("Mark as watched"));

    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
    expect(onCompleted).toHaveBeenCalledWith(completion);
  });

  it("does not call it for a report that isn't complete", async () => {
    reportVideoProgress.mockReturnValue({
      unwrap: () => Promise.resolve({ ...completion, completed: false }),
    });
    const onCompleted = vi.fn();
    render(
      <VideoItemPlayer
        payload={payload}
        itemId="item-1"
        trackId="track-1"
        alreadyCompleted={false}
        onCompleted={onCompleted}
      />,
    );

    fireEvent.click(screen.getByText("Mark as watched"));

    await waitFor(() => expect(reportVideoProgress).toHaveBeenCalled());
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it("works exactly as before when onCompleted is absent (classic)", async () => {
    reportVideoProgress.mockReturnValue({ unwrap: () => Promise.resolve(completion) });
    render(
      <VideoItemPlayer
        payload={payload}
        itemId="item-1"
        trackId="track-1"
        alreadyCompleted={false}
      />,
    );

    fireEvent.click(screen.getByText("Mark as watched"));

    await waitFor(() =>
      expect(reportVideoProgress).toHaveBeenCalledWith({
        itemId: "item-1",
        trackId: "track-1",
        watchedPct: 100,
      }),
    );
  });
});
