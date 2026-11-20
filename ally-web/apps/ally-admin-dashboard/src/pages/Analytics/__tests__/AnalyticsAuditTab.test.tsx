import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startMock = vi.fn();
const refetchRunsMock = vi.fn();
// What the sidebar's list query and the open run's query return; each test sets its own.
let runs: AnalyticsAuditSummary[] = [];
let details: Record<string, AnalyticsAuditDetail> = {};

// Partial mock: the store wires every other slice off `@api`, so replacing the
// whole module would take the app's store down with it. Only the three hooks this
// tab calls are stubbed.
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useStartAnalyticsAuditMutation: () => [startMock, { isLoading: false }],
  useGetAnalyticsAuditsQuery: () => ({
    data: runs,
    isLoading: false,
    isError: false,
    refetch: refetchRunsMock,
  }),
  useGetAnalyticsAuditQuery: (id: string, options?: { skip?: boolean }) => ({
    data: options?.skip ? undefined : details[id],
    isError: false,
  }),
}));

import { en } from "@constants";
import type { AnalyticsAuditDetail, AnalyticsAuditedMessage, AnalyticsAuditSummary } from "@types";

import { AnalyticsAuditTab } from "../tabs/AnalyticsAuditTab";

const strings = en.analyticsAudit;

const entry = (overrides: Partial<AnalyticsAuditedMessage> = {}): AnalyticsAuditedMessage => ({
  messageId: "m1",
  askedAt: "2026-11-10T09:00:00.000Z",
  question: "How many sessions last week?",
  answer: "There were **412** sessions last week.",
  audit: {
    verdict: "correct",
    summary: "Re-ran the count in BigQuery; it matches.",
    issues: [],
  },
  ...overrides,
});

const summary = (overrides: Partial<AnalyticsAuditSummary> = {}): AnalyticsAuditSummary => ({
  id: "run-1",
  ranAt: "2026-11-11T08:00:00.000Z",
  status: "completed",
  trigger: "manual",
  totalMessages: 1,
  completedMessages: 1,
  verdictCounts: { correct: 1 },
  ...overrides,
});

const detail = (
  overrides: Partial<AnalyticsAuditDetail> = {},
  messages: AnalyticsAuditedMessage[] = [entry()],
): AnalyticsAuditDetail => ({ ...summary(), messages, ...overrides });

/** Resolve `startAudit(...)` the way RTK Query's mutation trigger does. */
const startResolves = (value: unknown) =>
  startMock.mockReturnValue({ unwrap: () => Promise.resolve(value) });
const startRejects = (error: unknown) =>
  startMock.mockReturnValue({ unwrap: () => Promise.reject(error) });

/** Click the nth run in the history sidebar (0 is the newest). */
const openRun = async (user: ReturnType<typeof userEvent.setup>, index = 0) => {
  const sidebar = screen.getByRole("complementary", { name: strings.historyTitle });
  // The first button is "New audit"; the runs follow it.
  await user.click(within(sidebar).getAllByRole("button")[index + 1]);
};

describe("AnalyticsAuditTab", () => {
  beforeEach(() => {
    startMock.mockReset();
    refetchRunsMock.mockReset();
    runs = [];
    details = {};
  });

  it("opens on a new audit, and says whose questions an audit covers", () => {
    render(<AnalyticsAuditTab />);

    expect(screen.getByRole("heading", { name: strings.heading })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.start })).toBeEnabled();
    expect(screen.getByText(strings.historyEmpty)).toBeInTheDocument();
    // Unlike the conversations list, this is not private to its author.
    expect(screen.getByText(strings.historyScope)).toBeInTheDocument();
  });

  describe("starting an audit", () => {
    it("audits the last 15 messages unless told otherwise", async () => {
      startResolves({ audit: summary({ id: "run-new", status: "running" }) });
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);

      await user.click(screen.getByRole("button", { name: strings.start }));

      expect(startMock).toHaveBeenCalledWith({ messageCount: 15 });
    });

    it("sends the number picked from the dropdown", async () => {
      startResolves({ audit: summary({ id: "run-new", status: "running" }) });
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);

      await user.click(screen.getByRole("combobox", { name: strings.countLabel }));
      await user.click(screen.getByRole("option", { name: "25" }));
      await user.click(screen.getByRole("button", { name: strings.start }));

      await waitFor(() => expect(startMock).toHaveBeenCalledWith({ messageCount: 25 }));
    });

    it("moves to the run it started, in place of the start controls", async () => {
      runs = [summary({ id: "old", ranAt: "2026-11-01T08:00:00.000Z" })];
      details = {
        old: detail({ id: "old" }, [entry({ question: "An old question?" })]),
        "run-new": detail({ id: "run-new" }, [entry({ question: "A fresh question?" })]),
      };
      startResolves({ audit: summary({ id: "run-new" }) });
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);
      // Nothing is open until a run is picked or started.
      expect(screen.queryByText("An old question?")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: strings.start }));

      expect(await screen.findByText("A fresh question?")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: strings.start })).not.toBeInTheDocument();
    });

    it("goes back to the start controls from New audit", async () => {
      runs = [summary()];
      details = { "run-1": detail() };
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);
      await openRun(user);
      expect(screen.queryByRole("button", { name: strings.start })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: strings.newAudit }));

      expect(screen.getByRole("button", { name: strings.start })).toBeInTheDocument();
      expect(screen.queryByText("How many sessions last week?")).not.toBeInTheDocument();
    });

    it("says so when everything recent was already audited, rather than starting nothing silently", async () => {
      startResolves({ audit: null });
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);

      await user.click(screen.getByRole("button", { name: strings.start }));

      expect(
        await screen.findByText(strings.nothingToAudit.replace("{count}", "15")),
      ).toBeInTheDocument();
    });

    it("explains a refusal when another audit is running, and refreshes the list", async () => {
      startRejects({ status: 409 });
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);

      await user.click(screen.getByRole("button", { name: strings.start }));

      expect(await screen.findByText(strings.alreadyRunning)).toBeInTheDocument();
      expect(refetchRunsMock).toHaveBeenCalled();
    });

    it("reports any other failure to start", async () => {
      startRejects({ status: 500 });
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);

      await user.click(screen.getByRole("button", { name: strings.start }));

      expect(await screen.findByText(strings.startFailed)).toBeInTheDocument();
    });
  });

  describe("a run in progress", () => {
    beforeEach(() => {
      runs = [summary({ status: "running", totalMessages: 4, completedMessages: 1 })];
      details = {
        "run-1": detail({ status: "running", totalMessages: 4, completedMessages: 1 }),
      };
    });

    it("blocks a second start — the server only allows one run at a time", () => {
      render(<AnalyticsAuditTab />);

      expect(screen.getByRole("button", { name: strings.start })).toBeDisabled();
      expect(screen.getByText(strings.runningNotice)).toBeInTheDocument();
    });

    it("shows how far along it is, and that more are coming", async () => {
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);
      await openRun(user);

      expect(
        screen.getAllByText(strings.progress.replace("{done}", "1").replace("{total}", "4")).length,
      ).toBeGreaterThan(0);
      expect(screen.getByText(strings.morePending.replace("{count}", "3"))).toBeInTheDocument();
      // What has finished is already readable.
      expect(screen.getByText("How many sessions last week?")).toBeInTheDocument();
    });
  });

  describe("an audited message", () => {
    it("shows the question, the verdict, the auditor's findings, and the answer it judged", async () => {
      runs = [summary({ verdictCounts: { incorrect: 1 } })];
      details = {
        "run-1": detail({ verdictCounts: { incorrect: 1 } }, [
          entry({
            audit: {
              verdict: "incorrect",
              summary: "The count excludes test orgs; the answer says it does not.",
              issues: [
                {
                  severity: "high",
                  description: "Reports 412, but the documented filter gives 390.",
                },
                { severity: "low", description: "Does not mention the coverage window." },
              ],
            },
          }),
        ]),
      };
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);
      await openRun(user);

      expect(screen.getByText("How many sessions last week?")).toBeInTheDocument();
      expect(
        screen.getByText("The count excludes test orgs; the answer says it does not."),
      ).toBeInTheDocument();
      expect(screen.getByText(strings.issuesTitle)).toBeInTheDocument();
      expect(
        screen.getByText("Reports 412, but the documented filter gives 390."),
      ).toBeInTheDocument();
      expect(screen.getByText(strings.severityHigh)).toBeInTheDocument();
      expect(screen.getByText(strings.severityLow)).toBeInTheDocument();
      // The verdict is on the message and in the run's tally.
      expect(screen.getAllByText(new RegExp(strings.verdictIncorrect)).length).toBeGreaterThan(0);
      expect(screen.getByText(strings.showAnswer)).toBeInTheDocument();
    });

    it("says plainly when the auditor found nothing wrong", async () => {
      runs = [summary()];
      details = { "run-1": detail() };
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);
      await openRun(user);

      expect(screen.getByText(strings.noIssues)).toBeInTheDocument();
    });

    it("reports an auditor failure as that, not as a verdict on the answer, and says it will be retried", async () => {
      runs = [summary({ verdictCounts: { error: 1 } })];
      details = {
        "run-1": detail({ verdictCounts: { error: 1 } }, [
          entry({ audit: null, error: "recursion limit" }),
        ]),
      };
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);
      await openRun(user);

      expect(screen.getByText(strings.entryFailedTitle)).toBeInTheDocument();
      expect(screen.getByText(`recursion limit ${strings.entryFailedNote}`)).toBeInTheDocument();
    });
  });

  describe("history", () => {
    it("lists past runs with their progress and how many came out incorrect", () => {
      runs = [
        summary({
          id: "run-2",
          ranAt: "2026-11-11T08:00:00.000Z",
          totalMessages: 15,
          completedMessages: 15,
          verdictCounts: { correct: 12, incorrect: 3 },
        }),
        summary({ id: "run-1", ranAt: "2026-11-04T08:00:00.000Z", trigger: "scheduled" }),
      ];
      details = { "run-2": detail({ id: "run-2" }), "run-1": detail() };
      render(<AnalyticsAuditTab />);

      const sidebar = screen.getByRole("complementary", { name: strings.historyTitle });
      expect(
        within(sidebar).getByText(
          `${strings.triggerManual} · ${strings.runProgress.replace("{done}", "15").replace("{total}", "15")} · 3 ${strings.verdictIncorrect.toLowerCase()}`,
        ),
      ).toBeInTheDocument();
      // What started each run is on its row: the scheduler's, and one started by hand.
      expect(
        within(sidebar).getByText(
          `${strings.triggerScheduled} · ${strings.runProgress.replace("{done}", "1").replace("{total}", "1")}`,
        ),
      ).toBeInTheDocument();
      // "New audit" first, then one button per run.
      expect(within(sidebar).getByRole("button", { name: strings.newAudit })).toBeInTheDocument();
      expect(within(sidebar).getAllByRole("button")).toHaveLength(3);
    });

    it("says on the open run whether it was scheduled or started by hand", async () => {
      runs = [summary({ trigger: "scheduled" })];
      details = { "run-1": detail({ trigger: "scheduled" }) };
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);
      await openRun(user);

      // On the sidebar row and above the results.
      expect(screen.getAllByText(strings.triggerScheduled).length).toBeGreaterThan(0);
      expect(screen.queryByText(strings.triggerManual)).not.toBeInTheDocument();
    });

    it("opens whichever run is clicked", async () => {
      runs = [
        summary({ id: "run-2", ranAt: "2026-11-11T08:00:00.000Z" }),
        summary({ id: "run-1", ranAt: "2026-11-04T08:00:00.000Z" }),
      ];
      details = {
        "run-2": detail({ id: "run-2" }, [entry({ question: "Newer question?" })]),
        "run-1": detail({ id: "run-1" }, [entry({ question: "Older question?" })]),
      };
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);
      await openRun(user, 0);
      expect(screen.getByText("Newer question?")).toBeInTheDocument();

      await openRun(user, 1);

      expect(await screen.findByText("Older question?")).toBeInTheDocument();
      expect(screen.queryByText("Newer question?")).not.toBeInTheDocument();
    });

    it("explains a run that stopped before it finished", async () => {
      runs = [summary({ status: "failed" })];
      details = { "run-1": detail({ status: "failed" }, []) };
      const user = userEvent.setup();
      render(<AnalyticsAuditTab />);
      await openRun(user);

      expect(screen.getByText(strings.runFailed)).toBeInTheDocument();
    });
  });
});
