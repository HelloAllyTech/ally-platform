import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  overview: vi.fn(),
  pmAgent: vi.fn(),
  models: vi.fn(),
  settings: vi.fn(),
  runPmAgent: vi.fn(),
  screen: vi.fn(),
  decide: vi.fn(),
  rollback: vi.fn(),
  build: vi.fn(),
  autonomy: vi.fn(),
  approvePinned: vi.fn(),
  rejectPinned: vi.fn(),
  withdrawPinned: vi.fn(),
  proposePinned: vi.fn(),
  ask: vi.fn(),
  startStep: vi.fn(),
  history: vi.fn(),
  detail: vi.fn(),
  propose: vi.fn(),
  promoteWaiting: vi.fn(),
  attention: vi.fn(),
  dismissWaiting: vi.fn(),
  reports: vi.fn(),
  permissions: [] as string[],
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  builderProgress: vi.fn(),
  answerBuilder: vi.fn(),
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSelector: (pick: (state: unknown) => unknown) =>
    pick({ user: { permissions: h.permissions } }),
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefOverviewQuery: () => h.overview(),
  useGetPmAgentStateQuery: () => h.pmAgent(),
  useGetDebriefModelsQuery: () => h.models(),
  useGetDebriefSettingsQuery: () => h.settings(),
  useRunPmAgentMutation: () => [h.runPmAgent, { isLoading: false }],
  useScreenIdeaMutation: () => [h.screen, { isLoading: false }],
  useDecideIdeaMutation: () => [h.decide, { isLoading: false }],
  useGetIdeaBuilderProgressQuery: () => h.builderProgress(),
  useAnswerIdeaBuilderQuestionMutation: () => [h.answerBuilder, { isLoading: false }],
  useRollbackDebriefReleaseMutation: () => [h.rollback, { isLoading: false }],
  useBuildDebriefTestSetsMutation: () => [h.build, { isLoading: false }],
  useGetDebriefAutonomyQuery: () => h.autonomy(),
  useApprovePinnedRuleMutation: () => [h.approvePinned, { isLoading: false }],
  useRejectPinnedRuleMutation: () => [h.rejectPinned, { isLoading: false }],
  useWithdrawPinnedRuleMutation: () => [h.withdrawPinned, { isLoading: false }],
  useProposePinnedRuleMutation: () => [h.proposePinned, { isLoading: false }],
  useAskIdeaQuestionMutation: () => [h.ask, { isLoading: false }],
  useStartIdeaStepMutation: () => [h.startStep, { isLoading: false }],
  useGetDebriefPinnedRulesQuery: () => ({ data: { rules: [] } }),
  useGetDebriefReleaseHistoryQuery: () => h.history(),
  useGetDebriefReleaseDetailQuery: (id: string) => h.detail(id),
  useGetDebriefReleaseCompareQuery: () => ({ data: { prompts: [] } }),
  useProposeDebriefChangeMutation: () => [h.propose, { isLoading: false }],
  usePromoteWaitingReleaseMutation: () => [h.promoteWaiting, { isLoading: false }],
  useDismissWaitingReleaseMutation: () => [h.dismissWaiting, { isLoading: false }],
  useGetDebriefAttentionQuery: () => h.attention(),
  useGetPmAgentReportsQuery: () => h.reports(),
  useGetPmAgentReportQuery: () => ({ data: undefined }),
  useGetPromptVersionsQuery: () => ({
    data: [
      { version: 14, status: "live", publishedAt: "2026-11-12", note: "Shorter lines" },
      { version: 13, status: "history", publishedAt: "2026-11-01", note: null },
      { version: 15, status: "candidate", publishedAt: null, note: null },
    ],
    isLoading: false,
  }),
}));

/* eslint-disable import/first */
import { PmAgentPage } from "../pm/PmAgentPage";
import {
  IDEA,
  MODELS,
  OVERVIEW,
  SETTINGS,
  TEAM_PERMS,
  TRIAL_PASSED,
  ok,
  rejects,
  resolves,
} from "./consoleFixtures";
/* eslint-enable import/first */

const state = (ideas: unknown[], extra: Record<string, unknown> = {}) =>
  ok({
    report: "Scores are up.",
    at: "2026-10-29T10:00:00Z",
    learningSpentUsd: 4,
    ideas,
    ...extra,
  });

const item = (over: Record<string, unknown>) => ({
  id: "r2",
  version: 2,
  status: "live",
  title: "Put the risk-cue point first",
  summary: null,
  cameFrom: {
    kind: "idea",
    ideaId: IDEA.id,
    title: "Put the risk-cue point first",
    proposedBy: "pm_agent",
  },
  wentLiveAt: "2026-11-01T00:00:00Z",
  liveTimes: 1,
  retired: null,
  ...over,
});
const HISTORY = {
  items: [
    item({}),
    item({
      id: "r1",
      version: 1,
      status: "retired",
      title: "Seed release",
      cameFrom: { kind: "code", tag: "be-v1.190.2" },
      retired: { at: "2026-11-01T00:00:00Z", reason: "replaced", byVersion: 2, why: null },
    }),
  ],
  waiting: [],
};
const contents = {
  prompts: [
    {
      code: "debrief_writer_system",
      promptId: "p",
      version: 13,
      followsCurrent: false,
      changed: true,
      lock: "release_only",
    },
    {
      code: "debrief_quality_rubric",
      promptId: "q",
      version: 2,
      followsCurrent: false,
      changed: false,
      lock: "pinned",
    },
  ],
  recipes: [],
  steps: [
    {
      step: "writer",
      model: "gemini-3-flash-preview",
      backupModel: "gemini-2.5-flash",
      status: "on",
      createdBy: "code",
      usedPct: 100,
      costPerRunUsd: 0.018,
      winRate: null,
      changed: false,
    },
  ],
  reply: null,
  orchestrator: null,
  settings: [{ key: "gateCases", value: 100, budget: false, changed: false }],
  pinned: [{ code: "debrief_quality_rubric", label: "Rubric", version: 2, inRelease: true }],
};
const metrics = (judgeMedian: number, hardFails: number) => ({
  debriefs: 40,
  judged: 38,
  judgeMedian,
  hardFails,
  costPerDebriefUsd: 0.07,
  secondsToDebrief: 58,
  period: { from: "2026-11-01", to: null },
});
const DETAIL_LIVE = {
  ...item({}),
  previous: { id: "r1", version: 1 },
  notes: {
    summary: "Opens with the important moment when the learner moved past a risk cue.",
    changes: [
      {
        area: "Writer prompt v12 → v13",
        what: "Important moment first",
        why: "3 advisor comments",
        before: "Open with strengths",
        after: "Open with the moment",
        source: "diff",
      },
    ],
    written: true,
    writtenBy: null,
    writtenAt: null,
    canWrite: false,
  },
  evidence: {
    beforeLive: {
      ladder: [
        { rung: "quick_test", state: "passed", detail: "Open set, 30" },
        { rung: "gate_test", state: "passed", detail: "Gate set, 100" },
        { rung: "paired_trial", state: "passed", detail: "Better on 11" },
        { rung: "canary", state: "passed", detail: "20 of 20" },
      ],
      ideaId: IDEA.id,
    },
    whileLive: { ...metrics(9.6, 1), previous: metrics(9.2, 3) },
  },
  contents,
  compareWith: "r1",
  can: { rollBack: false, writeNotes: false },
};
const DETAIL_OLD = {
  ...HISTORY.items[1],
  previous: null,
  notes: {
    summary: null,
    changes: [],
    written: false,
    writtenBy: null,
    writtenAt: null,
    canWrite: true,
  },
  evidence: { beforeLive: { ladder: [], ideaId: null }, whileLive: null },
  contents,
  compareWith: null,
  can: { rollBack: true, writeNotes: true },
};

const renderPage = (path = "/debriefs/pm-agent") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PmAgentPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.permissions = TEAM_PERMS;
  h.overview.mockReturnValue(ok(OVERVIEW));
  h.pmAgent.mockReturnValue(state([IDEA]));
  h.models.mockReturnValue(ok(MODELS));
  h.settings.mockReturnValue(ok(SETTINGS));
  h.autonomy.mockReturnValue({ data: undefined });
  h.attention.mockReturnValue({ data: undefined });
  h.reports.mockReturnValue(ok([]));
  h.history.mockReturnValue(ok(HISTORY));
  h.detail.mockImplementation((id: string) => ok(id === "r1" ? DETAIL_OLD : DETAIL_LIVE));
  h.propose.mockReturnValue(
    resolves({ ideaId: "new-idea", releaseId: "d1", version: 7, budgetOnly: false }),
  );
  [
    h.decide,
    h.rollback,
    h.screen,
    h.build,
    h.approvePinned,
    h.ask,
    h.startStep,
    h.answerBuilder,
  ].forEach(f => f.mockReturnValue(resolves()));
  h.builderProgress.mockReturnValue({ data: undefined, isError: false });
  h.runPmAgent.mockReturnValue(resolves({ report: "r", ideas: [] }));
});

describe("PM agent › Ideas", () => {
  it("shows each rung, and no try-out button before the side-by-side trial passes", () => {
    renderPage();
    expect(screen.getByTestId("idea-screen")).toHaveTextContent("+0.50 on 6 sessions");
    expect(screen.getByTestId("idea-gate")).toHaveTextContent("Waiting");
    expect(screen.getByTestId("idea-group-testing")).toHaveTextContent(
      "Put the risk-cue point first",
    );
    expect(
      screen.queryByRole("button", { name: /Approve and try it on some learners/ }),
    ).toBeNull();
  });

  it("names a prompt change's prompt, not its code, and shows the diff", () => {
    renderPage();
    const idea = screen.getByTestId("idea");
    expect(idea).toHaveTextContent("Prompt change · Writer's prompt");
    expect(idea).not.toHaveTextContent("debrief_writer_system");
    expect(screen.getByTestId("idea-diff")).toHaveTextContent("a missed risk cue always first");
  });

  it("reads a setting change, forecast and canary reason in words", () => {
    h.pmAgent.mockReturnValue(
      state([
        {
          ...IDEA,
          change: {
            ...IDEA.change,
            ideaKind: "setting",
            promptCode: null,
            find: null,
            replace: null,
            settingKey: "canaryShare",
            settingValue: "0.2",
          },
          evidence: {
            ...IDEA.evidence,
            forecast: {
              metric: "read_through",
              baseline: 0.5,
              after: 0.6,
              moved: true,
              checkedAt: "2026-10-30T00:00:00Z",
            },
            canary: {
              status: "reverted",
              releaseId: "r3",
              version: 3,
              share: 0.1,
              startedAt: "2026-10-01T00:00:00Z",
              reason: "learning_budget",
            },
          },
        },
      ]),
    );
    renderPage();
    expect(screen.getByTestId("idea-setting")).toHaveTextContent(
      "Try-out share of new debriefs: change to 20%",
    );
    expect(screen.getByTestId("idea-forecast")).toHaveTextContent("Read to the end:");
    expect(screen.getByTestId("idea-canary")).toHaveTextContent(
      "The learning budget for this month is spent",
    );
  });

  it("puts an idea whose trial passed under Needs you; trying it on learners asks first", async () => {
    h.pmAgent.mockReturnValue(
      state([{ ...IDEA, evidence: { ...IDEA.evidence, trial: TRIAL_PASSED } }]),
    );
    renderPage();
    expect(screen.getByTestId("idea-group-needs")).toHaveTextContent(
      "Put the risk-cue point first",
    );
    expect(screen.getByTestId("pm-strip")).toHaveTextContent("1 needs you");
    expect(screen.getByTestId("idea-trial")).toHaveTextContent("34 pairs · +0.40 (+0.10 to +0.70)");
    const approve = screen.getByRole("button", { name: /Approve and try it on some learners/ });
    expect(approve).toHaveTextContent(
      "Recommended · up to 30% of new debriefs; everyone only after a person puts it live",
    );
    fireEvent.click(approve);
    expect(h.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try it on some learners" }));
    await waitFor(() =>
      expect(h.decide).toHaveBeenCalledWith({ id: IDEA.id, decision: "approve" }),
    );
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Trying it on some learners."));
  });

  it("a try-out that passed sits under Trying on learners and goes live for everyone after confirming", async () => {
    h.pmAgent.mockReturnValue(
      state([
        {
          ...IDEA,
          evidence: {
            ...IDEA.evidence,
            trial: TRIAL_PASSED,
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
      ]),
    );
    renderPage();
    expect(screen.getByTestId("idea-group-canary")).toHaveTextContent(
      "Ready to put live for everyone · 31 so far",
    );
    fireEvent.click(screen.getByRole("button", { name: "Put live for everyone" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Put live for everyone" }),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Live for everyone. Every learner now gets this change.",
      ),
    );
  });

  it("an idea that needs code can only be rejected", () => {
    h.pmAgent.mockReturnValue(
      state([
        { ...IDEA, change: { ...IDEA.change, ideaKind: "needs_code", find: null }, evidence: {} },
      ]),
    );
    renderPage();
    expect(
      screen.queryByRole("button", { name: /Approve and try it on some learners/ }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  const BUILDER_HANDOFF = {
    kind: "builder",
    status: "waiting",
    problem: "Learners never see the Practise-next card on Android.",
    evidenceSummary: "practise_click_through 0.08 on android (n=60)",
    expectedEffect: "practise_click_through up",
    acceptanceChecks: ["The card shows first on Android"],
  };
  const forBuilder = (handoff: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    state([
      {
        ...IDEA,
        change: { ...IDEA.change, ideaKind: "needs_code", route: "B", find: null },
        evidence: { commentIds: ["c1", "c2"], handoff: { ...BUILDER_HANDOFF, ...handoff } },
        ...extra,
      },
    ]);
  const SESSION = "22222222-2222-2222-2222-222222222222";
  const renderWithBuilder = () =>
    render(
      <MemoryRouter initialEntries={["/debriefs/pm-agent"]}>
        <Routes>
          <Route path="/debriefs/pm-agent" element={<PmAgentPage />} />
          <Route path="/builder/:sessionId" element={<p>Builder session page</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it("a For Builder idea shows its brief and hands over to the PM agent by default", async () => {
    h.pmAgent.mockReturnValue(forBuilder());
    renderPage();
    const brief = screen.getByTestId("builder-brief");
    expect(brief).toHaveTextContent("Why");
    expect(brief).toHaveTextContent("What Builder should build");
    expect(brief).toHaveTextContent("The card shows first on Android");
    expect(brief).toHaveTextContent("How we’ll know it worked");
    expect(screen.getByText(/2 expert comments/)).toBeInTheDocument();
    const choice = screen.getByTestId("hand-to-builder");
    expect(within(choice).getByText("Who answers Builder’s questions?")).toBeInTheDocument();
    expect(within(choice).getByRole("radio", { name: /The PM agent/ })).toBeChecked();
    expect(within(choice).getByText(/Builder never sees learners’ words/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open a Builder session" })).toBeNull();
    fireEvent.click(within(choice).getByRole("button", { name: "Hand to Builder" }));
    await waitFor(() =>
      expect(h.decide).toHaveBeenCalledWith({
        id: IDEA.id,
        decision: "approve",
        answerer: "pm_agent",
      }),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "Handed to Builder. The PM agent is answering its questions.",
    );
  });

  it("“I’ll answer them myself” hands over and opens that Builder session", async () => {
    h.pmAgent.mockReturnValue(forBuilder());
    h.decide.mockReturnValue(resolves({ stage: "builder", id: SESSION }));
    renderWithBuilder();
    fireEvent.click(screen.getByRole("radio", { name: /I’ll answer them myself/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hand to Builder" }));
    await waitFor(() => expect(screen.getByText("Builder session page")).toBeInTheDocument());
    expect(h.decide).toHaveBeenCalledWith({ id: IDEA.id, decision: "approve", answerer: "person" });
  });

  it("once handed over, shows where Builder is and the question waiting for you", async () => {
    h.pmAgent.mockReturnValue(
      forBuilder(
        { status: "filed", filedId: SESSION, answerer: "pm_agent" },
        { status: "approved" },
      ),
    );
    h.builderProgress.mockReturnValue(
      ok({
        sessionId: SESSION,
        answerer: "pm_agent",
        stage: "interviewing",
        sessionStatus: "INTERVIEWING",
        waiting: {
          kind: "question",
          questionId: "q7",
          prompt: "Should organisations without voice-notes see them?",
          options: [],
          reason: "The brief does not say which organisations.",
        },
        answers: [1, 2, 3, 4, 5, 6].map(i => ({
          questionId: `q${i}`,
          question: `Question ${i}`,
          answer: `Answer ${i}`,
          at: "2026-11-13",
        })),
        pullRequests: [],
      }),
    );
    renderPage();
    expect(screen.queryByTestId("hand-to-builder")).toBeNull();
    expect(screen.getByTestId("builder-stage")).toHaveTextContent("In Builder: interviewing");
    const q = screen.getByTestId("builder-question");
    expect(q).toHaveTextContent("Builder asks you one question. The PM agent answered 6 of 7.");
    expect(q).toHaveTextContent("Should organisations without voice-notes see them?");
    expect(within(q).getByRole("link", { name: "Open the Builder session" })).toHaveAttribute(
      "href",
      `/builder/${SESSION}`,
    );
    fireEvent.click(within(q).getByRole("button", { name: "See the PM agent’s 6 answers" }));
    expect(screen.getByTestId("builder-pm-answers")).toHaveTextContent("Answer 6");
    fireEvent.change(within(q).getByLabelText("Your answer"), {
      target: { value: "Only organisations with voice-notes on." },
    });
    fireEvent.click(within(q).getByRole("button", { name: "Send to Builder" }));
    await waitFor(() =>
      expect(h.answerBuilder).toHaveBeenCalledWith({
        id: IDEA.id,
        questionId: "q7",
        customValues: ["Only organisations with voice-notes on."],
        message: "Only organisations with voice-notes on.",
      }),
    );
  });

  const withOptions = (over: Record<string, unknown> = {}) => {
    h.pmAgent.mockReturnValue(
      forBuilder({ status: "filed", filedId: SESSION, answerer: "person" }, { status: "approved" }),
    );
    h.builderProgress.mockReturnValue(
      ok({
        sessionId: SESSION,
        answerer: "person",
        stage: "interviewing",
        sessionStatus: "INTERVIEWING",
        waiting: {
          kind: "question",
          questionId: "q2",
          prompt: "Should the tool write anything?",
          options: [
            { id: "rw", label: "Read and write" },
            { id: "ro", label: "Read-only", description: "Nothing changes", recommended: true },
          ],
          selection: "single",
          minSelections: null,
          allowCustom: true,
          customPlaceholder: "Your own answer…",
          reason: null,
          ...over,
        },
        answers: [],
        pullRequests: [],
      }),
    );
    renderPage();
    return screen.getByTestId("builder-question");
  };

  it("offers Builder’s own options, recommendation first, and sends the pick as the feed does", async () => {
    const q = withOptions();
    const options = within(q).getAllByRole("button", { pressed: false });
    expect(options.map(o => o.textContent)).toEqual([
      expect.stringContaining("Read-only"),
      expect.stringContaining("Read and write"),
    ]);
    expect(options[0]).toHaveTextContent("Recommended");
    expect(options[0]).toHaveTextContent("Nothing changes");
    // No keyboard hints: the idea card does not answer on keys.
    expect(within(q).queryByText("1")).toBeNull();
    const send = within(q).getByRole("button", { name: "Send to Builder" });
    expect(send).toBeDisabled();
    fireEvent.click(within(q).getByRole("button", { name: /Read-only/ }));
    expect(within(q).getByRole("button", { name: /Read-only/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(send);
    await waitFor(() =>
      expect(h.answerBuilder).toHaveBeenCalledWith({
        id: IDEA.id,
        questionId: "q2",
        selectedOptionIds: ["ro"],
      }),
    );
  });

  it("keeps a “Something else” box; typing replaces a single pick", async () => {
    const q = withOptions();
    fireEvent.click(within(q).getByRole("button", { name: /Read and write/ }));
    fireEvent.change(within(q).getByLabelText("Something else"), {
      target: { value: "Read-only, but log each read" },
    });
    expect(within(q).getByRole("button", { name: /Read and write/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(within(q).getByRole("button", { name: "Send to Builder" }));
    await waitFor(() =>
      expect(h.answerBuilder).toHaveBeenCalledWith({
        id: IDEA.id,
        questionId: "q2",
        customValues: ["Read-only, but log each read"],
        message: "Read-only, but log each read",
      }),
    );
  });

  it("a several-choice question sends every pick, with any words", async () => {
    const q = withOptions({ selection: "multi" });
    expect(q).toHaveTextContent("Pick all that apply.");
    fireEvent.click(within(q).getByRole("button", { name: /Read-only/ }));
    fireEvent.click(within(q).getByRole("button", { name: /Read and write/ }));
    fireEvent.change(within(q).getByLabelText("Something else"), {
      target: { value: "Audit too" },
    });
    fireEvent.click(within(q).getByRole("button", { name: "Send to Builder" }));
    await waitFor(() =>
      expect(h.answerBuilder).toHaveBeenCalledWith({
        id: IDEA.id,
        questionId: "q2",
        selectedOptionIds: ["ro", "rw"],
        customValues: ["Audit too"],
        message: "Audit too",
      }),
    );
  });

  it.each([
    ["building", "In Builder: building"],
    ["pr_open", "In Builder: PR open"],
    ["merged", "In Builder: merged"],
    ["closed", "In Builder: closed"],
  ])("maps the Builder stage %s to “%s”", (stage, line) => {
    h.pmAgent.mockReturnValue(
      forBuilder({ status: "filed", filedId: SESSION, answerer: "person" }, { status: "approved" }),
    );
    h.builderProgress.mockReturnValue(
      ok({
        sessionId: SESSION,
        answerer: "person",
        stage,
        sessionStatus: "COMPLETED",
        waiting: null,
        answers: [],
        pullRequests:
          stage === "pr_open"
            ? [
                {
                  repo: "ally-be",
                  number: 12,
                  url: "https://example.test/pr/12",
                  state: "open",
                  merged: false,
                },
              ]
            : [],
      }),
    );
    renderPage();
    expect(screen.getByTestId("builder-stage")).toHaveTextContent(line);
    expect(screen.getByRole("link", { name: "Open the Builder session" })).toHaveAttribute(
      "href",
      `/builder/${SESSION}`,
    );
    if (stage === "pr_open") {
      expect(screen.getByText(/Waiting for a person to review and merge/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open the pull request" })).toHaveAttribute(
        "href",
        "https://example.test/pr/12",
      );
    }
  });

  it("Bug Hunter's run ids link to their session pages", () => {
    h.pmAgent.mockReturnValue(
      state([
        {
          ...IDEA,
          change: { ...IDEA.change, ideaKind: "defect", route: "C", find: null },
          evidence: {
            handoff: {
              kind: "bug_hunter",
              status: "waiting",
              summary: "Writer times out.",
              runIds: ["run-xyz-123456"],
            },
          },
        },
      ]),
    );
    renderPage();
    const link = within(screen.getByTestId("handoff-runs")).getByRole("link");
    expect(link).toHaveAttribute("href", "/debriefs/sessions/run-xyz-123456");
  });

  it("a pinned-rule proposal waits only on the clinical advisor or the owner", () => {
    const pinned = {
      ...IDEA,
      change: { ...IDEA.change, ideaKind: "pinned_rule", find: null },
      evidence: {},
    };
    h.pmAgent.mockReturnValue(state([pinned]));
    renderPage();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    h.permissions = ["review:admin:debriefs"];
    renderPage();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign off/i })).toBeNull();
  });

  describe("pinned rules: the buttons, the whole rule and Ask for a change", () => {
    const LIVE = "Find every risk cue. Name the moment. Say how they responded.";
    const pinnedIdea = (over: {
      firstVersion?: boolean;
      mine?: boolean;
      can: Record<string, boolean>;
      otherOpen?: number;
    }) => ({
      ...IDEA,
      id: "dddddddd-0000-4000-8000-000000000004",
      title: over.firstVersion
        ? "Approve the current Safety rules (v1)"
        : "Pinned rule: Name every moment",
      change: {
        ...IDEA.change,
        ideaKind: "pinned_rule",
        promptCode: "debrief_safety_reader_system",
        find: over.firstVersion ? null : "Name the moment.",
        replace: over.firstVersion ? null : "Name every moment.",
        firstVersion: over.firstVersion,
        version: over.firstVersion ? 1 : undefined,
      },
      evidence: over.firstVersion ? {} : { why: "Clearer", proposedBy: over.mine ? 7 : 9 },
      state: "open",
      approval: {
        wait: "pinned_rule",
        since: "2026-11-12T00:00:00Z",
        expiresAt: over.firstVersion ? null : "2026-11-26T00:00:00Z",
        expiresInDays: over.firstVersion ? null : 14,
        expired: false,
        expiringSoon: false,
      },
      can: { tryIt: false, askQuestion: false, startStep: false, ...over.can },
      pinnedRule: {
        name: "Safety rules",
        firstVersion: !!over.firstVersion,
        mine: !!over.mine,
        proposedBy: over.firstVersion ? null : over.mine ? 7 : 9,
        liveVersion: 1,
        liveText: LIVE,
        segments: over.firstVersion
          ? [{ text: LIVE, changed: false }]
          : [
              { text: "Find every risk cue. ", changed: false },
              { text: "Name every moment.", changed: true },
              { text: " Say how they responded.", changed: false },
            ],
        stale: false,
        otherOpen: over.otherOpen ?? 0,
        approvedNote: null,
      },
    });
    const buttons = () =>
      within(screen.getByTestId("idea-actions"))
        .getAllByRole("button")
        .map(b => b.textContent);

    beforeEach(() => {
      h.permissions = ["review:admin:debriefs"];
    });

    it("a first version: Approve · Ask for a change, the whole rule open, no expiry", () => {
      h.pmAgent.mockReturnValue(
        state([
          pinnedIdea({
            firstVersion: true,
            can: { approve: true, reject: false, withdraw: false, askForChange: true },
          }),
        ]),
      );
      renderPage();
      expect(buttons()).toEqual(["Approve", "Ask for a change"]);
      expect(screen.getByTestId("idea")).toHaveTextContent(
        "Written by the Ally engineering team and not yet reviewed by a clinician. Read it, then approve it or ask for a change.",
      );
      const rule = screen.getByTestId("pinned-rule-text");
      expect(rule.tagName).not.toBe("DETAILS");
      expect(rule).toHaveTextContent(LIVE);
      expect(screen.queryByTestId("pinned-rule-change")).toBeNull();
      expect(screen.queryByText(/expires/)).toBeNull();
    });

    it("the viewer's own proposal: Approve · Withdraw", async () => {
      h.withdrawPinned.mockReturnValue(resolves(undefined));
      h.pmAgent.mockReturnValue(
        state([
          pinnedIdea({
            mine: true,
            can: { approve: true, reject: false, withdraw: true, askForChange: false },
          }),
        ]),
      );
      renderPage();
      expect(buttons()).toEqual(["Approve", "Withdraw"]);
      fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Withdraw" }));
      await waitFor(() =>
        expect(h.withdrawPinned).toHaveBeenCalledWith({
          id: "dddddddd-0000-4000-8000-000000000004",
        }),
      );
    });

    it("someone else's: Approve · Reject (with a reason) · Ask for a change", async () => {
      h.rejectPinned.mockReturnValue(resolves(undefined));
      h.pmAgent.mockReturnValue(
        state([
          pinnedIdea({
            otherOpen: 1,
            can: { approve: true, reject: true, withdraw: false, askForChange: true },
          }),
        ]),
      );
      renderPage();
      expect(buttons()).toEqual(["Approve", "Reject", "Ask for a change"]);
      // The diff first; the whole rule below it, collapsed, the new wording highlighted.
      expect(screen.getByTestId("idea-diff")).toBeInTheDocument();
      expect(screen.getByTestId("pinned-rule-text").tagName).toBe("DETAILS");
      expect(screen.getByTestId("pinned-rule-change")).toHaveTextContent("Name every moment.");
      expect(screen.getByTestId("pinned-rule-other-open")).toHaveTextContent(
        "Another change to this rule is waiting for approval.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      const dialog = screen.getByRole("dialog");
      // The confirm button is Carbon danger (red).
      expect(within(dialog).getByRole("button", { name: "Reject" })).toHaveAttribute(
        "data-kind",
        "danger",
      );
      fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
      expect(h.rejectPinned).not.toHaveBeenCalled();
      expect(dialog).toHaveTextContent("Say why you are rejecting it.");
      fireEvent.change(within(dialog).getByLabelText("Why are you rejecting it?"), {
        target: { value: "Too vague" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
      await waitFor(() =>
        expect(h.rejectPinned).toHaveBeenCalledWith({
          id: "dddddddd-0000-4000-8000-000000000004",
          reason: "Too vague",
        }),
      );
      expect(h.decide).not.toHaveBeenCalled();
    });

    it("Ask for a change says when the passage isn't found or isn't unique, then sends it", async () => {
      h.proposePinned.mockReturnValue(resolves({ id: "new" }));
      h.pmAgent.mockReturnValue(
        state([
          pinnedIdea({
            firstVersion: true,
            can: { approve: true, reject: false, withdraw: false, askForChange: true },
          }),
        ]),
      );
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Ask for a change" }));
      const form = screen.getByTestId("pinned-rule-ask");
      const passage = within(form).getByLabelText("Passage to change");
      fireEvent.change(passage, { target: { value: "not in the rule" } });
      fireEvent.change(within(form).getByLabelText("Replace it with"), {
        target: { value: "x" },
      });
      fireEvent.change(within(form).getByLabelText("Why"), { target: { value: "Clearer" } });
      fireEvent.click(within(form).getByRole("button", { name: "Send for approval" }));
      expect(form).toHaveTextContent("That passage is not in the current rule.");
      fireEvent.change(passage, { target: { value: ". " } });
      expect(form).toHaveTextContent("appears more than once in the rule");
      expect(h.proposePinned).not.toHaveBeenCalled();
      fireEvent.change(passage, { target: { value: "Name the moment." } });
      fireEvent.click(within(form).getByRole("button", { name: "Send for approval" }));
      await waitFor(() =>
        expect(h.proposePinned).toHaveBeenCalledWith({
          promptCode: "debrief_safety_reader_system",
          find: "Name the moment.",
          replace: "x",
          why: "Clearer",
        }),
      );
    });
  });

  it("shows nothing to act on, and no Run now, to someone without the role", () => {
    h.permissions = [];
    h.pmAgent.mockReturnValue(
      state([{ ...IDEA, evidence: { ...IDEA.evidence, trial: TRIAL_PASSED } }]),
    );
    renderPage();
    expect(screen.queryByRole("button", { name: "Run the PM agent now" })).toBeNull();
    expect(screen.queryByTestId("idea-actions")).toBeNull();
    expect(screen.queryByTestId("idea-group-needs")).toBeNull();
  });

  it("an expiring approval raises a yellow banner that links to the idea", () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    h.pmAgent.mockReturnValue(
      state([
        {
          ...IDEA,
          code: "PM-12",
          approval: {
            wait: "start_canary",
            since: "2026-11-01T00:00:00Z",
            expiresAt: soon,
            expiresInDays: 2,
            expired: false,
            expiringSoon: true,
          },
          evidence: { ...IDEA.evidence, trial: TRIAL_PASSED },
        },
      ]),
    );
    renderPage();
    expect(screen.getByTestId("pm-expiry-banner")).toHaveTextContent("PM-12 expires in 2 days.");
  });

  it("raises the release-waiting banner from attention, linking to Releases", () => {
    h.attention.mockReturnValue({
      data: {
        banners: [
          {
            kind: "release_waiting",
            level: "red",
            count: 1,
            message: "x",
            link: { page: "pm_agent" },
          },
        ],
        counts: { urgent: null, oldestUrgentSince: null, escalatedToMe: null, pmAgentNeedsYou: 0 },
      },
    });
    renderPage();
    const banner = screen.getByTestId("pm-release-waiting-banner");
    expect(banner).toHaveTextContent("would undo a change a person put live");
    expect(within(banner).getByRole("link", { name: "See Releases" })).toHaveAttribute(
      "href",
      "/debriefs/pm-agent?view=releases",
    );
  });

  it("shows what it may change alone as read-only chips", () => {
    const cells = (v: string) => ({ quick_test: v, gate_test: v, paired_trial: v, canary: "ask" });
    h.autonomy.mockReturnValue({
      data: {
        kinds: [
          { kind: "settings", cells: cells("auto"), reason: "agreement 0.71", relockReason: null },
          {
            kind: "prompts",
            cells: cells("ask"),
            reason: "Not yet: agreement below 0.6 (evidence_specificity 0.52).",
            relockReason: null,
          },
          { kind: "pinned_rules", cells: cells("off"), reason: "", relockReason: null },
        ],
      },
    });
    renderPage();
    const chips = screen.getByTestId("autonomy-chips");
    // The checks learners never see always run alone; the chip is about learner try-outs.
    expect(chips).toHaveTextContent("Settings: asks first");
    expect(chips).toHaveTextContent("Prompts and agents: asks first");
    expect(chips).toHaveTextContent("Pinned rules: never");
    // Its reason, on hover, never shows a code.
    for (const chip of chips.querySelectorAll("[title]")) {
      expect(chip.getAttribute("title")).not.toMatch(/[a-z]+_[a-z]+/);
    }
    expect(chips.querySelectorAll("[data-state=asks_first]")[1]).toHaveAttribute(
      "title",
      "Not yet: agreement below 0.6 (Evidence 0.52).",
    ); // One row at lg: the label truncates first, its full words on hover; no inline "hover" hint.
    expect(chips).toHaveClass("lg:flex-nowrap");
    const label = screen.getByTestId("autonomy-label");
    expect(label).toHaveClass("truncate");
    expect(label).toHaveTextContent("Changes without asking a person:");
    expect(label).toHaveAttribute(
      "title",
      "What the PM agent may change without asking a person. Hover a chip for why.",
    );
  });

  it("says on its own only when learner try-outs run alone", () => {
    const all = (v: string) => ({ quick_test: v, gate_test: v, paired_trial: v, canary: v });
    h.autonomy.mockReturnValue({
      data: {
        kinds: [
          { kind: "settings", cells: all("auto"), reason: "", relockReason: null },
          { kind: "prompts", cells: all("ask"), reason: "", relockReason: null },
          { kind: "pinned_rules", cells: all("off"), reason: "", relockReason: null },
        ],
      },
    });
    renderPage();
    const chips = screen.getByTestId("autonomy-chips");
    expect(chips).toHaveTextContent("Settings: on its own");
    expect(chips).toHaveTextContent("Prompts and agents: asks first");
  });

  it("splits ideas into Open and Closed by ally-be's state; a promoted one links to its release", () => {
    h.pmAgent.mockReturnValue(
      state([
        { ...IDEA, state: "open" },
        {
          ...IDEA,
          id: "p1",
          title: "Shorter lines",
          state: "closed",
          closedReason: "promoted",
          releaseVersion: 2,
          releaseId: "r2",
        },
        { ...IDEA, id: "x1", title: "Too late", state: "closed", closedReason: "expired" },
        {
          ...IDEA,
          id: "v1",
          title: "Shorter opening",
          state: "closed",
          closedReason: "reverted",
          closedWhy: "Missed a risk cue in the canary.",
        },
      ]),
    );
    renderPage();
    expect(screen.queryByTestId("idea-group-promoted")).toBeNull();
    // The toggle carries the counts (Notes: like a pull-request list).
    expect(screen.getByRole("button", { name: "Open · 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Closed · 3" }));
    expect(screen.getByTestId("idea-group-promoted")).toHaveTextContent("Became release v2");
    expect(screen.getByTestId("idea-group-expired")).toHaveTextContent("Too late");
    expect(screen.getByTestId("idea-group-reverted")).toHaveTextContent("Missed a risk cue");
    fireEvent.click(within(screen.getByTestId("idea-group-promoted")).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Became release v2" }));
    expect(h.detail).toHaveBeenCalledWith("r2");
    expect(screen.getByTestId("release-detail")).toBeInTheDocument(); // The release title stays on one line: it truncates, with the full text on hover.
    expect(screen.getByTestId("release-header")).toHaveClass("flex-nowrap");
    const title = screen.getByTestId("release-title");
    expect(title.tagName).toBe("H2");
    expect(title).toHaveClass("truncate");
    expect(title).toHaveAttribute("title", title.textContent);
    expect(title.textContent).toMatch(/^v2 · /);
    // When it went live moves to the line below the header.
    expect(screen.getByTestId("release-source")).toContainElement(
      screen.getByTestId("release-when"),
    );
  });

  it("a handed-on idea is Handed on, tagged With Builder, never Live for everyone", () => {
    h.pmAgent.mockReturnValue(
      state([
        {
          ...IDEA,
          id: "b1",
          title: "Show the session language",
          status: "approved",
          state: "closed",
          closedReason: "handed_off",
          change: { ...IDEA.change, ideaKind: "needs_code", route: "B", find: null },
          evidence: {
            commentIds: [],
            handoff: {
              kind: "builder",
              status: "filed",
              filedId: "22222222-2222-2222-2222-222222222222",
              answerer: "pm_agent",
              problem: "Reviewers cannot see the session language.",
              acceptanceChecks: ["The language shows beside the title"],
            },
          },
        },
      ]),
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Closed · 1" }));
    expect(screen.getByTestId("idea-group-promoted")).not.toHaveTextContent(
      "Show the session language",
    );
    const group = screen.getByTestId("idea-group-handed");
    expect(group).toHaveTextContent("Handed on");
    fireEvent.click(within(group).getByRole("button"));
    expect(screen.getByText("With Builder")).toBeInTheDocument();
    expect(screen.queryByText("No longer live")).toBeNull();
  });

  it("proposes a change as a draft release, which opens as an idea", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Propose a change" }));
    const form = screen.getByTestId("propose-change");
    const submit = within(form).getByRole("button", { name: "Propose it" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("What it is, in a few words"), {
      target: { value: "Writer on GPT-4.1" },
    });
    fireEvent.change(within(form).getByLabelText("Writer"), { target: { value: "GPT-4.1" } });
    // A published Skills Store version per prompt; drafts aren't offered.
    const prompt = within(form).getByLabelText("Writer's prompt");
    expect(Array.from((prompt as HTMLSelectElement).options).map(o => o.textContent)).toEqual([
      "v14 · Shorter lines",
      "v13 (in the live release)",
    ]);
    fireEvent.change(prompt, { target: { value: "v14 · Shorter lines" } });
    expect(within(form).queryByTestId("propose-budgets")).toBeNull();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(h.propose).toHaveBeenCalledWith({
        title: "Writer on GPT-4.1",
        steps: [{ step: "writer", model: "gpt-4.1" }],
        prompts: { debrief_writer_system: 14 },
      }),
    );
  });

  it("asks a question about an idea when ally-be allows it", async () => {
    h.pmAgent.mockReturnValue(
      state([
        {
          ...IDEA,
          can: { approve: false, reject: true, tryIt: true, askQuestion: true, startStep: false },
        },
      ]),
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Why now?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(h.ask).toHaveBeenCalledWith({ id: IDEA.id, text: "Why now?" }));
  });

  it("shows the draft release an idea would make", () => {
    h.pmAgent.mockReturnValue(
      state([
        {
          ...IDEA,
          draftRelease: {
            id: "d7",
            version: 7,
            status: "draft",
            compare: { releaseId: "r2" },
            changedVsLive: {
              prompts: [{ code: "debrief_writer_system", before: 12, after: 13, pinned: false }],
              settings: [],
              recipes: [],
              steps: [],
              reply: null,
              orchestrator: null,
              budgetOnly: false,
            },
          },
          evidence: { ...IDEA.evidence, trial: TRIAL_PASSED },
        },
      ]),
    );
    renderPage();
    const box = screen.getByTestId("idea-draft-release");
    expect(box).toHaveTextContent("Draft release v7");
    expect(box).toHaveTextContent("compared with v2 (live)");
    expect(box).toHaveTextContent("Writer's prompt v12 → v13");
  });
});

describe("PM agent › Releases", () => {
  it("lists releases learners have had; the live one shows what changed, did it work, and everything in it", () => {
    renderPage("/debriefs/pm-agent?view=releases");
    expect(screen.getAllByTestId("release-row")).toHaveLength(2);
    const detail = screen.getByTestId("release-detail");
    expect(detail).toHaveTextContent("v2 · Put the risk-cue point first");
    expect(screen.getByTestId("release-source")).toHaveTextContent("From the PM agent's idea");
    const changes = screen.getByTestId("release-changes");
    expect(changes).toHaveTextContent("What changed from v1");
    expect(changes).toHaveTextContent("Opens with the important moment");
    expect(within(changes).getByTestId("release-change")).toHaveTextContent(
      "Why: 3 advisor comments",
    );
    expect(changes).toHaveTextContent("Everything else is the same as v1.");
    const evidence = screen.getByTestId("release-evidence");
    expect(evidence).toHaveTextContent("Before going live");
    expect(evidence).toHaveTextContent("Since going live");
    expect(within(evidence).getByTestId("evidence-stats")).toHaveTextContent("vs 9.2 in v1");
    expect(screen.getByTestId("release-contents").tagName).toBe("DETAILS");
    expect(screen.getByTestId("steps-and-models")).toHaveTextContent("Gemini 3 Flash");
    expect(within(detail).queryByRole("button", { name: "Roll back to this" })).toBeNull();
    expect(screen.getByTestId("on-their-way")).toHaveTextContent("1 change on its way");
  });

  it("rolls back to a retired release after an inline confirm; a failure says so", async () => {
    renderPage("/debriefs/pm-agent?view=releases&releaseId=r1");
    expect(screen.getByTestId("release-source")).toHaveTextContent("retired when v2 went live");
    expect(screen.getByTestId("release-changes")).toHaveTextContent("No note written");
    fireEvent.click(screen.getByRole("button", { name: "Roll back to this" }));
    const confirm = screen.getByTestId("rollback-confirm");
    expect(confirm).toHaveTextContent("Debriefs already written don't change.");
    h.rollback.mockReturnValue(rejects());
    fireEvent.click(within(confirm).getByRole("button", { name: "Roll back" }));
    await waitFor(() => expect(h.rollback).toHaveBeenCalledWith({ id: "r1" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });

  it("shows a release that would undo a change a person put live as waiting, with Put live and Dismiss", async () => {
    h.promoteWaiting.mockReturnValue(resolves());
    h.dismissWaiting.mockReturnValue(resolves());
    h.history.mockReturnValue(
      ok({
        ...HISTORY,
        items: [
          {
            ...HISTORY.items[0],
            cameFrom: {
              kind: "skills_store",
              by: { id: 3, name: "Priya" },
              promptCode: "debrief_writer_system",
              from: 12,
              to: 13,
              note: null,
            },
          },
          HISTORY.items[1],
        ],
        waiting: [
          {
            id: "d9",
            version: 9,
            title: "Writer prompt v13 → v14",
            source: {
              kind: "skills_store",
              by: 3,
              tag: null,
              promptCode: "debrief_writer_system",
              from: 13,
              to: 14,
              note: "Tidy wording",
            },
            wouldUndo: [
              {
                path: "prompts.debrief_writer_system",
                what: "the Writer prompt version",
                live: 13,
                wouldBecome: 14,
                changedBy: { version: 2, ideaId: IDEA.id, label: "idea “Shorter lines” (v2)" },
              },
            ],
            problems: [],
          },
        ],
      }),
    );
    renderPage("/debriefs/pm-agent?view=releases");
    const waiting = screen.getByTestId("release-waiting");
    expect(waiting).toHaveAttribute("role", "alert");
    expect(waiting).toHaveTextContent("Waiting: v9 would undo idea “Shorter lines” (v2).");
    expect(within(waiting).getByTestId("would-undo")).toHaveTextContent(
      "the Writer prompt version: live 13 would become 14",
    );
    expect(screen.getAllByTestId("release-row")[0]).toHaveTextContent(
      "Skills Store · Priya: published Writer's prompt v12 → v13",
    );
    fireEvent.click(within(waiting).getByRole("button", { name: "Dismiss" }));
    fireEvent.change(within(waiting).getByLabelText("Why (optional)"), {
      target: { value: "Keep the promoted one" },
    });
    fireEvent.click(
      within(screen.getByTestId("waiting-confirm")).getByRole("button", { name: "Dismiss" }),
    );
    await waitFor(() =>
      expect(h.dismissWaiting).toHaveBeenCalledWith({ id: "d9", reason: "Keep the promoted one" }),
    );
    fireEvent.click(within(waiting).getByRole("button", { name: "Put live for everyone" }));
    fireEvent.click(
      within(screen.getByTestId("waiting-confirm")).getByRole("button", {
        name: "Put live for everyone",
      }),
    );
    await waitFor(() =>
      expect(h.promoteWaiting).toHaveBeenCalledWith({ id: "d9", reason: undefined }),
    );
  });

  it("offers no roll back when ally-be says the viewer can't", () => {
    h.detail.mockImplementation(() =>
      ok({ ...DETAIL_OLD, can: { rollBack: false, writeNotes: false } }),
    );
    renderPage("/debriefs/pm-agent?view=releases&releaseId=r1");
    expect(screen.queryByRole("button", { name: "Roll back to this" })).toBeNull();
  });
});

describe("PM agent › Test sets", () => {
  it("shows the counts, and adding recent sessions says whether it worked", async () => {
    renderPage("/debriefs/pm-agent?view=test-sets");
    expect(screen.getByTestId("test-sets")).toHaveTextContent("Sealed");
    expect(screen.getByTestId("test-sets")).toHaveTextContent("11");
    fireEvent.click(screen.getByRole("button", { name: "Add recent sessions" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("Recent sessions added to the test sets"),
    );
  });

  it("shows a skeleton while loading and a line on error", () => {
    h.overview.mockReturnValue({ ...ok(undefined), isLoading: true });
    const { unmount } = renderPage("/debriefs/pm-agent?view=test-sets");
    expect(screen.getByTestId("test-sets-loading")).toBeInTheDocument();
    unmount();
    h.overview.mockReturnValue({ ...ok(undefined), isError: true });
    renderPage("/debriefs/pm-agent?view=test-sets");
    expect(screen.getByTestId("test-sets-error")).toHaveTextContent("Couldn't load the test sets.");
  });
});
