import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const approveMock = vi.fn();
const rejectMock = vi.fn();
const startMock = vi.fn();
let runs: AnalyticsAutomationRunSummary[] = [];
let details: Record<string, AnalyticsAutomationRunDetail> = {};

// Partial mock: the store wires every other slice off `@api`, so only the hooks
// this tab calls are stubbed.
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetAnalyticsAutomationRunsQuery: () => ({ data: runs, isLoading: false, isError: false }),
  useGetAnalyticsAutomationRunQuery: (id: string, options?: { skip?: boolean }) => ({
    data: options?.skip ? undefined : details[id],
    isError: false,
  }),
  useStartAnalyticsAutomationRunMutation: () => [startMock, { isLoading: false }],
  useApproveAnalyticsAutomationAgentMutation: () => [approveMock, { isLoading: false }],
  useRejectAnalyticsAutomationAgentMutation: () => [rejectMock, { isLoading: false }],
}));

import { en } from "@constants";
import type {
  AnalyticsAutomationAgentRun,
  AnalyticsAutomationRunDetail,
  AnalyticsAutomationRunSummary,
} from "@types";

import { AnalyticsAutomationTab } from "../tabs/AnalyticsAutomationTab";

const strings = en.analyticsAutomation;

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );

const agent = (overrides: Partial<AnalyticsAutomationAgentRun>): AnalyticsAutomationAgentRun => ({
  id: "a",
  agent: "posthog_events",
  status: "completed",
  startedAt: null,
  finishedAt: null,
  summary: null,
  note: null,
  output: {},
  pullRequest: null,
  review: null,
  decision: null,
  decidedAt: null,
  canApprove: false,
  canReject: false,
  findings: [],
  ...overrides,
});

const run = (agentRuns: AnalyticsAutomationAgentRun[]): AnalyticsAutomationRunDetail => ({
  id: "run-1",
  ranAt: "2026-11-09T02:00:00.000Z",
  finishedAt: "2026-11-09T02:10:00.000Z",
  status: "completed",
  agents: agentRuns.map(a => ({ agent: a.agent, status: a.status })),
  commitShas: {
    platform: { base: null, head: "abcdef1234567", since: "2026-11-02T00:00:00.000Z" },
    dbt: { head: "1234567abcdef" },
  },
  agentRuns,
});

const open = (detail: AnalyticsAutomationRunDetail) => {
  runs = [detail];
  details = { [detail.id]: detail };
};

describe("AnalyticsAutomationTab", () => {
  beforeEach(() => {
    approveMock.mockReset();
    rejectMock.mockReset();
    startMock.mockReset();
    runs = [];
    details = {};
  });

  it("says when no run exists yet, and still offers Run now", () => {
    render(<AnalyticsAutomationTab />);
    expect(screen.getByText(strings.historyEmpty)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.runNow })).toBeEnabled();
  });

  it("starts a run on demand and opens it", async () => {
    startMock.mockReturnValue({ unwrap: () => Promise.resolve({ id: "run-new" }) });
    render(<AnalyticsAutomationTab />);
    await userEvent.click(screen.getByRole("button", { name: strings.runNow }));
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(strings.runNowFailed)).not.toBeInTheDocument();
  });

  it("says so when a run can't be started, for example one is already in progress", async () => {
    startMock.mockReturnValue({ unwrap: () => Promise.reject(new Error("409")) });
    render(<AnalyticsAutomationTab />);
    await userEvent.click(screen.getByRole("button", { name: strings.runNow }));
    expect(await screen.findByText(strings.runNowFailed)).toBeInTheDocument();
  });

  it("opens the newest run and shows the PostHog agent, the definition changes and the dbt agent, in that order, with no backend review", () => {
    open(
      run([
        agent({ id: "2", agent: "posthog_events", summary: "No pull request opened." }),
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "waiting",
          note: "Waiting for the PostHog events agent to finish.",
        }),
      ]),
    );
    render(<AnalyticsAutomationTab />);

    // The first h3 is the run's own title.
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map(h => h.textContent)
      .slice(1);
    expect(headings).toEqual([strings.agentPosthog, strings.definitionTitle, strings.agentDbt]);
    expect(screen.queryByText(/backend review/i)).not.toBeInTheDocument();
    expect(screen.getByText(strings.definitionWorking)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the PostHog events agent/)).toBeInTheDocument();
    // Nothing to approve while it waits.
    expect(screen.queryByRole("button", { name: strings.approve })).not.toBeInTheDocument();
  });

  it("lists what changed in the database and metric definitions, from the dbt agent's output", () => {
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "awaiting_approval",
          output: {
            definitionChanges: [
              {
                area: "database",
                title: "scenario_sessions.deletedAt added",
                description: "Soft delete.",
                sourcePaths: ["ally-be/src/x.ts"],
                affectsDbt: true,
              },
              {
                area: "metric_definition",
                title: "Completed means score above 60",
                description: "Threshold moved.",
                sourcePaths: [],
                affectsDbt: false,
              },
            ],
          },
        }),
      ]),
    );
    render(<AnalyticsAutomationTab />);

    expect(screen.getByText("scenario_sessions.deletedAt added")).toBeInTheDocument();
    expect(screen.getByText(strings.areaDatabase)).toBeInTheDocument();
    expect(screen.getByText(strings.areaMetricDefinition)).toBeInTheDocument();
    expect(screen.getByText(strings.affectsDbt)).toBeInTheDocument();
    expect(screen.getByText(strings.noDbtImpact)).toBeInTheDocument();
    expect(screen.getByText(/ally-be\/src\/x\.ts/)).toBeInTheDocument();
  });

  it("puts changes that need dbt first, counts them, and folds long file lists", () => {
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "awaiting_approval",
          output: {
            definitionChanges: [
              {
                area: "enum",
                title: "Only worth knowing",
                description: "FYI.",
                sourcePaths: [],
                affectsDbt: false,
              },
              {
                area: "database",
                title: "Needs dbt",
                description: "Column added.",
                sourcePaths: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
                affectsDbt: true,
              },
            ],
          },
        }),
      ]),
    );
    render(<AnalyticsAutomationTab />);

    const titles = screen.getAllByText(/^(Needs dbt|Only worth knowing)$/).map(e => e.textContent);
    expect(titles).toEqual(["Needs dbt", "Only worth knowing"]);
    expect(screen.getByText(fill(strings.definitionCount, { count: 2 }))).toBeInTheDocument();
    expect(
      screen.getByText(fill(strings.definitionNeedDbtCount, { count: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByText("c.ts")).toBeInTheDocument();
    expect(screen.queryByText("d.ts")).not.toBeInTheDocument();
    expect(screen.getByText(fill(strings.filesMore, { count: 2 }))).toBeInTheDocument();
  });

  it("says so when the analysis found no definition changes", () => {
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "completed",
          output: { definitionChanges: [] },
          summary: "Nothing to do.",
        }),
      ]),
    );
    render(<AnalyticsAutomationTab />);
    expect(screen.getByText(strings.definitionNone)).toBeInTheDocument();
  });

  it("shows the plan with the PostHog-dependent items apart, and what each outcome of the PostHog PR means", () => {
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "awaiting_approval",
          canApprove: true,
          canReject: true,
          summary: "Plan overview.",
          findings: [
            {
              id: "f1",
              kind: "dbt_change",
              title: "Add deletedAt",
              detail: "Column",
              payload: {
                steps: ["Add the column to stg_scenario_sessions"],
                dbtFiles: ["models/staging/stg_scenario_sessions.sql"],
                dependsOnPosthog: false,
              },
              status: "proposed",
            },
            {
              id: "f2",
              kind: "dbt_change",
              title: "Add lesson_completed",
              detail: "New event",
              payload: { steps: [], dbtFiles: [], dependsOnPosthog: true },
              status: "proposed",
            },
          ],
        }),
      ]),
    );
    render(<AnalyticsAutomationTab />);

    expect(screen.getByText(strings.planTitle)).toBeInTheDocument();
    expect(screen.getByText("Add the column to stg_scenario_sessions")).toBeInTheDocument();
    expect(screen.getByText(strings.planAlways)).toBeInTheDocument();
    expect(screen.getByText(strings.planIfMerged)).toBeInTheDocument();
    // Both outcomes are spelled out: merged applies 2 changes, closed applies 1.
    const merged = screen.getByText(strings.planScenarioMerged).parentElement as HTMLElement;
    const closed = screen.getByText(strings.planScenarioClosed).parentElement as HTMLElement;
    expect(within(merged).getByText("2")).toBeInTheDocument();
    expect(within(closed).getByText("1")).toBeInTheDocument();
  });

  it("does not split the plan into groups when nothing in it depends on PostHog", () => {
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "awaiting_approval",
          canApprove: true,
          canReject: true,
          findings: [
            {
              id: "f1",
              kind: "dbt_change",
              title: "Add deletedAt",
              detail: "Column",
              payload: { dependsOnPosthog: false },
              status: "proposed",
            },
          ],
        }),
      ]),
    );
    render(<AnalyticsAutomationTab />);
    expect(screen.getByText("Add deletedAt")).toBeInTheDocument();
    expect(screen.queryByText(strings.planAlways)).not.toBeInTheDocument();
    expect(screen.queryByText(strings.planIfMerged)).not.toBeInTheDocument();
  });

  it("shows the PostHog pull request with its state and the review verdict", () => {
    open(
      run([
        agent({
          id: "2",
          agent: "posthog_events",
          pullRequest: {
            repo: "Org/platform",
            number: 7,
            url: "https://github.com/Org/platform/pull/7",
            state: "open",
          },
          review: { verdict: "concerns", summary: "One property looks risky." },
        }),
      ]),
    );
    render(<AnalyticsAutomationTab />);

    const link = screen.getByRole("link", { name: "Org/platform#7" });
    expect(link).toHaveAttribute("href", "https://github.com/Org/platform/pull/7");
    expect(screen.getByText(strings.prOpen)).toBeInTheDocument();
    expect(screen.getByText(strings.reviewConcerns)).toBeInTheDocument();
  });

  it("shows what the dbt agent is doing about the pull request's CI, and the outcome", () => {
    const pr = {
      repo: "Org/dbt",
      number: 9,
      url: "https://github.com/Org/dbt/pull/9",
      state: "open" as const,
    };
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "applying",
          pullRequest: pr,
          output: {
            ci: {
              state: "fixing",
              attempts: 1,
              message: "CI failed (dbt test). Working on a fix, attempt 1 of 3.",
              failedChecks: ["dbt test"],
            },
          },
        }),
      ]),
    );
    const { unmount } = render(<AnalyticsAutomationTab />);
    expect(screen.getByText(strings.ciFixing)).toBeInTheDocument();
    expect(screen.getByText(/Working on a fix, attempt 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText(fill(strings.ciAttempts, { attempts: 1 }))).toBeInTheDocument();
    unmount();

    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "pr_opened",
          pullRequest: pr,
          output: {
            ci: {
              state: "green",
              attempts: 1,
              message: "All checks passed after 1 fix.",
              failedChecks: [],
            },
          },
        }),
      ]),
    );
    render(<AnalyticsAutomationTab />);
    expect(screen.getByText(strings.ciGreen)).toBeInTheDocument();
    expect(screen.queryByText(strings.ciFixing)).not.toBeInTheDocument();
  });

  it("shows no CI line when none was recorded (older runs, or no pull request)", () => {
    open(run([agent({ id: "3", agent: "dbt_metrics", status: "completed", summary: "s" })]));
    render(<AnalyticsAutomationTab />);
    expect(screen.queryByText(strings.ciTitle)).not.toBeInTheDocument();
  });

  it("lets a reader approve the dbt proposal", async () => {
    approveMock.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "awaiting_approval",
          canApprove: true,
          canReject: true,
          summary: "Two changes needed.",
          findings: [
            {
              id: "f1",
              kind: "dbt_change",
              title: "Add lesson_completed",
              detail: "New event",
              payload: {},
              status: "proposed",
            },
          ],
        }),
      ]),
    );
    const user = userEvent.setup();
    render(<AnalyticsAutomationTab />);

    expect(screen.getByText("Add lesson_completed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: strings.approve }));
    expect(approveMock).toHaveBeenCalledWith("3");
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it("lets a reader reject the dbt proposal", async () => {
    rejectMock.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "awaiting_approval",
          canApprove: true,
          canReject: true,
          summary: "s",
        }),
      ]),
    );
    const user = userEvent.setup();
    render(<AnalyticsAutomationTab />);

    await user.click(screen.getByRole("button", { name: strings.reject }));
    expect(rejectMock).toHaveBeenCalledWith("3");
  });

  it("says so when approving fails, instead of failing silently", async () => {
    approveMock.mockReturnValue({ unwrap: () => Promise.reject({ status: 409 }) });
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "awaiting_approval",
          canApprove: true,
          canReject: true,
          summary: "s",
        }),
      ]),
    );
    const user = userEvent.setup();
    render(<AnalyticsAutomationTab />);

    await user.click(screen.getByRole("button", { name: strings.approve }));
    expect(await screen.findByText(strings.approveFailed)).toBeInTheDocument();
  });

  it("offers no decision once the proposal is decided", () => {
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "rejected",
          decision: "rejected",
          summary: "s",
        }),
      ]),
    );
    render(<AnalyticsAutomationTab />);
    expect(screen.queryByRole("button", { name: strings.approve })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.reject })).not.toBeInTheDocument();
    expect(screen.getAllByText(strings.decisionRejected).length).toBeGreaterThan(0);
  });

  it("flags a run that is waiting on a person in the sidebar", () => {
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "awaiting_approval",
          canApprove: true,
          canReject: true,
          summary: "s",
        }),
      ]),
    );
    render(<AnalyticsAutomationTab />);
    const sidebar = screen.getByRole("complementary", { name: strings.historyTitle });
    expect(within(sidebar).getByText(strings.statusAwaitingApproval)).toBeInTheDocument();
  });
});
