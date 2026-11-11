import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  overview: vi.fn(),
  runs: vi.fn(),
  run: vi.fn(),
  pmAgent: vi.fn(),
  releases: vi.fn(),
  tenants: vi.fn(),
  runPmAgent: vi.fn(),
  screen: vi.fn(),
  decide: vi.fn(),
  rollback: vi.fn(),
  setLive: vi.fn(),
  setRegion: vi.fn(),
  build: vi.fn(),
  review: vi.fn(),
  act: vi.fn(),
  resolve: vi.fn(),
  escalate: vi.fn(),
  models: vi.fn(),
  steps: vi.fn(),
  setModels: vi.fn(),
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
  useGetPmAgentStateQuery: () => h.pmAgent(),
  useGetDebriefReleasesQuery: () => h.releases(),
  useGetDebriefTenantsQuery: () => h.tenants(),
  useRunPmAgentMutation: () => [h.runPmAgent, { isLoading: false }],
  useScreenIdeaMutation: () => [h.screen, { isLoading: false }],
  useDecideIdeaMutation: () => [h.decide, { isLoading: false }],
  useRollbackDebriefReleaseMutation: () => [h.rollback, { isLoading: false }],
  useSetDebriefTenantLiveMutation: () => [h.setLive, { isLoading: false }],
  useBuildDebriefTestSetsMutation: () => [h.build, { isLoading: false }],
  useGetDebriefReviewQuery: () => h.review(),
  useActOnDebriefRunMutation: () => [h.act, { isLoading: false }],
  useResolveDebriefFlagMutation: () => [h.resolve, { isLoading: false }],
  useSetDebriefTenantRegionMutation: () => [h.setRegion, { isLoading: false }],
  useEscalateDebriefMutation: () => [h.escalate, { isLoading: false }],
  useGetDebriefModelsQuery: () => h.models(),
  useGetDebriefStepsQuery: () => h.steps(),
  useSetDebriefModelsMutation: () => [h.setModels, { isLoading: false }],
}));
// The guidance is the Context Library's Debrief Guidance; the link has its own suite.
vi.mock("@components/context-collection-link", () => ({
  ContextCollectionLink: ({ collection }: { collection: string }) => (
    <div data-testid="collection-link" data-collection={collection} />
  ),
}));

// eslint-disable-next-line import/first
import { PmAgentTab } from "../PmAgentTab";
// eslint-disable-next-line import/first
import { GuidanceTab } from "../GuidanceTab";
// eslint-disable-next-line import/first
import { OrganisationsTab } from "../OrganisationsTab";
// eslint-disable-next-line import/first
import { ReleasesTab } from "../ReleasesTab";
// eslint-disable-next-line import/first
import { ReviewTab } from "../ReviewTab";
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
    h.pmAgent.mockReturnValue(
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
          notes: "PM agent idea",
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
    h.tenants.mockReturnValue(
      ok([
        {
          id: "t1",
          name: "Sangath",
          live: false,
          isTest: false,
          region: "india",
          hasSupportContact: false,
          monthSpentUsd: 1.25,
          monthRuns: 12,
        },
        {
          id: "t2",
          name: "Abroad",
          live: false,
          isTest: false,
          region: "outside_india",
          hasSupportContact: false,
        },
      ]),
    );
    h.steps.mockReturnValue(
      ok([
        {
          step: "writer",
          model: "gemini-3-flash-preview",
          backupModel: "gemini-2.5-flash",
          inRecipes: ["standard", "short"],
          done: 40,
          failed: 2,
          skipped: 0,
          medianMs: 12000,
          estimatedUsd: 0.8,
          models: ["gemini-3-flash-preview"],
        },
      ]),
    );
    h.review.mockReturnValue(
      ok({
        runs: [
          {
            ...RUN_ROW,
            evaluatorOverall: "4.00",
            evaluatorHardFails: [{ code: "missed_risk_cue", evidence: "turn 15" }],
            checkFailures: [],
          },
        ],
        flags: [
          {
            id: "flag-1",
            runId: RUN_ROW.id,
            scenarioSessionId: RUN_ROW.scenarioSessionId,
            section: "work_on_this[0]",
            reason: "advice_doesnt_fit",
            note: "My supervisor says otherwise.",
            urgent: false,
            createdAt: "2026-10-29T10:00:00Z",
            language: "en",
            tenantName: "Ally",
            cardText: "Ask about safety directly.",
            status: "open",
            card: { lead: "Ask about safety", why: "It keeps them safe." },
          },
        ],
      }),
    );
    [
      h.decide,
      h.rollback,
      h.setLive,
      h.screen,
      h.build,
      h.act,
      h.resolve,
      h.escalate,
      h.setRegion,
    ].forEach(f => f.mockReturnValue(resolves()));
    h.runPmAgent.mockReturnValue(resolves({ report: "r", ideas: [] }));
    h.models.mockReturnValue(
      ok({
        releaseVersion: 2,
        steps: [
          { step: "writer", model: "gemini-3-flash-preview", backupModel: "gemini-2.5-flash" },
          { step: "evaluator", model: "gemini-2.5-flash", backupModel: null },
        ],
        reply: "gemini-2.5-flash",
        judge: "gemini-2.5-pro",
        choices: {
          steps: [
            { model: "gemini-3-flash-preview", label: "Gemini 3 Flash", provider: "gemini" },
            { model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini" },
            { model: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
          ],
          reply: [
            { model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini" },
            { model: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
          ],
        },
      }),
    );
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
    expect(screen.getByTestId("run-how-made")).toHaveTextContent("Safety reader");
    expect(screen.getByTestId("run-body")).toHaveTextContent("quote_mismatch");
  });

  it("Runs filters by status", () => {
    render(<RunsTab />);
    fireEvent.click(screen.getByText("Needs a person", { selector: "button" }));
    expect(h.runs).toHaveBeenLastCalledWith({ status: "needs_person" });
  });

  it("PM agent shows its report and each rung; a change cannot start a canary before its paired trial passes", () => {
    render(<PmAgentTab />);
    expect(screen.getByTestId("pm-agent-report")).toHaveTextContent("Scores are up.");
    expect(screen.getByTestId("idea-screen")).toHaveTextContent("+0.50 on 6 sessions");
    expect(screen.getByTestId("idea-gate")).toHaveTextContent("Waiting");
    expect(screen.getByTestId("test-sets")).toHaveTextContent("Sealed: 11");
    expect(screen.getByRole("button", { name: "Start canary" })).toBeDisabled();
  });

  it("after a passed paired trial, starting the canary asks first", async () => {
    h.pmAgent.mockReturnValue(
      ok({
        report: null,
        at: null,
        learningSpentUsd: 0,
        ideas: [
          {
            ...IDEA,
            evidence: {
              ...IDEA.evidence,
              trial: {
                status: "passed",
                startedAt: "2026-11-01T00:00:00Z",
                comparisons: 34,
                meanDifference: 0.4,
                lower: 0.1,
                upper: 0.7,
              },
            },
          },
        ],
      }),
    );
    render(<PmAgentTab />);
    expect(screen.getByTestId("idea-trial")).toHaveTextContent("34 pairs · +0.40 (+0.10 to +0.70)");
    fireEvent.click(screen.getByRole("button", { name: "Start canary" }));
    expect(h.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start the canary" }));
    await waitFor(() =>
      expect(h.decide).toHaveBeenCalledWith({ id: IDEA.id, decision: "approve" }),
    );
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Canary started."));
  });

  it("a canary that passed is promoted by a person, after confirming", async () => {
    h.pmAgent.mockReturnValue(
      ok({
        report: null,
        at: null,
        learningSpentUsd: 0,
        ideas: [
          {
            ...IDEA,
            evidence: {
              ...IDEA.evidence,
              trial: { status: "passed", startedAt: "2026-11-01T00:00:00Z", comparisons: 34 },
              canary: {
                status: "passed",
                releaseId: "r3",
                version: 3,
                share: 0.1,
                startedAt: "2026-11-05T00:00:00Z",
                canaryRuns: 31,
                canaryMedian: 8.7,
                controlMedian: 8.5,
              },
            },
          },
        ],
      }),
    );
    render(<PmAgentTab />);
    expect(screen.getByTestId("idea-canary")).toHaveTextContent("Ready to promote");
    expect(screen.getByTestId("idea-canary")).toHaveTextContent("10% of live debriefs · 31 so far");
    fireEvent.click(screen.getByRole("button", { name: "Promote to everyone" }));
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("Promoted. Every learner now gets this change."),
    );
  });

  it("a running canary cannot be promoted, and a failed trial reads as not passed", () => {
    h.pmAgent.mockReturnValue(
      ok({
        report: null,
        at: null,
        learningSpentUsd: 0,
        ideas: [
          {
            ...IDEA,
            id: "a",
            evidence: {
              ...IDEA.evidence,
              trial: { status: "passed", startedAt: "2026-11-01T00:00:00Z", comparisons: 34 },
              canary: {
                status: "running",
                releaseId: "r3",
                version: 3,
                share: 0.1,
                startedAt: "2026-11-05T00:00:00Z",
              },
            },
          },
          {
            ...IDEA,
            id: "b",
            evidence: {
              ...IDEA.evidence,
              trial: { status: "failed", startedAt: "2026-11-01T00:00:00Z", comparisons: 40 },
            },
          },
        ],
      }),
    );
    render(<PmAgentTab />);
    for (const b of screen.getAllByRole("button", { name: "Start canary" }))
      expect(b).toBeDisabled();
    expect(screen.getAllByTestId("idea-trial")[1]).toHaveTextContent("Did not pass");
  });

  it("a quick test that did not do better reads as not passed", () => {
    h.pmAgent.mockReturnValue(
      ok({
        report: null,
        at: null,
        learningSpentUsd: 0,
        ideas: [
          { ...IDEA, evidence: { screen: { ...IDEA.evidence.screen, passed: false, lift: -0.4 } } },
        ],
      }),
    );
    render(<PmAgentTab />);
    expect(screen.getByRole("button", { name: "Start canary" })).toBeDisabled();
    expect(screen.getByTestId("idea-screen")).toHaveTextContent("Did not pass");
  });

  it("an approved idea reads live only while its release is", () => {
    h.pmAgent.mockReturnValue(
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
    render(<PmAgentTab />);
    const [first, second] = screen.getAllByTestId("idea");
    expect(first).toHaveTextContent("Live");
    expect(second).toHaveTextContent("No longer live");
  });

  it("an idea that needs code can only be rejected, never approved", () => {
    h.pmAgent.mockReturnValue(
      ok({
        report: null,
        at: null,
        learningSpentUsd: 0,
        ideas: [{ ...IDEA, change: { ...IDEA.change, ideaKind: "needs_code" }, evidence: {} }],
      }),
    );
    render(<PmAgentTab />);
    expect(screen.queryByRole("button", { name: "Start canary" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("a Builder brief from the PM agent opens a Builder session only after a person confirms", async () => {
    h.decide.mockReturnValue(resolves({ stage: "builder", id: "b1" }));
    h.pmAgent.mockReturnValue(
      ok({
        report: null,
        at: null,
        learningSpentUsd: 0,
        ideas: [
          {
            ...IDEA,
            change: { ...IDEA.change, ideaKind: "needs_code", route: "B" },
            evidence: {
              commentIds: ["c1", "c2"],
              handoff: {
                kind: "builder",
                status: "waiting",
                problem: "Learners never see the Practise-next card on Android.",
                evidenceSummary: "practise_click_through 0.08 on android (n=60)",
                expectedEffect: "practise_click_through up",
                acceptanceChecks: ["The card shows first on Android"],
              },
            },
          },
        ],
      }),
    );
    render(<PmAgentTab />);
    expect(screen.getByTestId("idea-handoff")).toHaveTextContent("Brief for Builder");
    expect(screen.getByTestId("idea-handoff")).toHaveTextContent("The card shows first on Android");
    expect(screen.getByText("2 expert comments")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open a Builder session" }));
    expect(h.decide).not.toHaveBeenCalled();
    expect(screen.getByText("Open a Builder session for this?")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Open a Builder session" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(h.decide).toHaveBeenCalledWith({ id: IDEA.id, decision: "approve" }),
    );
  });

  it("Releases: picking a model makes a release with only the changed models, after confirming", async () => {
    render(<ReleasesTab />);
    const panel = screen.getByTestId("models-panel");
    const save = within(panel).getByRole("button", { name: "Make a release with these models" });
    expect(save).toBeDisabled();
    expect(panel).toHaveTextContent("gemini-2.5-pro · Fixed");
    fireEvent.change(within(panel).getByLabelText("Writer"), { target: { value: "gpt-4.1" } });
    fireEvent.change(within(panel).getByLabelText("Ask Ally"), {
      target: { value: "claude-sonnet-4-6" },
    });
    fireEvent.click(save);
    expect(
      screen.getByText(/Writer on gpt-4.1, Ask Ally on claude-sonnet-4-6/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Put it live" }));
    await waitFor(() =>
      expect(h.setModels).toHaveBeenCalledWith({
        steps: { writer: "gpt-4.1" },
        reply: "claude-sonnet-4-6",
        note: undefined,
      }),
    );
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
      within(screen.getAllByTestId("organisation-row")[0]).getByRole("button", {
        name: "Switch on",
      }),
    );
    expect(screen.getByText("Switch Sangath to the new debrief?")).toBeInTheDocument();
    const dialogButtons = screen.getAllByRole("button", { name: "Switch on" });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);
    await waitFor(() => expect(h.setLive).toHaveBeenCalledWith({ tenantId: "t1", live: true }));
  });

  it("Organisations: one outside India can't be switched on without its own support line (FR-25)", async () => {
    render(<OrganisationsTab />);
    const [india, abroad] = screen.getAllByTestId("organisation-row");
    expect(within(india).getByRole("button", { name: "Switch on" })).toBeEnabled();
    expect(within(abroad).getByRole("button", { name: "Switch on" })).toBeDisabled();
    expect(abroad).toHaveTextContent("No support line");
    fireEvent.click(within(india).getByRole("button", { name: "Mark as outside India" }));
    await waitFor(() =>
      expect(h.setRegion).toHaveBeenCalledWith({ tenantId: "t1", region: "outside_india" }),
    );
  });

  it("Review: a debrief waiting for a person can be published after confirming", async () => {
    render(<ReviewTab />);
    const run = screen.getByTestId("review-run");
    expect(run).toHaveTextContent("missed_risk_cue");
    fireEvent.click(within(run).getByRole("button", { name: "Publish as it is" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(h.act).toHaveBeenCalledWith({ id: RUN_ROW.id, action: "publish" }));
  });

  it("Review: keeping a flagged point needs a reason; removing does not", async () => {
    render(<ReviewTab />);
    const flag = screen.getByTestId("review-flag");
    expect(flag).toHaveTextContent("My supervisor says otherwise.");
    expect(within(flag).getByRole("button", { name: "Keep it" })).toBeDisabled();
    fireEvent.click(within(flag).getByRole("button", { name: "Remove it" }));
    await waitFor(() =>
      expect(h.resolve).toHaveBeenCalledWith({ id: "flag-1", outcome: "removed", note: undefined }),
    );
  });

  it("Review: every item links to its roleplay's session log, in a new tab", () => {
    render(<ReviewTab />);
    const links = screen.getAllByRole("link", { name: "Open session log" });
    expect(links).toHaveLength(2);
    links.forEach(l => {
      expect(l).toHaveAttribute("href", `/roleplay-session-logs/${RUN_ROW.scenarioSessionId}`);
      expect(l).toHaveAttribute("target", "_blank");
    });
  });

  it("Review: correcting a card needs new words and a reason, and sends only the card's fields (FR-38)", async () => {
    render(<ReviewTab />);
    const flag = screen.getByTestId("review-flag");
    fireEvent.click(within(flag).getByRole("button", { name: "Correct it" }));
    const save = within(flag).getByRole("button", { name: "Save the correction" });
    expect(save).toBeDisabled();
    fireEvent.change(within(flag).getByLabelText("Why it matters"), {
      target: { value: "It shows you take them seriously." },
    });
    expect(save).toBeDisabled();
    fireEvent.change(within(flag).getByLabelText("Your reason"), {
      target: { value: "Reworded for this setting" },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(h.resolve).toHaveBeenCalledWith({
        id: "flag-1",
        outcome: "corrected",
        note: "Reworded for this setting",
        correction: { lead: "Ask about safety", why: "It shows you take them seriously." },
      }),
    );
  });

  it("Review: a flag or a debrief can be escalated to the clinical advisor (FR-38)", async () => {
    render(<ReviewTab />);
    fireEvent.click(
      within(screen.getByTestId("review-flag")).getByRole("button", {
        name: "Escalate to clinical advisor",
      }),
    );
    await waitFor(() =>
      expect(h.escalate).toHaveBeenCalledWith({ kind: "flags", id: "flag-1", reason: undefined }),
    );
    fireEvent.click(
      within(screen.getByTestId("review-run")).getByRole("button", {
        name: "Escalate to clinical advisor",
      }),
    );
    await waitFor(() =>
      expect(h.escalate).toHaveBeenCalledWith({ kind: "runs", id: RUN_ROW.id, reason: undefined }),
    );
  });

  it("Review works by keyboard: j / k move, Enter opens the debrief, e escalates (FR-38)", async () => {
    render(<ReviewTab />);
    expect(screen.getByTestId("review-keys")).toHaveTextContent("j and k");
    expect(screen.getByTestId("review-run")).toHaveAttribute("data-selected", "true");
    fireEvent.keyDown(window, { key: "j" });
    expect(screen.getByTestId("review-flag")).toHaveAttribute("data-selected", "true");
    fireEvent.keyDown(window, { key: "e" });
    await waitFor(() => expect(h.escalate).toHaveBeenCalledWith({ kind: "flags", id: "flag-1" }));
    fireEvent.keyDown(window, { key: "k" });
    expect(screen.getByTestId("review-run")).toHaveAttribute("data-selected", "true");
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(h.run).toHaveBeenCalledWith(RUN_ROW.id));
  });

  it("Review ignores the keys while someone is typing a reason", () => {
    render(<ReviewTab />);
    const box = within(screen.getByTestId("review-flag")).getAllByRole("textbox")[0];
    fireEvent.keyDown(box, { key: "e" });
    expect(h.escalate).not.toHaveBeenCalled();
  });

  it("Organisations shows each organisation's debrief spend this month (FR-8)", () => {
    render(<OrganisationsTab />);
    const [first] = screen.getAllByTestId("organisation-spend");
    expect(first).toHaveTextContent("12 debriefs");
    expect(first).toHaveTextContent("$1.25");
  });

  it("Releases lists the recipe's steps with their model and 30 days of use (FR-38 registry)", () => {
    render(<ReleasesTab />);
    const row = screen.getByTestId("step-row");
    expect(row).toHaveTextContent("Writer");
    expect(row).toHaveTextContent("gemini-3-flash-preview (gemini-2.5-flash)");
    expect(row).toHaveTextContent("standard, short");
    expect(row).toHaveTextContent("40");
  });

  it("Review: a published debrief with learner distress asks someone to check on them (FR-23)", async () => {
    h.review.mockReturnValue(
      ok({
        runs: [
          {
            ...RUN_ROW,
            status: "published",
            learnerDistress: true,
            checkFailures: [],
            evaluatorHardFails: [],
          },
        ],
        flags: [],
      }),
    );
    h.act.mockReturnValue(resolves());
    render(<ReviewTab />);
    const run = screen.getByTestId("review-run");
    expect(run).toHaveTextContent("stepped out of the roleplay in distress");
    expect(within(run).queryByRole("button", { name: "Publish as it is" })).not.toBeInTheDocument();
    fireEvent.click(within(run).getByRole("button", { name: "Checked on" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark checked" }));
    await waitFor(() => expect(h.act).toHaveBeenCalledWith({ id: RUN_ROW.id, action: "reviewed" }));
  });

  it("Review: a published debrief the judge scored below the bar is checked, not republished (FR-21)", async () => {
    h.review.mockReturnValue(
      ok({
        runs: [
          {
            ...RUN_ROW,
            status: "published",
            learnerDistress: false,
            judgeBelowBar: true,
            judgeHardFails: [{ code: "missed_risk_cue", evidence: "turn 14 not addressed" }],
            checkFailures: [],
            evaluatorHardFails: [],
          },
        ],
        flags: [],
      }),
    );
    h.act.mockReturnValue(resolves());
    render(<ReviewTab />);
    const run = screen.getByTestId("review-run");
    expect(run).toHaveTextContent("Judge below the bar");
    expect(run).toHaveTextContent("independent judge scored it below the bar");
    expect(run).toHaveTextContent("missed_risk_cue: turn 14 not addressed");
    expect(run).not.toHaveTextContent("stepped out of the roleplay in distress");
    expect(within(run).queryByRole("button", { name: "Publish as it is" })).not.toBeInTheDocument();
    fireEvent.click(within(run).getByRole("button", { name: "Looks fine" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark checked" }));
    await waitFor(() => expect(h.act).toHaveBeenCalledWith({ id: RUN_ROW.id, action: "reviewed" }));
  });

  describe("Guidance", () => {
    it("points at Debrief Guidance in the Context Library, where clinical is information only", () => {
      render(<GuidanceTab />);
      expect(screen.getByTestId("collection-link")).toHaveAttribute(
        "data-collection",
        "debrief_guidance",
      );
    });
  });
});
