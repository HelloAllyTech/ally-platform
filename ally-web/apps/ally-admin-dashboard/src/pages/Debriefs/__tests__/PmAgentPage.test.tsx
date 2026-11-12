import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  overview: vi.fn(),
  pmAgent: vi.fn(),
  releases: vi.fn(),
  models: vi.fn(),
  steps: vi.fn(),
  settings: vi.fn(),
  runPmAgent: vi.fn(),
  screen: vi.fn(),
  decide: vi.fn(),
  rollback: vi.fn(),
  build: vi.fn(),
  setModels: vi.fn(),
  autonomy: vi.fn(),
  approvePinned: vi.fn(),
  ask: vi.fn(),
  startStep: vi.fn(),
  permissions: [] as string[],
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
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSelector: (pick: (state: unknown) => unknown) =>
    pick({ user: { permissions: h.permissions } }),
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefOverviewQuery: () => h.overview(),
  useGetPmAgentStateQuery: () => h.pmAgent(),
  useGetDebriefReleasesQuery: () => h.releases(),
  useGetDebriefModelsQuery: () => h.models(),
  useGetDebriefStepsQuery: () => h.steps(),
  useGetDebriefSettingsQuery: () => h.settings(),
  useRunPmAgentMutation: () => [h.runPmAgent, { isLoading: false }],
  useScreenIdeaMutation: () => [h.screen, { isLoading: false }],
  useDecideIdeaMutation: () => [h.decide, { isLoading: false }],
  useRollbackDebriefReleaseMutation: () => [h.rollback, { isLoading: false }],
  useBuildDebriefTestSetsMutation: () => [h.build, { isLoading: false }],
  useSetDebriefModelsMutation: () => [h.setModels, { isLoading: false }],
  useGetDebriefAutonomyQuery: () => h.autonomy(),
  useApprovePinnedRuleMutation: () => [h.approvePinned, { isLoading: false }],
  useAskIdeaQuestionMutation: () => [h.ask, { isLoading: false }],
  useStartIdeaStepMutation: () => [h.startStep, { isLoading: false }],
  useGetDebriefPinnedRulesQuery: () => ({ data: { rules: [] } }),
}));

/* eslint-disable import/first */
import { PmAgentPage } from "../pm/PmAgentPage";
import {
  IDEA,
  MODELS,
  OVERVIEW,
  RELEASES,
  SETTINGS,
  STEPS,
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
  h.releases.mockReturnValue(ok(RELEASES));
  h.models.mockReturnValue(ok(MODELS));
  h.steps.mockReturnValue(ok(STEPS));
  h.settings.mockReturnValue(ok(SETTINGS));
  h.autonomy.mockReturnValue({ data: undefined });
  [
    h.decide,
    h.rollback,
    h.screen,
    h.build,
    h.setModels,
    h.approvePinned,
    h.ask,
    h.startStep,
  ].forEach(f => f.mockReturnValue(resolves()));
  h.runPmAgent.mockReturnValue(resolves({ report: "r", ideas: [] }));
});

describe("PM agent › Ideas", () => {
  it("shows the report inline, each rung, and no canary button before the paired trial passes", () => {
    renderPage();
    expect(screen.getByTestId("pm-agent-report")).toHaveTextContent("Scores are up.");
    expect(screen.getByTestId("idea-screen")).toHaveTextContent("+0.50 on 6 sessions");
    expect(screen.getByTestId("idea-gate")).toHaveTextContent("Waiting");
    expect(screen.getByTestId("idea-group-testing")).toHaveTextContent(
      "Put the risk-cue point first",
    );
    expect(screen.queryByRole("button", { name: /Approve and start canary/ })).toBeNull();
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
      "Share of live debriefs on the canary: change to 20%",
    );
    expect(screen.getByTestId("idea-forecast")).toHaveTextContent("Read to the end:");
    expect(screen.getByTestId("idea-canary")).toHaveTextContent(
      "The learning budget for this month is spent",
    );
  });

  it("puts an idea whose trial passed under Needs you; starting the canary asks first", async () => {
    h.pmAgent.mockReturnValue(
      state([{ ...IDEA, evidence: { ...IDEA.evidence, trial: TRIAL_PASSED } }]),
    );
    renderPage();
    expect(screen.getByTestId("idea-group-needs")).toHaveTextContent(
      "Put the risk-cue point first",
    );
    expect(screen.getByTestId("pm-strip")).toHaveTextContent("1 needs you");
    expect(screen.getByTestId("idea-trial")).toHaveTextContent("34 pairs · +0.40 (+0.10 to +0.70)");
    const approve = screen.getByRole("button", { name: /Approve and start canary/ });
    expect(approve).toHaveTextContent("Recommended · up to 30% of live debriefs");
    fireEvent.click(approve);
    expect(h.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start the canary" }));
    await waitFor(() =>
      expect(h.decide).toHaveBeenCalledWith({ id: IDEA.id, decision: "approve" }),
    );
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Canary started."));
  });

  it("a canary that passed sits under In canary and is promoted after confirming", async () => {
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
      "Ready to promote · 31 so far",
    );
    fireEvent.click(screen.getByRole("button", { name: "Promote to everyone" }));
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("Promoted. Every learner now gets this change."),
    );
  });

  it("an idea that needs code can only be rejected", () => {
    h.pmAgent.mockReturnValue(
      state([
        { ...IDEA, change: { ...IDEA.change, ideaKind: "needs_code", find: null }, evidence: {} },
      ]),
    );
    renderPage();
    expect(screen.queryByRole("button", { name: /Approve and start canary/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("a Builder brief opens a Builder session only after a person confirms", async () => {
    h.pmAgent.mockReturnValue(
      state([
        {
          ...IDEA,
          change: { ...IDEA.change, ideaKind: "needs_code", route: "B", find: null },
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
      ]),
    );
    renderPage();
    expect(screen.getByTestId("idea-handoff")).toHaveTextContent("The card shows first on Android");
    expect(screen.getByText(/2 expert comments/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open a Builder session" }));
    expect(h.decide).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("button", { name: "Open a Builder session" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(h.decide).toHaveBeenCalledWith({ id: IDEA.id, decision: "approve" }),
    );
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
    expect(screen.queryByRole("button", { name: "Approve the new version" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    h.permissions = ["review:admin:debriefs"];
    renderPage();
    expect(screen.getByRole("button", { name: "Approve the new version" })).toBeInTheDocument();
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

  it("shows what it may change alone as read-only chips", () => {
    const cells = (v: string) => ({ quick_test: v, gate_test: v, paired_trial: v, canary: "ask" });
    h.autonomy.mockReturnValue({
      data: {
        kinds: [
          { kind: "settings", cells: cells("auto"), reason: "agreement 0.71", relockReason: null },
          { kind: "prompts", cells: cells("ask"), reason: "Accuracy 0.52", relockReason: null },
          { kind: "pinned_rules", cells: cells("off"), reason: "", relockReason: null },
        ],
      },
    });
    renderPage();
    const chips = screen.getByTestId("autonomy-chips");
    expect(chips).toHaveTextContent("Settings: yes");
    expect(chips).toHaveTextContent("Prompts and agents: asks first");
    expect(chips).toHaveTextContent("Pinned rules: never");
  });

  it("splits ideas into Open and Closed; a promoted one links to its release", () => {
    h.pmAgent.mockReturnValue(
      state([
        IDEA,
        {
          ...IDEA,
          id: "p1",
          title: "Shorter lines",
          status: "active",
          releaseVersion: 6,
          releaseStatus: "ga",
        },
        {
          ...IDEA,
          id: "x1",
          title: "Too late",
          expired: true,
          notTakenForwardReason: "no_decision",
        },
      ]),
    );
    renderPage();
    expect(screen.queryByTestId("idea-group-promoted")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(screen.getByTestId("idea-group-promoted")).toHaveTextContent("Became release v6");
    expect(screen.getByTestId("idea-group-expired")).toHaveTextContent("Too late");
    fireEvent.click(within(screen.getByTestId("idea-group-promoted")).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Became release v6" }));
    expect(h.releases).toHaveBeenCalled();
    expect(screen.getByTestId("release-detail")).toBeInTheDocument();
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
          releaseVersion: 7,
          releaseStatus: "draft",
          evidence: { ...IDEA.evidence, trial: TRIAL_PASSED },
        },
      ]),
    );
    renderPage();
    const box = screen.getByTestId("idea-draft-release");
    expect(box).toHaveTextContent("Draft release v7");
    expect(box).toHaveTextContent("compared with v2 (live)");
    expect(box).toHaveTextContent("Writer's prompt: a new version");
  });
});

describe("PM agent › Releases", () => {
  it("lists only releases learners have had; the live one shows what changed and its steps read-only", () => {
    h.releases.mockReturnValue(
      ok([
        { ...RELEASES[0], prompts: { debrief_writer_system: 13, debrief_quality_rubric: 2 } },
        {
          ...RELEASES[1],
          promotedAt: "2026-10-02T00:00:00Z",
          prompts: { debrief_writer_system: 12, debrief_quality_rubric: 2 },
        },
        { ...RELEASES[1], id: "draft", version: 3, status: "draft", promotedAt: null },
      ]),
    );
    renderPage("/debriefs/pm-agent?view=releases");
    expect(screen.getAllByTestId("release-row")).toHaveLength(2);
    const detail = screen.getByTestId("release-detail");
    expect(detail).toHaveTextContent("v2");
    expect(screen.getByTestId("release-changes")).toHaveTextContent("Writer's prompt: v12 → v13");
    expect(screen.getByTestId("release-changes")).toHaveTextContent(
      "Everything else is the same as v1.",
    );
    expect(within(detail).queryByRole("button", { name: "Roll back to this" })).toBeNull();
    expect(screen.getByTestId("release-contents").tagName).toBe("DETAILS");
    expect(screen.getByTestId("steps-and-models")).toHaveTextContent("Gemini 3 Flash");
    expect(screen.queryByRole("button", { name: "Make a release with these changes" })).toBeNull();
  });

  it("rolls back to a retired release after an inline confirm; a failure says so", async () => {
    h.releases.mockReturnValue(
      ok([RELEASES[0], { ...RELEASES[1], promotedAt: "2026-10-02T00:00:00Z" }]),
    );
    renderPage("/debriefs/pm-agent?view=releases&release=1");
    fireEvent.click(screen.getByRole("button", { name: "Roll back to this" }));
    const confirm = screen.getByTestId("rollback-confirm");
    expect(confirm).toHaveTextContent("Debriefs already written don't change.");
    h.rollback.mockReturnValue(rejects());
    fireEvent.click(within(confirm).getByRole("button", { name: "Roll back" }));
    await waitFor(() => expect(h.rollback).toHaveBeenCalledWith({ id: "r1" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });

  it("is read-only without the role", () => {
    h.permissions = [];
    h.releases.mockReturnValue(
      ok([RELEASES[0], { ...RELEASES[1], promotedAt: "2026-10-02T00:00:00Z" }]),
    );
    renderPage("/debriefs/pm-agent?view=releases&release=1");
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
