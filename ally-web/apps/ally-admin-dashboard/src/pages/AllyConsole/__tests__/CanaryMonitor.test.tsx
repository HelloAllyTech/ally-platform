import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  access: { current: { canEdit: true } as Record<string, boolean> },
  promote: vi.fn(),
  stop: vi.fn(),
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePromoteAllyGuideReleaseMutation: () => [h.promote, { isLoading: false }],
  useStopAllyGuideCanaryMutation: () => [h.stop, { isLoading: false }],
  // The verdict has its own suite; here it only has to stay out of the way.
  useGetAllyGuideCanaryDecisionQuery: () => ({
    data: { canary: null },
    isLoading: false,
    isError: false,
  }),
}));

// eslint-disable-next-line import/first
import { CanaryMonitor } from "../CanaryMonitor";

const arm = (overrides: Record<string, unknown> = {}) => ({
  arm: "ga",
  turns: 1000,
  threads: 250,
  failureRate: 0.03,
  ttftP50Ms: 1100,
  costPerThreadUsd: 0.12,
  crisisReplies: 4,
  careEntries: 10,
  refusals: 5,
  thumbsUp: 40,
  thumbsDown: 10,
  quizFirstAttempts: 40,
  quizFirstAttemptPassRate: 0.7,
  itemsCompletedPerThread: 2,
  ...overrides,
});

const LIVE = { id: "rel-3", version: 3, promotedAt: "2026-10-20T09:00:00.000Z" };
const CANARY = { id: "rel-4", version: 4, percent: 20 };

const GA = arm();
const CANARY_ARM = arm({
  arm: "canary",
  turns: 200,
  threads: 50,
  failureRate: 0.045,
  ttftP50Ms: 900,
  crisisReplies: 4,
});

const renderMonitor = (props: Record<string, unknown> = {}) =>
  render(
    <CanaryMonitor
      canary={CANARY}
      live={LIVE}
      arms={[GA, CANARY_ARM] as never}
      {...(props as object)}
    />,
  );

describe("CanaryMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    h.promote.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    h.stop.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("says no canary is running, and how to start one, when there is none", () => {
    renderMonitor({ canary: null, arms: [GA] });

    expect(screen.getByTestId("canary-none")).toHaveTextContent("No canary is running.");
    expect(screen.getByTestId("canary-none")).toHaveTextContent("start a canary from a draft");
    expect(screen.queryByTestId("canary-table")).not.toBeInTheDocument();
  });

  it("names the canary, its share and the live release it is compared with", () => {
    renderMonitor();

    expect(screen.getByTestId("canary-summary")).toHaveTextContent(
      "v4 is taking 20% of new conversations, and v3 serves the rest.",
    );
  });

  it("puts the live release first and the canary beside it", () => {
    renderMonitor();

    const headers = within(screen.getByTestId("canary-table")).getAllByRole("columnheader");
    expect(headers.map(header => header.textContent)).toEqual([
      "Measure",
      "Live v3",
      "Canary v4",
      "Canary compared with live",
    ]);
  });

  it("shows each measure in its own unit, with the difference signed", () => {
    renderMonitor();

    expect(screen.getByTestId("canary-row-failureRate")).toHaveTextContent("3.0%");
    expect(screen.getByTestId("canary-row-failureRate")).toHaveTextContent("4.5%");
    expect(screen.getByTestId("canary-diff-failureRate")).toHaveTextContent("+1.5 pts");
    expect(screen.getByTestId("canary-diff-ttftP50Ms")).toHaveTextContent("−200 ms");
    // Volumes are shown but never compared: the canary only takes its share.
    expect(screen.getByTestId("canary-row-turns")).toHaveTextContent("1.0k");
    expect(screen.getByTestId("canary-row-turns")).toHaveTextContent("200");
    expect(screen.getByTestId("canary-diff-turns")).toHaveTextContent("");
  });

  it("normalises counts per 100 turns so a small canary can sit beside live", () => {
    renderMonitor({
      arms: [GA, { ...CANARY_ARM, crisisReplies: 2 }] as never,
    });

    const row = screen.getByTestId("canary-row-crisisReplies");
    expect(row).toHaveTextContent("0.4");
    expect(row).toHaveTextContent("1.0");
    expect(screen.getByTestId("canary-diff-crisisReplies")).toHaveTextContent("+0.6 per 100 turns");
  });

  it("says which way is good in words for a screen reader, never by colour alone", () => {
    renderMonitor();

    expect(screen.getByTestId("canary-diff-failureRate")).toHaveTextContent("worse than live");
    expect(screen.getByTestId("canary-diff-ttftP50Ms")).toHaveTextContent("better than live");
  });

  it("shows learning beside engagement", () => {
    renderMonitor();

    expect(screen.getByTestId("canary-row-quizFirstAttemptPassRate")).toBeInTheDocument();
    expect(screen.getByTestId("canary-row-itemsCompletedPerThread")).toBeInTheDocument();
    expect(screen.getByTestId("canary-row-quizFirstAttempts")).toBeInTheDocument();
  });

  it("warns when engagement is up on the canary while quiz passing is lower", () => {
    renderMonitor({
      arms: [
        GA,
        { ...CANARY_ARM, itemsCompletedPerThread: 3, quizFirstAttemptPassRate: 0.5 },
      ] as never,
    });

    const warning = screen.getByTestId("canary-guard");
    expect(warning).toHaveTextContent("Engagement is up on the canary while quiz passing is lower");
    expect(warning).toHaveTextContent("50.0% against 70.0%");
    expect(warning).toHaveTextContent("40 graded first attempts");
  });

  it("does not warn when learning holds", () => {
    renderMonitor();

    expect(screen.queryByTestId("canary-guard")).not.toBeInTheDocument();
  });

  it("says plainly when the canary has too few turns, and withholds colour from the noise", () => {
    renderMonitor({ arms: [GA, { ...CANARY_ARM, turns: 8 }] as never });

    expect(screen.getByTestId("canary-too-few")).toHaveTextContent("8 turns");
    expect(screen.getByTestId("canary-too-few")).toHaveTextContent("Fewer than 20");
    const diff = screen.getByTestId("canary-diff-failureRate").querySelector("span");
    expect(diff?.className ?? "").not.toMatch(/text-(success|destructive)/);
    // And the guard stays quiet on so few turns.
    expect(screen.queryByTestId("canary-guard")).not.toBeInTheDocument();
  });

  it("says so when the canary has answered nothing yet", () => {
    renderMonitor({ arms: [GA] as never });

    expect(screen.getByTestId("canary-not-served")).toBeInTheDocument();
    expect(screen.getByTestId("canary-diff-failureRate")).toHaveTextContent("");
  });

  it("copes with a canary and no live arm, showing dashes", () => {
    renderMonitor({ arms: [CANARY_ARM] as never });

    expect(screen.getByTestId("canary-row-failureRate")).toHaveTextContent("—");
  });

  describe("promote and stop", () => {
    it("offers both to an admin who can edit, and a confirm before either happens", () => {
      renderMonitor();

      fireEvent.click(screen.getByRole("button", { name: "Promote…" }));
      expect(screen.getByRole("dialog", { name: "Promote v4 to live?" })).toBeInTheDocument();
      expect(h.promote).not.toHaveBeenCalled();
    });

    it("opens the stop dialog for the canary", () => {
      renderMonitor();

      fireEvent.click(screen.getByRole("button", { name: "Stop canary…" }));

      expect(screen.getByRole("dialog", { name: "Stop the canary v4?" })).toBeInTheDocument();
      expect(h.stop).not.toHaveBeenCalled();
    });

    it("hides both from an admin who can only view", () => {
      h.access.current = { canEdit: false };
      renderMonitor();

      expect(screen.queryByRole("button", { name: "Promote…" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Stop canary…" })).not.toBeInTheDocument();
      expect(screen.getByTestId("canary-table")).toBeInTheDocument();
    });
  });
});
