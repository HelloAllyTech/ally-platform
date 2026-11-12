import { render, screen, within } from "@testing-library/react";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
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

// eslint-disable-next-line import/first
import { ConsoleOverviewSection } from "../metrics/ConsoleOverviewSection";
// eslint-disable-next-line import/first
import { JudgeAgreementSection } from "../metrics/JudgeAgreementSection";

const measure = (
  m: string,
  n: number,
  kappa: number | null,
  state: string,
  caught: [number, number],
) => ({
  measure: m,
  n,
  kappa,
  agreementPct: kappa === null ? null : 88.5,
  recallOnNo: { caught: caught[0], of: caught[1], pct: null },
  state,
  passes: state === "met",
});

/** `GET analytics`'s judge agreement: from the clinical advisor's yes/no answers. */
const ANALYTICS_AGREEMENT = {
  gate: { met: false },
  kappa: 0.6,
  minReviews: 50,
  measures: [
    measure("accuracy", 62, 0.72, "met", [3, 4]),
    measure("evidence_specificity", 55, null, "undefined", [0, 0]),
    measure("missed_risk_cue", 12, null, "not_enough", [1, 1]),
  ],
  sample: { size: 5, thisWeek: 3, waiting: 2 },
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

describe("Analytics › Debriefs › Judge agreement (from the advisor's answers)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows reviews, the sample and whether try-outs may run alone", () => {
    renderAgreement();
    expect(screen.getByTestId("kpi-Reviews with answers")).toHaveTextContent("62");
    expect(screen.getByTestId("kpi-Agreement sample")).toHaveTextContent("3 this week · 2 waiting");
    expect(screen.getByTestId("kpi-Learner try-outs on their own")).toHaveTextContent(
      "Needs approval",
    );
  });

  it("charts each measure's agreement against 0.6, with the problems caught and the table", () => {
    renderAgreement();
    const accuracy = screen.getByTestId("gate-chart-accuracy");
    expect(accuracy).toHaveTextContent("0.72, substantial");
    expect(accuracy).toHaveTextContent("Target: ≥ 0.6");
    expect(accuracy).toHaveTextContent("On target");
    expect(accuracy).toHaveTextContent("Independent check caught 3 of 4 problems you found");
    expect(screen.getByTestId("gate-chart-evidence_specificity")).toHaveTextContent(
      "Not measurable yet: every answer is the same",
    );
    expect(screen.getByTestId("gate-chart-missed_risk_cue")).toHaveTextContent(
      "Not measured yet: 12 of 50 reviews",
    );
    const numbers = screen.getByTestId("gate-numbers");
    expect(numbers.tagName).toBe("DETAILS");
    expect(numbers).toHaveTextContent("88.5%");
    expect(numbers).toHaveTextContent("12 of 50");
    expect(within(numbers).getAllByText("Met")).toHaveLength(1);
    expect(screen.getByTestId("judge-agreement")).not.toHaveTextContent("κ");
  });

  it("says so when the advisor hasn't answered yet", () => {
    renderAgreement({ ...ANALYTICS_AGREEMENT, measures: [] });
    expect(screen.getByTestId("judge-agreement-empty")).toBeInTheDocument();
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
