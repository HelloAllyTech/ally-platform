import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ config: vi.fn() }));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideThreadConfigQuery: (id: string) => h.config(id),
}));

// eslint-disable-next-line import/first
import { EffectiveConfigPanel } from "../EffectiveConfigPanel";

const entry = (overrides: Record<string, unknown>) => ({
  key: "releaseWindowMaxTurns",
  group: "Steering",
  value: 6,
  source: "release",
  chain: [{ layer: "release", value: 6 }],
  releaseValue: 6,
  unit: "turns",
  description: "How many turns a release window stays open.",
  overridableBy: ["org", "course"],
  pinned: false,
  learnerLever: null,
  pending: null,
  ...overrides,
});

const EXPLANATION = {
  threadId: "th-1",
  epoch: 3,
  epochStartedAt: "2026-10-23T09:00:00.000Z",
  releaseId: "rel-3",
  releaseVersion: 3,
  nextReleaseId: null,
  overridesPending: false,
  runtime: {
    mode: "CARE",
    tier: "premium",
    model: "claude-sonnet-5-5",
    guidance: "drive",
    visitor: false,
  },
  entries: [
    entry({}),
    entry({
      key: "nudgeAfterDays",
      value: 5,
      releaseValue: 3,
      source: "org",
      unit: "days",
      group: "Steering",
      chain: [
        { layer: "release", value: 3 },
        { layer: "org", value: 5 },
      ],
      description: "Days of quiet before one nudge.",
    }),
    entry({
      key: "prose.maxWords.lead",
      group: "Conversation",
      value: 40,
      releaseValue: 90,
      source: "runtime",
      unit: "words",
      chain: [
        { layer: "release", value: 90 },
        { layer: "runtime", value: 40, reason: "mode CARE" },
      ],
      description: "Words per reply.",
    }),
    entry({
      key: "sideQuests",
      group: "Side quests",
      value: true,
      releaseValue: true,
      unit: null,
      pending: { value: false, source: "course" },
      description: "Whether side quests are offered.",
    }),
  ],
  ignored: [],
};

const open = () => fireEvent.click(screen.getByRole("button", { name: "Show effective config" }));

describe("EffectiveConfigPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.config.mockReturnValue({
      data: EXPLANATION,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("starts shut and asks the server nothing until it is opened", () => {
    render(<EffectiveConfigPanel threadId="th-1" />);

    expect(h.config).not.toHaveBeenCalled();
    expect(screen.queryByTestId("effective-config")).not.toBeInTheDocument();

    open();

    expect(h.config).toHaveBeenCalledWith("th-1");
    expect(screen.getByTestId("effective-config")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide effective config" })).toBeInTheDocument();
  });

  it("says which epoch and release the conversation is on, and what is running it", () => {
    render(<EffectiveConfigPanel threadId="th-1" />);
    open();

    expect(screen.getByTestId("effective-config-epoch")).toHaveTextContent(
      "Epoch 3, on release v3",
    );
    const body = screen.getByTestId("effective-config");
    expect(body).toHaveTextContent("Care");
    expect(body).toHaveTextContent("premium");
    expect(body).toHaveTextContent("claude-sonnet-5-5");
    expect(body).toHaveTextContent("I'll drive");
  });

  it("shows only what differs from the release by default, each with the level it came from", () => {
    render(<EffectiveConfigPanel threadId="th-1" />);
    open();

    const org = screen.getByTestId("effective-row-nudgeAfterDays");
    expect(org).toHaveTextContent("5 days");
    expect(org).toHaveTextContent("Organisation");
    expect(org).toHaveTextContent("3 days");
    const runtime = screen.getByTestId("effective-row-prose.maxWords.lead");
    expect(runtime).toHaveTextContent("Safety mode");
    expect(runtime).toHaveTextContent("mode CARE");
    expect(screen.queryByTestId("effective-row-releaseWindowMaxTurns")).not.toBeInTheDocument();
  });

  it("marks a value that will change at the next epoch, and says the epoch will pick it up", () => {
    render(<EffectiveConfigPanel threadId="th-1" />);
    open();

    expect(screen.getByTestId("effective-row-sideQuests")).toHaveTextContent(
      "Next epoch: No (Course)",
    );
  });

  it("shows every setting when asked, including the ones that match the release", () => {
    render(<EffectiveConfigPanel threadId="th-1" />);
    open();

    fireEvent.click(screen.getByLabelText("Only values that differ from the release"));

    expect(screen.getByTestId("effective-row-releaseWindowMaxTurns")).toHaveTextContent("Release");
  });

  it("says nothing differs when every setting uses the release value", () => {
    h.config.mockReturnValue({
      data: { ...EXPLANATION, entries: [entry({})] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<EffectiveConfigPanel threadId="th-1" />);
    open();

    expect(screen.getByTestId("effective-all-same")).toBeInTheDocument();
  });

  it("says when a newer release will take over and when a setting changed after the epoch began", () => {
    h.config.mockReturnValue({
      data: { ...EXPLANATION, nextReleaseId: "rel-4", overridesPending: true },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<EffectiveConfigPanel threadId="th-1" />);
    open();

    expect(screen.getByTestId("effective-next-release")).toHaveTextContent(
      "moves to it at its next epoch",
    );
    expect(screen.getByTestId("effective-overrides-pending")).toHaveTextContent(
      "applies from the next epoch",
    );
  });

  it("lists stored values Ally refused to apply", () => {
    h.config.mockReturnValue({
      data: {
        ...EXPLANATION,
        ignored: [{ layer: "org", key: "oldKey", value: 1, why: "no longer a setting" }],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<EffectiveConfigPanel threadId="th-1" />);
    open();

    const ignored = screen.getByTestId("effective-ignored");
    expect(within(ignored).getByText(/oldKey/)).toBeInTheDocument();
    expect(ignored).toHaveTextContent("no longer a setting");
  });

  it("shows a skeleton while loading, and a failure with a retry", () => {
    h.config.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { unmount } = render(<EffectiveConfigPanel threadId="th-1" />);
    open();
    expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
    unmount();

    const refetch = vi.fn();
    h.config.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 500 },
      refetch,
    });
    render(<EffectiveConfigPanel threadId="th-1" />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("contains no learner text, by construction: only keys, values, levels and reasons", () => {
    render(<EffectiveConfigPanel threadId="th-1" />);
    open();

    expect(screen.getByTestId("effective-config")).not.toHaveTextContent(
      /transcript|message text/i,
    );
  });
});
