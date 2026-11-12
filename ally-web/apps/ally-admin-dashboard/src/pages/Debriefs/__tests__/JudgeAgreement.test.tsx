import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  item: vi.fn(),
  submit: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("../../Analytics/chartKit", () => ({
  PALETTE: { blue: "#264D8E", orange: "#ff832b" },
  KpiTile: ({ label, value }: { label: string; value: string }) => (
    <div data-testid={`kpi-${label}`}>{value}</div>
  ),
  ChartCard: ({ title, caption, children }: any) => (
    <div data-testid={`chart-${title}`}>
      <p>{caption}</p>
      {children}
    </div>
  ),
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefCalibrationItemQuery: (id: string) => h.item(id),
  useScoreDebriefSessionMutation: () => [h.submit, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { ConsoleOverviewSection } from "../metrics/ConsoleOverviewSection";
// eslint-disable-next-line import/first
import { JudgeAgreementSection } from "../metrics/JudgeAgreementSection";
// eslint-disable-next-line import/first
import { ScoreByHand } from "../ScoreByHand";

const ok = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
});

const DIMS = [
  "evidence_specificity",
  "accuracy",
  "actionability",
  "prioritisation",
  "personalisation_progress",
  "practice_alignment",
  "tone",
  "clarity",
];
const FAILS = [
  "fabricated_quote",
  "missed_risk_cue",
  "diagnoses_trainee",
  "wrong_language",
  "contradicts_protocol",
  "unsupported_progress_claim",
];

const dim = (k: number | null) => ({
  pairs: 25,
  debriefs: 25,
  weightedKappa: k,
  withinOnePct: k === null ? null : 80,
  meanDifference: k === null ? null : 0.6,
});
const fail = (k: number | null) => ({ pairs: 25, debriefs: 25, kappa: k, exactAgreementPct: 90 });

const AGREEMENT = {
  rubricVersion: "v1",
  judge: { judgeModel: "gemini-2.5-pro", judgePromptVersion: "v1" },
  target: 150,
  coverage: { debriefs: 25, ratings: 30, raters: 2 },
  judgeVsHuman: {
    dimensions: Object.fromEntries(DIMS.map(d => [d, dim(d === "accuracy" ? 0.72 : 0.5)])),
    hardFails: Object.fromEntries(FAILS.map(f => [f, fail(0.8)])),
  },
  humanVsHuman: {
    dimensions: Object.fromEntries(DIMS.map(d => [d, dim(null)])),
    hardFails: Object.fromEntries(FAILS.map(f => [f, fail(null)])),
  },
  gate: {
    met: false,
    checks: [
      { measure: "accuracy", kappa: 0.72, passes: true },
      { measure: "evidence_specificity", kappa: 0.5, passes: false },
      { measure: "missed_risk_cue", kappa: null, passes: false },
    ],
  },
};

/** `GET analytics`'s judge agreement for the same data. */
const ANALYTICS_AGREEMENT = {
  gate: AGREEMENT.gate,
  target: 150,
  debriefsRated: 1,
  ratings: 2,
  peopleRating: 2,
  dimensions: DIMS.map(d => ({
    dimension: d,
    kappa: d === "accuracy" ? 0.72 : 0.5,
    withinOnePct: 80,
    meanDifference: 0.6,
    pairs: 25,
  })),
  hardFails: [],
  humanVsHuman: AGREEMENT.humanVsHuman,
  expertVerdicts: null,
};
const renderAgreement = (agreement: unknown = ANALYTICS_AGREEMENT) =>
  render(
    <JudgeAgreementSection
      agreement={agreement as never}
      loading={false}
      error={null}
      onRetry={vi.fn()}
    />,
  );

const ITEM = {
  scenarioSessionId: "aaaaaaaa-0000-4000-8000-000000000001",
  language: "hi",
  transcript: [
    { turnIndex: 1, speaker: "client", text: "I don't want to be here anymore" },
    { turnIndex: 2, speaker: "learner", text: "Tell me more" },
  ],
  debrief: "At (turn 2) you invited the client to say more.",
  myRating: null,
};

describe("Analytics › Debriefs › Judge agreement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.item.mockReturnValue(ok(ITEM));
    h.submit.mockReturnValue({ unwrap: () => Promise.resolve({ created: true }) });
  });

  it("shows progress and the gate as a chart, with the table behind it", () => {
    renderAgreement();
    expect(screen.getByTestId("kpi-Debriefs rated")).toHaveTextContent("1 of 150");
    expect(screen.getByTestId("kpi-PM agent autonomy")).toHaveTextContent("Needs approval");
    const accuracy = screen.getByTestId("gate-chart-accuracy");
    expect(accuracy).toHaveTextContent("0.72, substantial");
    expect(accuracy).toHaveTextContent("Target: ≥ 0.6");
    expect(accuracy).toHaveTextContent("On target");
    expect(screen.getByTestId("gate-chart-evidence_specificity")).toHaveTextContent("Off target");
    expect(screen.getByTestId("gate-chart-missed_risk_cue")).toHaveTextContent(
      "Needs 20 rated debriefs",
    );
    expect(screen.getByTestId("calibration-gate")).toHaveTextContent("0 is chance, 1 is always");
    const numbers = screen.getByTestId("gate-numbers");
    expect(numbers.tagName).toBe("DETAILS");
    expect(within(numbers).getAllByText("Passes")).toHaveLength(1);
  });

  it("shows agreement per part of the rubric as a chart, with the table behind it", () => {
    renderAgreement();
    const accuracy = screen.getByTestId("agreement-chart-accuracy");
    expect(accuracy).toHaveTextContent("Accuracy");
    expect(accuracy).toHaveTextContent("0.72, substantial");
    expect(accuracy).toHaveTextContent("People with each other: Needs 20 rated debriefs");
    expect(screen.getByTestId("agreement-chart-tone")).toHaveTextContent("0.50, moderate");
    expect(screen.getByTestId("agreement-numbers")).toHaveTextContent("0.6 higher");
  });

  it("score by hand saves only once every part is scored", async () => {
    const onSaved = vi.fn();
    render(<ScoreByHand sessionId={ITEM.scenarioSessionId} onSaved={onSaved} />);
    expect(h.item).toHaveBeenCalledWith(ITEM.scenarioSessionId);

    const save = screen.getByRole("button", { name: "Save rating" });
    expect(save).toBeDisabled();
    expect(screen.getByTestId("rating-left")).toHaveTextContent("8 parts left to score");

    const labels = [
      "Evidence",
      "Accuracy",
      "Next steps",
      "Focus",
      "Fit to the learner",
      "Sound practice",
      "Tone",
      "Clarity",
    ];
    labels.forEach(label => fireEvent.click(screen.getByLabelText(`${label}: 7`)));
    fireEvent.click(screen.getByLabelText(/ignores how the learner responded/));
    expect(save).not.toBeDisabled();

    fireEvent.click(save);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Rating saved"));
    expect(onSaved).toHaveBeenCalled();
    expect(h.submit).toHaveBeenCalledWith({
      sessionId: ITEM.scenarioSessionId,
      rating: {
        scores: Object.fromEntries(DIMS.map(d => [d, 7])),
        hardFails: ["missed_risk_cue"],
        note: null,
      },
    });
  });
});

describe("Analytics › Debriefs › Runs and spend", () => {
  it("shows the six tiles, spend per organisation, both pools and the burn rate", () => {
    render(
      <ConsoleOverviewSection
        loading={false}
        error={false}
        onRetry={vi.fn()}
        view={
          {
            windowDays: 7,
            tiles: {
              runs: 12,
              judgeMean: 8.6,
              meetsTheBar: 0.75,
              needsAPerson: 2,
              costP50Usd: 0.09,
              costP90Usd: 0.21,
              spentThisMonthUsd: 3.2,
            },
            cost: {
              perOrg: [
                {
                  tenantId: "t1",
                  tenantName: "Sangath",
                  live: true,
                  monthSpentUsd: 2.1,
                  monthRuns: 30,
                },
                {
                  tenantId: "t2",
                  tenantName: "Quiet",
                  live: false,
                  monthSpentUsd: 0,
                  monthRuns: 0,
                },
              ],
              pool: {
                sessionsThisMonth: 30,
                addedUsd: 10,
                spentUsd: 45,
                balanceUsd: 5,
                monthlyCapUsd: 50,
                capLeftUsd: 5,
                runCeilingUsd: 0.5,
              },
              learning: { spentUsd: 4, budgetUsd: 40, balanceUsd: 36 },
              burnRate: { perDayUsd: 1.5, last7DaysUsd: 10.5, projectedMonthUsd: 46.5 },
            },
            judgeAgreement: null,
          } as never
        }
      />,
    );
    expect(screen.getByTestId("kpi-Runs")).toHaveTextContent("12");
    expect(screen.getByTestId("spend-per-org")).toHaveTextContent("Sangath");
    expect(screen.getByTestId("spend-per-org")).not.toHaveTextContent("Quiet");
    expect(screen.getByTestId("pool-debriefs")).toHaveTextContent("$45.00 of $50.00");
    expect(screen.getByTestId("burn-rate")).toHaveTextContent("$1.50 a day");
  });

  it("says when nobody has scored by hand yet", () => {
    renderAgreement(null);
    expect(screen.getByTestId("judge-agreement-empty")).toBeInTheDocument();
  });
});
