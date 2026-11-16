import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

const api = vi.hoisted(() => ({
  reportsQuery: vi.fn(),
  reportQuery: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetBugHunterV2ReportsQuery: (args: unknown) => api.reportsQuery(args),
  useGetBugHunterV2ReportQuery: (id: unknown) => api.reportQuery(id),
  useRecordBugHunterV2VerdictMutation: () => [api.record, { isLoading: false }],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BugHunterV2ReportDetail } from "../BugHunterV2ReportDetail";
import { BugHunterV2Reports } from "../BugHunterV2Reports";
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
  api.reportsQuery.mockReset();
  api.reportQuery.mockReset();
  api.record.mockReset();
  api.record.mockReturnValue({ unwrap: () => Promise.resolve({}) });
});

describe("Bug Hunter v2 reports list", () => {
  it("asks for open reports first and switches filters", () => {
    api.reportsQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(
      <MemoryRouter>
        <BugHunterV2Reports />
      </MemoryRouter>,
    );
    expect(api.reportsQuery).toHaveBeenLastCalledWith({ status: "open" });
    expect(screen.getByText(strings.empty)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: strings.filters.judged }));
    expect(api.reportsQuery).toHaveBeenLastCalledWith({ status: "judged" });
  });

  it("explains a missing Bug Hunter database instead of a generic error", () => {
    api.reportsQuery.mockReturnValue({ isLoading: false, isError: true, error: { status: 503 } });
    render(
      <MemoryRouter>
        <BugHunterV2Reports />
      </MemoryRouter>,
    );
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
