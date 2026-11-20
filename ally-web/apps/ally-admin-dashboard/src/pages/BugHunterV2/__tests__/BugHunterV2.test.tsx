import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

const api = vi.hoisted(() => ({
  reportQuery: vi.fn(),
  record: vi.fn(),
  settingsQuery: vi.fn(),
  bugsQuery: vi.fn(),
  setMode: vi.fn(),
  start: vi.fn(),
  v1Query: vi.fn(),
}));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetBugHunterV2SettingsQuery: () => api.settingsQuery(),
  useGetBugHunterV2BugsQuery: (args: unknown) => api.bugsQuery(args),
  useSetBugHunterV2ModeMutation: () => [api.setMode, { isLoading: false }],
  useStartBugHunterV2BugMutation: () => [api.start, { isLoading: false }],
  useGetBugHunterV2ReportQuery: (id: unknown) => api.reportQuery(id),
  useGetBugHunterV2V1BugQuery: (id: unknown) => api.v1Query(id),
  useRecordBugHunterV2VerdictMutation: () => [api.record, { isLoading: false }],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BugHunterV2ReportDetail } from "../BugHunterV2ReportDetail";
import { BugHunterV2Board } from "../BugHunterV2Board";
import { BugHunterV2V1Bug } from "../BugHunterV2V1Bug";
import { VerdictForm } from "../VerdictForm";

const strings = en.bugHunterV2;

const detail = (overrides = {}) => ({
  id: 7,
  createdAt: "2026-11-16T09:00:00Z",
  runId: "run-1",
  app: "ally-be",
  source: "issue",
  status: "suggested_fix",
  title: "x returns 0",
  severity: "medium",
  confidence: "medium",
  riskLevel: "low",
  stopReason: null,
  rootCause: "src/x.ts:2 returns a constant",
  finding: { hypothesis: "x returns 0", evidence: ["src/x.ts:2 — returns 0"] },
  repro: {
    test_path: "src/x.repro.spec.ts",
    test_name: "x returns 3",
    source: "it('x returns 3', ...)",
    failure_excerpt: "expected 3, got 0",
  },
  patchDiff: "diff --git a/src/x.ts b/src/x.ts\n-  return 0;\n+  return 3;",
  review: { verdict: "approve", notes: ["fine"], disputed: false },
  verdicts: [],
  ...overrides,
});

beforeEach(() => {
  api.reportQuery.mockReset();
  api.settingsQuery.mockReset();
  api.bugsQuery.mockReset();
  api.setMode.mockReset();
  api.start.mockReset();
  api.setMode.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  api.start.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  api.record.mockReset();
  api.record.mockReturnValue({ unwrap: () => Promise.resolve({}) });
});

const board = strings.board;
const counts = (c = {}) => ({
  needs_you: 0,
  failed: 0,
  in_progress: 0,
  backlog: 0,
  done: 0,
  ...c,
});
const bugRow = (overrides = {}) => ({
  origin: "v2",
  id: 1,
  v1FindingId: null,
  source: "reported",
  app: "ally-web",
  title: "Save does nothing",
  description: "",
  status: "backlog",
  tab: "backlog",
  reason: null,
  severity: null,
  prUrl: null,
  reportId: null,
  runId: null,
  attempts: 0,
  createdAt: "2026-11-16T09:00:00Z",
  startedAt: null,
  finishedAt: null,
  ...overrides,
});
const settingsOf = (mode = "manual") => ({
  data: { mode, dailyRunLimit: 10, startedToday: 2, updatedBy: null, updatedAt: null },
});
const renderBoard = () =>
  render(
    <MemoryRouter>
      <BugHunterV2Board />
    </MemoryRouter>,
  );

describe("Bug Hunter v2 board", () => {
  it("shows the five tabs with counts, in the old Bug Hunter's order", () => {
    api.settingsQuery.mockReturnValue(settingsOf());
    api.bugsQuery.mockReturnValue({
      data: { tab: "needs_you", counts: counts({ needs_you: 2, backlog: 5 }), items: [] },
    });
    renderBoard();
    const tabs = screen.getAllByRole("tab").map(t => t.textContent);
    expect(tabs).toEqual([
      `${board.tabs.needs_you}2`,
      `${board.tabs.failed}0`,
      `${board.tabs.in_progress}0`,
      `${board.tabs.backlog}5`,
      `${board.tabs.done}0`,
    ]);
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(board.tabs.backlog) }));
    expect(api.bugsQuery).toHaveBeenLastCalledWith({ tab: "backlog" });
  });

  it("opens on the first tab with something in it", () => {
    api.settingsQuery.mockReturnValue(settingsOf());
    api.bugsQuery.mockReturnValue({
      data: { tab: "needs_you", counts: counts({ in_progress: 1 }), items: [] },
    });
    renderBoard();
    expect(api.bugsQuery).toHaveBeenLastCalledWith({ tab: "in_progress" });
  });

  it("switches mode, asking before Autonomous", () => {
    api.settingsQuery.mockReturnValue(settingsOf("off"));
    api.bugsQuery.mockReturnValue({ data: { tab: "needs_you", counts: counts(), items: [] } });
    renderBoard();
    expect(screen.getByText(board.modeHelp.off)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: board.modes.manual }));
    expect(api.setMode).toHaveBeenCalledWith("manual");
    fireEvent.click(screen.getByRole("radio", { name: board.modes.autonomous }));
    expect(api.setMode).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: board.confirm }));
    expect(api.setMode).toHaveBeenLastCalledWith("autonomous");
  });

  it("Start fix queues a backlog bug; Retry a failed one", () => {
    api.settingsQuery.mockReturnValue(settingsOf());
    api.bugsQuery.mockReturnValue({
      data: {
        tab: "backlog",
        counts: counts({ backlog: 1, failed: 1 }),
        items: [bugRow(), bugRow({ id: 2, status: "failed", reason: "sandbox died" })],
      },
    });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: board.startFix }));
    expect(api.start).toHaveBeenCalledWith({ id: 1, app: undefined });
    expect(screen.getByText("sandbox died")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: board.retry }));
    expect(api.start).toHaveBeenLastCalledWith({ id: 2, app: undefined });
  });

  it("a reported bug without an app needs one picked before Start fix", () => {
    api.settingsQuery.mockReturnValue(settingsOf());
    api.bugsQuery.mockReturnValue({
      data: { tab: "backlog", counts: counts({ backlog: 1 }), items: [bugRow({ app: null })] },
    });
    renderBoard();
    const button = screen.getByRole("button", { name: board.startFix });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(board.pickApp), { target: { value: "ally-be" } });
    fireEvent.click(button);
    expect(api.start).toHaveBeenCalledWith({ id: 1, app: "ally-be" });
  });

  it("shows the old Bug Hunter's findings with their own status, opening in v1, never startable", () => {
    api.settingsQuery.mockReturnValue(settingsOf());
    api.bugsQuery.mockReturnValue({
      data: {
        tab: "backlog",
        counts: counts({ backlog: 2 }),
        items: [
          bugRow(),
          bugRow({
            origin: "v1",
            id: null,
            v1FindingId: "f-1",
            source: "v1:lint_error",
            status: "approved",
            title: "Old lint bug",
          }),
        ],
      },
    });
    render(
      <MemoryRouter initialEntries={["/bug-hunter-v2"]}>
        <Routes>
          <Route path="/bug-hunter-v2" element={<BugHunterV2Board />} />
          <Route path="/bug-hunter-v2/v1/:findingId" element={<div>v1 bug page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(board.v1Badge)).toBeInTheDocument();
    expect(screen.getByText("Old lint bug")).toBeInTheDocument();
    // Only the v2 row offers Start fix.
    expect(screen.getAllByRole("button", { name: board.startFix })).toHaveLength(1);
    fireEvent.click(screen.getByTestId("bug-row-v1-f-1"));
    // Opens inside v2, not the old Bug Hunter.
    expect(screen.getByText("v1 bug page")).toBeInTheDocument();
  });

  it("explains a missing Bug Hunter database instead of a generic error", () => {
    api.settingsQuery.mockReturnValue({ isError: true, error: { status: 503 } });
    api.bugsQuery.mockReturnValue({ isLoading: false, isError: true, error: { status: 503 } });
    renderBoard();
    expect(screen.getByRole("alert")).toHaveTextContent(strings.unavailable);
  });
});

describe("Bug Hunter v2 report detail", () => {
  it("shows the finding, failing test and patch", () => {
    api.reportQuery.mockReturnValue({ data: detail(), isLoading: false, isError: false });
    render(
      <MemoryRouter initialEntries={["/bug-hunter-v2/7"]}>
        <Routes>
          <Route path="/bug-hunter-v2/:id" element={<BugHunterV2ReportDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(api.reportQuery).toHaveBeenCalledWith(7);
    expect(screen.getByText("src/x.repro.spec.ts::x returns 3")).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "DIV" && el.textContent === "+  return 3;"),
    ).toBeInTheDocument();
    expect(screen.getByText(strings.verdict.title)).toBeInTheDocument();
  });
});

describe("verdict form", () => {
  const renderForm = (props: Partial<React.ComponentProps<typeof VerdictForm>> = {}) =>
    render(<VerdictForm reportId={7} hasPatch current={null} {...props} />);

  it("requires a reason before saving", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(strings.verdict.diagnoses.correct));
    fireEvent.click(screen.getByLabelText(strings.verdict.fixes.worked));
    fireEvent.click(screen.getByRole("button", { name: strings.verdict.submit }));
    expect(api.record).not.toHaveBeenCalled();
    expect(screen.getByText(strings.verdict.reasonRequired)).toBeInTheDocument();
  });

  it("saves diagnosis, fix and reason to the report's verdict endpoint", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(strings.verdict.diagnoses.not_a_bug));
    fireEvent.click(screen.getByLabelText(strings.verdict.fixes.none));
    fireEvent.change(screen.getByLabelText(strings.verdict.reason), {
      target: { value: "  intended behaviour  " },
    });
    fireEvent.click(screen.getByRole("button", { name: strings.verdict.submit }));
    expect(api.record).toHaveBeenCalledWith({
      id: 7,
      diagnosis: "not_a_bug",
      fix: "none",
      reason: "intended behaviour",
    });
  });

  it("without a patch, only 'No fix' can be chosen", () => {
    renderForm({ hasPatch: false });
    expect(screen.getByLabelText(strings.verdict.fixes.worked)).toBeDisabled();
    expect(screen.getByLabelText(strings.verdict.fixes.none)).toBeChecked();
  });

  it("offers to change an existing verdict", () => {
    renderForm({
      current: {
        id: 1,
        diagnosis: "not_a_bug",
        fix: "none",
        reason: "a",
        decidedBy: "42",
        source: "dashboard",
        decidedAt: "2026-11-16T09:00:00Z",
        active: true,
        supersededAt: null,
      },
    });
    expect(screen.getByText(strings.verdict.amendTitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.verdict.amend })).toBeInTheDocument();
  });
});

describe("Bug Hunter v2: an old Bug Hunter finding", () => {
  it("shows it read-only inside v2, with its outcome and history", () => {
    api.v1Query.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        origin: "v1",
        v1FindingId: "f-1",
        source: "v1:reported_bug",
        app: "ally-web",
        title: "Old reported bug",
        description: "Save does nothing",
        status: "merged",
        tab: "done",
        severity: "high",
        file: null,
        evidence: null,
        prUrl: "https://example.test/pr/3",
        escalationQuestion: null,
        escalationAnswer: null,
        decisionReason: null,
        decisionNote: null,
        releaseTag: null,
        createdAt: "2026-10-01T00:00:00Z",
        startedAt: null,
        decidedAt: null,
        releasedAt: null,
        events: [{ stage: "pr_opened", summary: "Opened the fix PR", at: "2026-10-02T00:00:00Z" }],
      },
    });
    render(
      <MemoryRouter initialEntries={["/bug-hunter-v2/v1/f-1"]}>
        <Routes>
          <Route path="/bug-hunter-v2/v1/:findingId" element={<BugHunterV2V1Bug />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(api.v1Query).toHaveBeenCalledWith("f-1");
    expect(screen.getByText("Old reported bug")).toBeInTheDocument();
    expect(screen.getByText(en.bugHunterV2.v1Bug.readOnly)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.test/pr/3" })).toBeInTheDocument();
    expect(screen.getByText("Opened the fix PR")).toBeInTheDocument();
    // Nothing to act on: v2 never runs a v1 bug.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
