import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work, and a mock registered after
// another import that pulls it in arrives too late.
import "@constants";

const h = vi.hoisted(() => ({
  overview: vi.fn(),
  counts: vi.fn(),
  access: { current: { canEdit: true } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideOverviewQuery: (args: { days: number }) => h.overview(args),
  useGetAllyGuideAlertCountsQuery: () => h.counts(),
  usePromoteAllyGuideReleaseMutation: () => [vi.fn(), { isLoading: false }],
  useStopAllyGuideCanaryMutation: () => [vi.fn(), { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { OverviewTab } from "../OverviewTab";

const overview = (overrides: Record<string, unknown> = {}) => ({
  days: 7,
  turns: { total: 1240, completed: 1200, failed: 30, interrupted: 10, successRate: 0.9677 },
  threads: 310,
  timeToFirstTokenMs: [
    { channel: "text", turns: 1000, p50: 840, p95: 2100 },
    { channel: "voice", turns: 240, p50: 1900, p95: 4200 },
  ],
  safety: { crises: 3, crisisReplies: 3, careEntries: 12, refusals: 7, restarts: 2 },
  cache: { readTokens: 9_000_000, uncachedInputTokens: 3_000_000, ratio: 0.75 },
  cost: { totalUsd: 12.3456, perThreadUsd: 0.0398 },
  release: { id: "rel-3", version: 3, promotedAt: "2026-10-20T09:00:00.000Z" },
  canary: null,
  arms: [],
  ...overrides,
});

const loaded = (data: unknown) => ({
  currentData: data,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
});

describe("OverviewTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.overview.mockReturnValue(loaded(overview()));
    h.counts.mockReturnValue({ data: { open: 2, total: 9 }, isLoading: false, isError: false });
    h.access.current = { canEdit: true };
  });

  describe("the open-alerts tile", () => {
    it("shows how many alerts are open out of all raised, and opens the Alerts tab", () => {
      const onOpenAlerts = vi.fn();
      render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={onOpenAlerts} />);

      const tile = screen.getByTestId("tile-alerts");
      expect(tile).toHaveTextContent("2");
      expect(tile).toHaveTextContent("of 9 raised in all");
      fireEvent.click(within(tile).getByRole("button", { name: "Review alerts" }));
      expect(onOpenAlerts).toHaveBeenCalledTimes(1);
    });

    it("says nothing needs attention at zero open", () => {
      h.counts.mockReturnValue({ data: { open: 0, total: 4 }, isLoading: false, isError: false });
      render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

      expect(screen.getByTestId("tile-alerts")).toHaveTextContent("Nothing needs attention");
    });

    it("says it could not load, without taking the rest of the Overview down", () => {
      h.counts.mockReturnValue({ data: undefined, isLoading: false, isError: true });
      render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

      expect(screen.getByTestId("tile-alerts")).toHaveTextContent("Could not load the alerts");
      expect(screen.getByTestId("tile-turns")).toHaveTextContent("1.2k");
    });
  });

  it("mentions the canary on the release tile when one is running", () => {
    h.overview.mockReturnValue(
      loaded(overview({ canary: { id: "rel-4", version: 4, percent: 20 } })),
    );
    render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

    expect(screen.getByTestId("tile-release-canary")).toHaveTextContent("Canary: v4 at 20%");
  });

  it("shows the health tiles with the figures in words and units", () => {
    render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

    expect(screen.getByTestId("tile-turns")).toHaveTextContent("1.2k");
    expect(screen.getByTestId("tile-turns")).toHaveTextContent("in 310 conversations");
    expect(screen.getByTestId("tile-success")).toHaveTextContent("96.8%");
    expect(screen.getByTestId("tile-success")).toHaveTextContent("30 failed · 10 interrupted");
    expect(screen.getByTestId("tile-cache")).toHaveTextContent("75.0%");
    expect(screen.getByTestId("tile-cost")).toHaveTextContent("$12.35");
    expect(screen.getByTestId("tile-cost")).toHaveTextContent("$0.04 per conversation");
  });

  it("shows the live release and takes you to the Releases tab from it", () => {
    const onOpenReleases = vi.fn();
    render(<OverviewTab onOpenReleases={onOpenReleases} onOpenAlerts={vi.fn()} />);

    expect(screen.getByTestId("tile-release")).toHaveTextContent("v3");
    expect(screen.getByTestId("tile-release")).toHaveTextContent("Live since");

    fireEvent.click(screen.getByRole("button", { name: "Open releases" }));
    expect(onOpenReleases).toHaveBeenCalledTimes(1);
  });

  it("says plainly when there is no live release, because Ally cannot answer without one", () => {
    h.overview.mockReturnValue(loaded(overview({ release: null })));
    render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

    expect(screen.getByTestId("tile-release")).toHaveTextContent("No live release");
    expect(screen.getByTestId("tile-release")).toHaveTextContent("cannot answer");
  });

  it("tabulates time to first token by channel, in milliseconds then seconds", () => {
    render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

    const text = screen.getByTestId("ttft-row-text");
    expect(text).toHaveTextContent("Text");
    expect(text).toHaveTextContent("840 ms");
    expect(text).toHaveTextContent("2.10 s");
    const voice = screen.getByTestId("ttft-row-voice");
    expect(voice).toHaveTextContent("Voice");
    expect(voice).toHaveTextContent("1.90 s");
    expect(voice).toHaveTextContent("4.20 s");
  });

  it("says there were no timed turns rather than drawing an empty table", () => {
    h.overview.mockReturnValue(loaded(overview({ timeToFirstTokenMs: [] })));
    render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

    expect(screen.getByTestId("ally-ttft-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("ally-ttft-table")).not.toBeInTheDocument();
  });

  it("shows the five safety counts, and nothing a learner said", () => {
    render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

    const safety = screen.getByTestId("ally-safety");
    expect(within(safety).getByTestId("safety-crises")).toHaveTextContent("3");
    expect(within(safety).getByTestId("safety-crisisReplies")).toHaveTextContent("3");
    expect(within(safety).getByTestId("safety-careEntries")).toHaveTextContent("12");
    expect(within(safety).getByTestId("safety-refusals")).toHaveTextContent("7");
    expect(within(safety).getByTestId("safety-restarts")).toHaveTextContent("2");
    expect(
      screen.getByText("Counts only. The Overview never shows what a learner said."),
    ).toBeInTheDocument();
  });

  describe("the 7 / 30 day window", () => {
    it("asks for the last 7 days first", () => {
      render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

      expect(h.overview).toHaveBeenLastCalledWith({ days: 7 });
      expect(screen.getByRole("button", { name: "Last 7 days" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("switches to 30 days and asks for them", () => {
      render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));

      expect(h.overview).toHaveBeenLastCalledWith({ days: 30 });
      expect(screen.getByText("The last 30 days, up to now.")).toBeInTheDocument();
    });

    it("never shows the 7-day figures under a 30-day label while the new window loads", () => {
      h.overview.mockImplementation(({ days }: { days: number }) =>
        days === 7
          ? loaded(overview())
          : { currentData: undefined, isError: false, error: undefined, refetch: vi.fn() },
      );
      render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);
      expect(screen.getByTestId("tile-turns")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));

      expect(screen.queryByTestId("tile-turns")).not.toBeInTheDocument();
      expect(screen.getByTestId("ally-overview-loading")).toBeInTheDocument();
    });
  });

  describe("states", () => {
    it("shows a skeleton while the first load is in flight", () => {
      h.overview.mockReturnValue(loaded(undefined));
      render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

      expect(screen.getByTestId("ally-overview-loading")).toBeInTheDocument();
    });

    it("tells a failure from a quiet week, and retries", () => {
      const refetch = vi.fn();
      h.overview.mockReturnValue({
        currentData: undefined,
        isError: true,
        error: { status: 500 },
        refetch,
      });
      render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

      expect(screen.getByTestId("ally-load-failed")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();
    });

    it("tells a missing permission from a failure, with no pointless retry", () => {
      h.overview.mockReturnValue({
        currentData: undefined,
        isError: true,
        error: { status: 403 },
        refetch: vi.fn(),
      });
      render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

      expect(screen.getByTestId("ally-forbidden")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });

    it("keeps the tiles and explains an empty window instead of showing a table of nothing", () => {
      h.overview.mockReturnValue(
        loaded(
          overview({
            turns: { total: 0, completed: 0, failed: 0, interrupted: 0, successRate: null },
            threads: 0,
            timeToFirstTokenMs: [],
            cache: { readTokens: 0, uncachedInputTokens: 0, ratio: null },
            cost: { totalUsd: 0, perThreadUsd: null },
          }),
        ),
      );
      render(<OverviewTab onOpenReleases={vi.fn()} onOpenAlerts={vi.fn()} />);

      expect(screen.getByText("No Ally conversations in this window yet")).toBeInTheDocument();
      // Nothing to measure is a dash, not 0% and not NaN.
      expect(screen.getByTestId("tile-success")).toHaveTextContent("—");
      expect(screen.getByTestId("tile-cache")).toHaveTextContent("—");
      expect(screen.getByTestId("tile-cost")).toHaveTextContent("$0.00");
      expect(screen.queryByTestId("ally-safety")).not.toBeInTheDocument();
      // The live release is still worth knowing on a quiet week.
      expect(screen.getByTestId("tile-release")).toHaveTextContent("v3");
    });
  });
});
