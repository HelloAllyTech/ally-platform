import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ decision: vi.fn() }));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideCanaryDecisionQuery: () => h.decision(),
}));

// eslint-disable-next-line import/first
import { CanaryDecision } from "../CanaryDecision";

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });

const status = (decision: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  canary: { id: "rel-4", version: 4, percent: 10, authorKind: "curator" },
  stage: 2,
  promotesAutomatically: false,
  evidence: { daysRunning: 3, ga: null, canary: null, trusted: ["warmth"] },
  decision: {
    action: "wait",
    emergency: false,
    reasons: ["Only 3 days of evidence"],
    ready: false,
    thresholds: {
      min_days: { need: 7, have: 3, met: false },
      canary_threads: { need: 30, have: 41, met: true },
    },
    criteria: [{ id: "warmth", gaRate: 0.12, canaryRate: 0.08, verdict: "better" }],
    guard: { status: "pass", reason: "" },
    ...decision,
  },
  ...extra,
});

describe("CanaryDecision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.decision.mockReturnValue(ok(status()));
  });

  it("renders nothing when no canary is running", () => {
    h.decision.mockReturnValue(ok({ canary: null }));
    const { container } = render(<CanaryDecision />);

    expect(container).toBeEmptyDOMElement();
  });

  it("states the verdict and its reasons", () => {
    render(<CanaryDecision />);

    expect(screen.getByTestId("canary-verdict")).toHaveTextContent(
      "The pipeline's verdict: Keep waiting.",
    );
    expect(screen.getByTestId("canary-reasons")).toHaveTextContent("Only 3 days of evidence");
    expect(screen.getByTestId("canary-not-ready")).toBeInTheDocument();
  });

  it("says a promote verdict is advice at stage 2, and acts on its own at stage 3", () => {
    h.decision.mockReturnValue(ok(status({ action: "promote", ready: true })));
    const { unmount } = render(<CanaryDecision />);
    expect(screen.getByTestId("canary-stage")).toHaveTextContent(
      "the pipeline advises and a person promotes",
    );
    expect(screen.getByTestId("canary-stage")).toHaveTextContent("Running for 3 days.");
    expect(screen.queryByTestId("canary-not-ready")).not.toBeInTheDocument();
    unmount();

    h.decision.mockReturnValue(
      ok(status({ action: "promote", ready: true }, { stage: 3, promotesAutomatically: true })),
    );
    render(<CanaryDecision />);
    expect(screen.getByTestId("canary-stage")).toHaveTextContent("promotes on its own");
  });

  it("calls out a safety revert as an emergency", () => {
    h.decision.mockReturnValue(
      ok(status({ action: "revert", emergency: true, reasons: ["Safety failures rose"] })),
    );
    render(<CanaryDecision />);

    expect(screen.getByTestId("canary-emergency")).toHaveTextContent("Revert now");
    expect(screen.getByTestId("canary-verdict")).toHaveTextContent("Revert");
  });

  it("shows every threshold with what it needs against what it has", () => {
    render(<CanaryDecision />);

    const days = screen.getByTestId("canary-threshold-min_days");
    expect(days).toHaveTextContent("Min days");
    expect(days).toHaveTextContent("7");
    expect(days).toHaveTextContent("3");
    expect(days).toHaveTextContent("Not yet");
    expect(screen.getByTestId("canary-threshold-canary_threads")).toHaveTextContent("Met");
  });

  it("shows only the criteria the judges are trusted on, as live against canary failure rates", () => {
    render(<CanaryDecision />);

    const warmth = screen.getByTestId("canary-criterion-warmth");
    expect(warmth).toHaveTextContent("12.0%");
    expect(warmth).toHaveTextContent("8.0%");
    expect(warmth).toHaveTextContent("Canary better");
  });

  it("says plainly when no criterion is trusted yet", () => {
    h.decision.mockReturnValue(ok(status({ criteria: [] })));
    render(<CanaryDecision />);

    expect(screen.getByTestId("canary-no-criteria")).toHaveTextContent(
      "No criterion is trusted yet",
    );
    expect(screen.queryByTestId("canary-criteria")).not.toBeInTheDocument();
  });

  it("says where the learning guard stands, with its reason", () => {
    h.decision.mockReturnValue(
      ok(status({ guard: { status: "fail", reason: "Quiz passing fell 9 points." } })),
    );
    render(<CanaryDecision />);

    expect(screen.getByTestId("canary-guard")).toHaveTextContent("Learning guard: failed.");
    expect(screen.getByTestId("canary-guard")).toHaveTextContent("Quiz passing fell 9 points.");
  });

  it("fails alone, with a retry, and loads quietly", () => {
    const refetch = vi.fn();
    h.decision.mockReturnValue({ isLoading: false, isError: true, error: {}, refetch });
    const { unmount } = render(<CanaryDecision />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
    unmount();

    h.decision.mockReturnValue({ isLoading: true });
    render(<CanaryDecision />);
    expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
  });
});
