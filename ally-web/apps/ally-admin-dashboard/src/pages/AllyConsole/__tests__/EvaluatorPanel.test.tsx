import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  summary: vi.fn(),
  kappa: vi.fn(),
  rubric: vi.fn(),
  run: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  access: { current: { canEdit: true } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideEvaluatorSummaryQuery: () => h.summary(),
  useGetAllyGuideKappaQuery: () => h.kappa(),
  useGetAllyGuideRubricQuery: () => h.rubric(),
  useRunAllyGuideEvaluatorMutation: () => [h.run, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { EvaluatorPanel } from "../EvaluatorPanel";

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });

const SUMMARY = {
  nights: [
    {
      night: "2026-10-23",
      windows: 120,
      judged: 80,
      checkedOnly: 40,
      errors: 2,
      flagged: 9,
      safetyFlags: 3,
      disagreements: 5,
      costUsd: 1.2345,
    },
  ],
  checks: [{ id: "no_prompt_leak", failed: 2, applicable: 120 }],
  criteria: [{ id: "warmth", failed: 6, applicable: 80 }],
  spentTodayUsd: 0.4,
};

const kappaRow = (criterion: string, overrides: Record<string, unknown> = {}) => ({
  criterion,
  pairs: 40,
  agreement: 0.9,
  kappa: 0.72,
  trusted: true,
  reason: "κ 0.72 on 40 labelled windows",
  ...overrides,
});

const KAPPA = {
  threshold: 0.6,
  minPairs: 30,
  critic: [
    kappaRow("warmth"),
    kappaRow("grounding", {
      kappa: 0.41,
      agreement: 0.7,
      trusted: false,
      reason: "κ 0.41 is below 0.6",
    }),
    kappaRow("safety", {
      kappa: null,
      agreement: null,
      pairs: 4,
      trusted: false,
      reason: "only 4 labelled windows",
    }),
  ],
  verifier: [
    kappaRow("warmth", { kappa: 0.8 }),
    kappaRow("grounding"),
    kappaRow("safety", { kappa: null, agreement: null, pairs: 4, trusted: false }),
  ],
  trusted: ["warmth"],
  labelledReviews: 52,
};

const RUBRIC = {
  criteria: [
    {
      id: "warmth",
      label: "Warmth",
      pass: "Warm and calm.",
      fail: "Cold or chirpy.",
      safety: false,
    },
    {
      id: "grounding",
      label: "Grounding",
      pass: "Comes from the course.",
      fail: "Invents content.",
      safety: false,
    },
    {
      id: "safety",
      label: "Safety",
      pass: "Handles risk well.",
      fail: "Misses risk.",
      safety: true,
    },
  ],
  redTeamCategories: [],
};

describe("EvaluatorPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    h.summary.mockReturnValue(ok(SUMMARY));
    h.kappa.mockReturnValue(ok(KAPPA));
    h.rubric.mockReturnValue(ok(RUBRIC));
    h.run.mockReturnValue({ unwrap: () => Promise.resolve({ started: true, night: null }) });
  });

  describe("the nights", () => {
    it("shows each night's windows, judgements, flags and cost, counts only", () => {
      render(<EvaluatorPanel />);

      const row = screen.getByTestId("evaluator-night-row");
      expect(row).toHaveTextContent("2026-10-23");
      expect(row).toHaveTextContent("120");
      expect(row).toHaveTextContent("80");
      expect(row).toHaveTextContent("$1.23");
      expect(screen.getByTestId("evaluator-spent")).toHaveTextContent("Spent today: $0.40");
      expect(screen.getByTestId("ally-evaluator")).not.toHaveTextContent(
        /transcript|message text/i,
      );
    });

    it("says the evaluator has not judged a night yet", () => {
      h.summary.mockReturnValue(ok({ ...SUMMARY, nights: [] }));
      render(<EvaluatorPanel />);

      expect(screen.getByText("The evaluator has not judged a night yet.")).toBeInTheDocument();
    });

    it("names the criteria the judges failed by their labels, and the rule checks by id", () => {
      render(<EvaluatorPanel />);

      expect(screen.getByTestId("evaluator-checks")).toHaveTextContent("no_prompt_leak");
      expect(screen.getByTestId("evaluator-checks")).toHaveTextContent("2 of 120");
      expect(screen.getByTestId("evaluator-criteria")).toHaveTextContent("Warmth");
      expect(screen.getByTestId("evaluator-criteria")).toHaveTextContent("6 of 80");
    });

    it("tells a failed load from an empty one, with a retry", () => {
      const refetch = vi.fn();
      h.summary.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 500 },
        refetch,
      });
      render(<EvaluatorPanel />);

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();
    });

    it("shows a skeleton while loading", () => {
      h.summary.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      render(<EvaluatorPanel />);

      expect(screen.getAllByTestId("ally-loading").length).toBeGreaterThan(0);
    });
  });

  describe("whether the judges can be trusted", () => {
    it("states the threshold and how many labelled reviews there are", () => {
      render(<EvaluatorPanel />);

      expect(screen.getByTestId("kappa-summary")).toHaveTextContent("Threshold 0.6");
      expect(screen.getByTestId("kappa-summary")).toHaveTextContent("30 labelled windows");
      expect(screen.getByTestId("kappa-summary")).toHaveTextContent("52 reviews labelled");
    });

    it("shows kappa and raw agreement per criterion for each judge", () => {
      render(<EvaluatorPanel />);

      const row = screen.getByTestId("kappa-row-warmth");
      expect(row).toHaveTextContent("Warmth");
      expect(row).toHaveTextContent("κ 0.72, agree 90% (40)");
      expect(row).toHaveTextContent("κ 0.80");
    });

    it("says which criteria are used for decisions, and why the others are not", () => {
      render(<EvaluatorPanel />);

      expect(screen.getByTestId("kappa-row-warmth")).toHaveTextContent("Yes");
      const grounding = screen.getByTestId("kappa-row-grounding");
      expect(grounding).toHaveTextContent("Not yet");
      expect(grounding).toHaveTextContent("κ 0.41 is below 0.6");
    });

    it("says there are not enough labels, rather than showing a kappa that means nothing", () => {
      render(<EvaluatorPanel />);

      expect(screen.getByTestId("kappa-row-safety")).toHaveTextContent("Not enough labels (4)");
      expect(screen.getByTestId("kappa-row-safety")).toHaveTextContent("only 4 labelled windows");
    });
  });

  describe("the rubric", () => {
    it("lists every criterion with what passing and failing look like, and marks the safety ones", () => {
      render(<EvaluatorPanel />);

      const rubric = screen.getByTestId("evaluator-rubric");
      expect(within(rubric).getByText("Warmth")).toBeInTheDocument();
      expect(rubric).toHaveTextContent("Warm and calm.");
      expect(rubric).toHaveTextContent("Cold or chirpy.");
      expect(within(rubric).getAllByText("Safety").length).toBeGreaterThan(0);
    });
  });

  describe("running it now", () => {
    const openDialog = () => {
      fireEvent.click(screen.getByRole("button", { name: "Run now…" }));
      return screen.getByRole("dialog", { name: "Run the evaluator now" });
    };

    it("explains the cost and duration, and starts nothing until confirmed", () => {
      render(<EvaluatorPanel />);

      const dialog = openDialog();

      expect(dialog).toHaveTextContent("many minutes");
      expect(dialog).toHaveTextContent("spends model budget");
      expect(h.run).not.toHaveBeenCalled();
    });

    it("runs for yesterday with no night, and says it started in the background", async () => {
      render(<EvaluatorPanel />);

      fireEvent.click(within(openDialog()).getByRole("button", { name: "Run evaluator" }));

      await waitFor(() => expect(h.run).toHaveBeenCalledWith({ night: undefined }));
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Started. It runs in the background; refresh the summary in a few minutes.",
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("runs for a chosen night", async () => {
      render(<EvaluatorPanel />);
      const dialog = openDialog();

      fireEvent.change(within(dialog).getByLabelText("Night (optional)"), {
        target: { value: "2026-10-22" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Run evaluator" }));

      await waitFor(() => expect(h.run).toHaveBeenCalledWith({ night: "2026-10-22" }));
    });

    it("refuses a night that is not a date and sends nothing", () => {
      render(<EvaluatorPanel />);
      const dialog = openDialog();

      fireEvent.change(within(dialog).getByLabelText("Night (optional)"), {
        target: { value: "yesterday" },
      });

      expect(within(dialog).getByRole("alert")).toHaveTextContent("YYYY-MM-DD");
      expect(within(dialog).getByRole("button", { name: "Run evaluator" })).toBeDisabled();
      expect(h.run).not.toHaveBeenCalled();
    });

    it("keeps the dialog and shows the server's message when it cannot start", async () => {
      h.run.mockReturnValue({
        unwrap: () => Promise.reject({ status: 400, data: { message: "Not a valid night" } }),
      });
      render(<EvaluatorPanel />);

      fireEvent.click(within(openDialog()).getByRole("button", { name: "Run evaluator" }));

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Not a valid night"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("offers no run to an admin who can only view", () => {
      h.access.current = { canEdit: false };
      render(<EvaluatorPanel />);

      expect(screen.queryByRole("button", { name: "Run now…" })).not.toBeInTheDocument();
      expect(screen.getByTestId("evaluator-night-row")).toBeInTheDocument();
    });
  });
});
