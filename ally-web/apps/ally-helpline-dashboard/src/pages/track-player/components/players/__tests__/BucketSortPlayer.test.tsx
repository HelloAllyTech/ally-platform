import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BucketSortPlayer } from "../BucketSortPlayer";
import { StartBucketSortItemPayload, TrackItemType } from "../../../../../types/tracks";

const place = vi.fn();
const restart = vi.fn();
const startItem = vi.fn();

vi.mock("@api", () => ({
  usePlaceBucketSortItemMutation: () => [place, { isLoading: false }],
  useRestartBucketSortMutation: () => [restart, { isLoading: false }],
  useStartTrackItemMutation: () => [startItem, { isLoading: false }],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${JSON.stringify(opts)}` : key,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const payload = (): StartBucketSortItemPayload => ({
  type: TrackItemType.BUCKET_SORT,
  trackItemProgressId: "p1",
  rounds: 0,
  bestFirstTryPct: null,
  bucketSort: {
    buckets: [
      { id: "b1", label: "Helps" },
      { id: "b2", label: "Harms" },
    ],
    items: [
      { id: "i1", text: "Reflect feelings" },
      { id: "i2", text: "Give advice fast" },
    ],
    answered: {},
  },
});

const reply = (over: object) => ({
  sortItemId: "i1",
  correct: true,
  placedBucketId: "b1",
  correctBucketId: "b1",
  explanation: null,
  placedCount: 1,
  totalCount: 2,
  finished: false,
  firstTryPct: null,
  itemCompleted: false,
  completion: null,
  ...over,
});

describe("BucketSortPlayer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows instant feedback with the right bucket and explanation, then advances", async () => {
    place.mockReturnValue({
      unwrap: () =>
        Promise.resolve(
          reply({ correct: false, placedBucketId: "b2", explanation: "Because reasons" }),
        ),
    });
    render(
      <BucketSortPlayer
        payload={payload()}
        itemId="item"
        onCompleted={vi.fn()}
        onRequestNext={vi.fn()}
      />,
    );
    expect(screen.getByText("Reflect feelings")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/bucketAria.*Harms/));
    await waitFor(() => expect(screen.getByText("tracks2.bucketSort.notQuite")).toBeTruthy());
    expect(place).toHaveBeenCalledWith({ itemId: "item", sortItemId: "i1", bucketId: "b2" });
    expect(screen.getByText("Because reasons")).toBeTruthy();

    fireEvent.click(screen.getByText("tracks2.bucketSort.next"));
    expect(screen.getByText("Give advice fast")).toBeTruthy();
  });

  it("reports completion and shows results after the last item", async () => {
    const onCompleted = vi.fn();
    place.mockReturnValueOnce({ unwrap: () => Promise.resolve(reply({})) }).mockReturnValueOnce({
      unwrap: () =>
        Promise.resolve(
          reply({
            sortItemId: "i2",
            placedBucketId: "b2",
            correctBucketId: "b2",
            finished: true,
            completion: { itemCompleted: true },
          }),
        ),
    });
    render(
      <BucketSortPlayer
        payload={payload()}
        itemId="item"
        onCompleted={onCompleted}
        onRequestNext={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/bucketAria.*Helps/));
    await waitFor(() => screen.getByText("tracks2.bucketSort.correct"));
    fireEvent.click(screen.getByText("tracks2.bucketSort.next"));
    fireEvent.click(screen.getByLabelText(/bucketAria.*Harms/));
    await waitFor(() => screen.getByText("tracks2.bucketSort.seeResults"));
    // Held back so the celebration doesn't bury the last feedback and results.
    expect(onCompleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("tracks2.bucketSort.seeResults"));
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(screen.getByText("tracks2.bucketSort.resultsHeading")).toBeTruthy();
    expect(screen.getByText("tracks2.bucketSort.allRight")).toBeTruthy();
  });
});
