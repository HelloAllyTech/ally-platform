import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefCalibrationSampleQuery: () => h.sample(),
  useGetDebriefCalibrationAgreementQuery: () => h.agreement(),
  useGetDebriefCalibrationItemQuery: (id: string) => h.item(id),
  useSubmitDebriefRatingMutation: () => [h.submit, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { CalibrationTab } from "../CalibrationTab";

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

describe("CalibrationTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.sample.mockReturnValue(ok(SAMPLE));
    h.agreement.mockReturnValue(ok(AGREEMENT));
    h.item.mockReturnValue(ok(ITEM));
    h.submit.mockReturnValue({ unwrap: () => Promise.resolve({ created: true }) });
  });

  it("shows progress, the gate and only debriefs still to rate", () => {
    render(<CalibrationTab />);
    expect(screen.getByTestId("kpi-Debriefs rated")).toHaveTextContent("1 of 150");
    expect(screen.getByTestId("kpi-Rated by you")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-Improver autonomy")).toHaveTextContent("Needs approval");
    expect(within(screen.getByTestId("gate-accuracy")).getByText("Passes")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("gate-missed_risk_cue")).getByText("Needs 20 rated debriefs"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("calibration-row")).toHaveLength(1);
  });

  it("never shows the judge's scores or quality band in the sample", () => {
    render(<CalibrationTab />);
    const table = screen.getByTestId("calibration-table");
    expect(table).not.toHaveTextContent(/tercile|low|high/i);
  });

  it("says when there is nothing scored yet", () => {
    h.sample.mockReturnValue(ok({ population: 0, target: 150, items: [] }));
    render(<CalibrationTab />);
    expect(screen.getByText("No debriefs to rate yet")).toBeInTheDocument();
  });

  it("saves a rating only once every part is scored", async () => {
    render(<CalibrationTab />);
    fireEvent.click(screen.getByRole("button", { name: "Rate" }));
    expect(h.item).toHaveBeenCalledWith(ITEM.scenarioSessionId);
    expect(screen.getByTestId("rating-transcript")).toHaveTextContent("Tell me more");

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
