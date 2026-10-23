import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GuideCard } from "../../contract/wire";
import { ItemPlayerHost } from "../ItemPlayerHost";

const { startTrackItem, recordGameResult } = vi.hoisted(() => ({
  startTrackItem: vi.fn(),
  recordGameResult: vi.fn(),
}));

vi.mock("@api", () => ({
  useStartTrackItemMutation: () => [startTrackItem],
  useGetLearnTrackDetailQuery: () => ({ data: undefined }),
  useRecordGameResultMutation: () => [recordGameResult],
}));

vi.mock("@components", () => ({ FallbackUI: () => null }));
vi.mock("@components/error-boundary/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const completion = {
  completed: true,
  unlockedItemIds: [],
  sectionCompleted: false,
  trackCompleted: false,
};

const gameCard: GuideCard = {
  cardId: "k-game",
  kind: "course_item",
  presentation: "theatre",
  state: "ready",
  title: "Memory match",
  trackItem: { id: "item-game", type: "GAME", title: "Memory match" },
};

const resolvesTo = (payload: unknown) => ({ unwrap: () => Promise.resolve(payload) });

describe("ItemPlayerHost", () => {
  beforeEach(() => {
    startTrackItem.mockReset();
  });

  it("opens the item the classic way and a game claims completion exactly once", async () => {
    startTrackItem.mockReturnValue(
      resolvesTo({
        type: "GAME",
        trackItemProgressId: "p1",
        gameKey: "MEMORY_MATCH",
        intro: null,
        bestScore: null,
        playCount: 0,
        completion,
      }),
    );
    const onClaim = vi.fn();
    const props = {
      card: gameCard,
      trackId: "t1",
      threadId: "th1",
      onClose: vi.fn(),
      onLaunch: vi.fn(),
    };
    const { rerender } = render(<ItemPlayerHost {...props} onClaim={onClaim} />);

    await waitFor(() => expect(onClaim).toHaveBeenCalledTimes(1));
    expect(startTrackItem).toHaveBeenCalledWith({ itemId: "item-game" });
    expect(onClaim).toHaveBeenCalledWith("k-game", completion);

    // A parent re-render hands down new callbacks; the game's effect must not post again.
    const nextOnClaim = vi.fn();
    rerender(<ItemPlayerHost {...props} onClaim={nextOnClaim} onClose={vi.fn()} />);
    rerender(<ItemPlayerHost {...props} onClaim={nextOnClaim} onClose={vi.fn()} />);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(onClaim).toHaveBeenCalledTimes(1);
    expect(nextOnClaim).not.toHaveBeenCalled();
  });

  it("ignores a completion that isn't one", async () => {
    startTrackItem.mockReturnValue(
      resolvesTo({
        type: "GAME",
        trackItemProgressId: "p1",
        gameKey: "MEMORY_MATCH",
        intro: null,
        bestScore: null,
        playCount: 0,
        completion: { ...completion, completed: false },
      }),
    );
    const onClaim = vi.fn();
    render(
      <ItemPlayerHost
        card={gameCard}
        trackId="t1"
        threadId="th1"
        onClaim={onClaim}
        onClose={vi.fn()}
        onLaunch={vi.fn()}
      />,
    );
    await waitFor(() => expect(startTrackItem).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(onClaim).not.toHaveBeenCalled();
  });

  it("says what failed in Ally's voice, with Try again and the classic view", async () => {
    startTrackItem.mockReturnValueOnce({ unwrap: () => Promise.reject({ status: 500 }) });
    render(
      <ItemPlayerHost
        card={{
          ...gameCard,
          trackItem: { id: "item-a", type: "ARTICLE", title: "Opening a call" },
        }}
        trackId="t1"
        threadId="th1"
        onClaim={vi.fn()}
        onClose={vi.fn()}
        onLaunch={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("player-failed")).toHaveTextContent(
      "This article didn't load.",
    );
    expect(screen.getByRole("link", { name: "Open the classic view" })).toHaveAttribute(
      "href",
      "/track/t1/item/item-a",
    );
    startTrackItem.mockReturnValue({ unwrap: () => new Promise(() => undefined) });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(startTrackItem).toHaveBeenCalledTimes(2));
  });
});
