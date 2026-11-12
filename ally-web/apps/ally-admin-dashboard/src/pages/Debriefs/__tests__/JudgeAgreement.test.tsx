import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  sample: vi.fn(),
  agreement: vi.fn(),
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
  useGetDebriefCalibrationSampleQuery: () => h.sample(),
  useGetDebriefCalibrationAgreementQuery: () => h.agreement(),
  useGetDebriefCalibrationItemQuery: (id: string) => h.item(id),
  useScoreDebriefSessionMutation: () => [h.submit, { isLoading: false }],
}));

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

const SAMPLE = {
  population: 40,
  target: 150,
  items: [
    {
      scenarioSessionId: "aaaaaaaa-0000-4000-8000-000000000001",
      language: "hi",
      tercile: 0,
      raters: 0,
      ratedByMe: false,
    },
    {
      scenarioSessionId: "bbbbbbbb-0000-4000-8000-000000000002",
      language: "en",
      tercile: 2,
      raters: 2,
      ratedByMe: true,
    },
  ],
};

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
    h.sample.mockReturnValue(ok(SAMPLE));
    h.agreement.mockReturnValue(ok(AGREEMENT));
    h.item.mockReturnValue(ok(ITEM));
    h.submit.mockReturnValue({ unwrap: () => Promise.resolve({ created: true }) });
  });

  it("shows progress and the gate as a chart, with the table behind it", () => {
    render(<JudgeAgreementSection />);
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
    render(<JudgeAgreementSection />);
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
