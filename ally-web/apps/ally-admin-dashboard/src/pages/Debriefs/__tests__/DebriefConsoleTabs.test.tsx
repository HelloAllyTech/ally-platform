import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  overview: vi.fn(),
  runs: vi.fn(),
  run: vi.fn(),
  improver: vi.fn(),
  releases: vi.fn(),
  tenants: vi.fn(),
  runImprover: vi.fn(),
  screen: vi.fn(),
  decide: vi.fn(),
  rollback: vi.fn(),
  setLive: vi.fn(),
  build: vi.fn(),
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
  useGetDebriefOverviewQuery: () => h.overview(),
  useGetDebriefRunsQuery: (a: unknown) => h.runs(a),
  useGetDebriefRunQuery: (id: string) => h.run(id),
  useGetImproverStateQuery: () => h.improver(),
  useGetDebriefReleasesQuery: () => h.releases(),
  useGetDebriefTenantsQuery: () => h.tenants(),
  useRunImproverMutation: () => [h.runImprover, { isLoading: false }],
  useScreenIdeaMutation: () => [h.screen, { isLoading: false }],
  useDecideIdeaMutation: () => [h.decide, { isLoading: false }],
  useRollbackDebriefReleaseMutation: () => [h.rollback, { isLoading: false }],
  useSetDebriefTenantLiveMutation: () => [h.setLive, { isLoading: false }],
  useBuildDebriefTestSetsMutation: () => [h.build, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { ImproverTab } from "../ImproverTab";
// eslint-disable-next-line import/first
import { OrganisationsTab } from "../OrganisationsTab";
// eslint-disable-next-line import/first
import { ReleasesTab } from "../ReleasesTab";
// eslint-disable-next-line import/first
import { RunsTab } from "../RunsTab";

const ok = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
});
const resolves = (v: unknown = {}) => ({ unwrap: () => Promise.resolve(v) });

const OVERVIEW = {
  windowDays: 7,
  mode: "shadow",
  release: { id: "r2", version: 2 },
  runs: {
    total: 12,
    published: 9,
    belowBar: 1,
    needsPerson: 2,
    failed: 0,
    skipped: 3,
    withRiskCue: 1,
  },
  judge: { scored: 12, mean: 8.6, passRate: 0.75, todayMean: 6.1, todayScored: 40 },
  costUsd: { p50: 0.09, p90: 0.21 },
  seconds: { p50: 70, p90: 110 },
  budget: {
    monthSpentUsd: 3.2,
    monthlyCapUsd: 500,
    runCeilingUsd: 0.5,
    learningSpentUsd: 4,
    learningBudgetUsd: 150,
  },
  testSets: { debrief_open: 38, debrief_gate: 24, debrief_sealed: 11 },
  liveTenants: [],
};

const RUN_ROW = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  scenarioSessionId: "bbbbbbbb-0000-4000-8000-000000000002",
  mode: "shadow",
  status: "needs_person",
  skipReason: "checks_failed",
  recipeKey: "standard",
  releaseVersion: 2,
  language: "hi",
  learnerTurns: 12,
  hasRiskCue: true,
  learnerDistress: false,
  fallbackRung: 6,
  revisionRounds: 2,
  evaluatorOverall: 6.4,
  judgeOverall: 6.8,
  costUsd: 0.21,
  seconds: 120,
  checkFailureCount: 1,
  experimentId: null,
  arm: null,
  createdAt: "2026-10-29T10:00:00Z",
  tenantName: "Sangath",
};

const IDEA = {
  id: "cccccccc-0000-4000-8000-000000000003",
  status: "proposed",
  title: "Put the risk-cue point first",
  change: {
    ideaKind: "prompt_edit",
    promptCode: "debrief_writer_system",
    find: "most important first",
    replace: "most important first; a missed risk cue always first",
    settingKey: null,
    settingValue: null,
  },
  evidence: {
    hypothesis: "Prioritisation is the weakest dimension.",
    evidence: "prioritisation 6.9",
    expectedEffect: "prioritisation +0.5",
    screen: {
      status: "done",
      cases: 6,
      pairs: 6,
      baselineFailures: 0,
      challengerFailures: 0,
      baselineMean: 8.4,
      challengerMean: 8.9,
      lift: 0.5,
      baselineHardFails: 0,
      challengerHardFails: 0,
      challengerCheckFailures: 0,
      costUsd: 1.2,
      passed: true,
      ranAt: "2026-10-29T10:00:00Z",
    },
  },
  createdAt: "2026-10-29T10:00:00Z",
  releaseVersion: null,
  releaseStatus: null,
};

describe("Debrief Console tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.overview.mockReturnValue(ok(OVERVIEW));
    h.runs.mockReturnValue(ok([RUN_ROW]));
    h.run.mockReturnValue(
      ok({
        ...RUN_ROW,
        estimatedCostUsd: "0.2100",
        actualCostUsd: null,
        ceilingUsd: "0.5",
        evaluatorOverall: "6.40",
        evaluatorHardFails: [],
        checkFailures: [
          {
            code: "quote_mismatch",
            section: "what_worked[0]",
            detail: "the quote is not in turn 3",
          },
        ],
        steps: [
          {
            step: "safety_reader",
            label: "",
            status: "done",
            startedAt: "",
            ms: 9000,
            model: "gemini-2.5-flash",
          },
        ],
        workspace: {
          judge: { overall: 6.8, hardFails: [] },
          evaluations: [{ round: 0, overall: 6.4, hardFails: [], checks: ["quote_mismatch"] }],
        },
        cards: null,
        error: null,
      }),
    );
    h.improver.mockReturnValue(
      ok({
        report: "Scores are up.",
        at: "2026-10-29T10:00:00Z",
        learningSpentUsd: 4,
        ideas: [IDEA],
      }),
    );
    h.releases.mockReturnValue(
      ok([
        {
          id: "r2",
          version: 2,
          status: "ga",
          authorKind: "human",
          notes: "Improver idea",
          createdAt: "",
          promotedAt: "",
          prompts: {},
          maxRevisionRounds: 2,
        },
        {
          id: "r1",
          version: 1,
          status: "retired",
          authorKind: "seed",
          notes: null,
          createdAt: "",
          promotedAt: null,
          prompts: {},
          maxRevisionRounds: 2,
        },
      ]),
    );
    h.tenants.mockReturnValue(ok([{ id: "t1", name: "Sangath", live: false, isTest: false }]));
    [h.decide, h.rollback, h.setLive, h.screen, h.build].forEach(f =>
      f.mockReturnValue(resolves()),
    );
    h.runImprover.mockReturnValue(resolves({ report: "r", ideas: [] }));
  });

  it("Runs shows the agent at a glance and opens a run's timeline", () => {
    render(<RunsTab />);
    expect(screen.getByTestId("kpi-Judge score")).toHaveTextContent("8.6");
    expect(screen.getByTestId("kpi-Needs a person")).toHaveTextContent("2");
    const row = screen.getByTestId("run-row");
    expect(row).toHaveTextContent("Needs a person");
    expect(row).toHaveTextContent("Important moment");
    fireEvent.click(within(row).getByRole("button", { name: "Open" }));
    expect(h.run).toHaveBeenCalledWith(RUN_ROW.id);
    expect(screen.getByTestId("run-steps")).toHaveTextContent("safety_reader");
    expect(screen.getByTestId("run-body")).toHaveTextContent("quote_mismatch");
  });

  it("Runs filters by status", () => {
    render(<RunsTab />);
    fireEvent.click(screen.getByText("Needs a person", { selector: "button" }));
    expect(h.runs).toHaveBeenLastCalledWith({ status: "needs_person" });
  });

  it("Improver shows its report and an idea with its screen, and approval asks first", async () => {
    render(<ImproverTab />);
    expect(screen.getByTestId("improver-report")).toHaveTextContent("Scores are up.");
    expect(screen.getByTestId("idea-screen")).toHaveTextContent("+0.50 on 6 sessions");
    expect(screen.getByTestId("test-sets")).toHaveTextContent("Sealed: 11");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(h.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Put it live" }));
    await waitFor(() =>
      expect(h.decide).toHaveBeenCalledWith({ id: IDEA.id, decision: "approve" }),
    );
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("The change is live"));
  });

  it("an idea that did not do better cannot be approved", () => {
    h.improver.mockReturnValue(
      ok({
        report: null,
        at: null,
        learningSpentUsd: 0,
        ideas: [
          { ...IDEA, evidence: { screen: { ...IDEA.evidence.screen, passed: false, lift: -0.4 } } },
        ],
      }),
    );
    render(<ImproverTab />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByTestId("idea-screen")).toHaveTextContent("Not better");
  });

  it("an approved idea reads live only while its release is", () => {
    h.improver.mockReturnValue(
      ok({
        report: null,
        at: null,
        learningSpentUsd: 0,
        ideas: [
          { ...IDEA, id: "a", status: "active", releaseVersion: 3, releaseStatus: "ga" },
          { ...IDEA, id: "b", status: "active", releaseVersion: 2, releaseStatus: "retired" },
        ],
      }),
    );
    render(<ImproverTab />);
    const [first, second] = screen.getAllByTestId("idea");
    expect(first).toHaveTextContent("Live");
    expect(second).toHaveTextContent("No longer live");
  });

  it("an idea that needs code can only be rejected, never approved", () => {
    h.improver.mockReturnValue(
      ok({
        report: null,
        at: null,
        learningSpentUsd: 0,
        ideas: [{ ...IDEA, change: { ...IDEA.change, ideaKind: "needs_code" }, evidence: {} }],
      }),
    );
    render(<ImproverTab />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("Releases offers rollback on every release but the live one", async () => {
    render(<ReleasesTab />);
    const rows = screen.getAllByTestId("release-row");
    expect(within(rows[0]).queryByRole("button")).toBeNull();
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Roll back to this" }));
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
    await waitFor(() => expect(h.rollback).toHaveBeenCalledWith({ id: "r1" }));
  });

  it("Organisations switches one on after confirming", async () => {
    render(<OrganisationsTab />);
    fireEvent.click(
      within(screen.getByTestId("organisation-row")).getByRole("button", { name: "Switch on" }),
    );
    expect(screen.getByText("Switch Sangath to the new debrief?")).toBeInTheDocument();
    const dialogButtons = screen.getAllByRole("button", { name: "Switch on" });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);
    await waitFor(() => expect(h.setLive).toHaveBeenCalledWith({ tenantId: "t1", live: true }));
  });
});
