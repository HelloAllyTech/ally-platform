import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  runs: vi.fn(),
  runsOptions: vi.fn(),
  run: vi.fn(),
  releases: vi.fn(),
  start: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  access: { current: { canEdit: true } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideSyntheticRunsQuery: (_arg: unknown, options: unknown) => {
    h.runsOptions(options);
    return h.runs();
  },
  useGetAllyGuideSyntheticRunQuery: (id: string) => h.run(id),
  useGetAllyGuideReleasesQuery: () => h.releases(),
  useRunAllyGuideSyntheticMutation: () => [h.start, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { SyntheticPanel } from "../SyntheticPanel";

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });

const night = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  releaseId: "rel-1",
  night: `2026-10-${id}`,
  status: "completed",
  journeys: 6,
  turns: 40,
  passRate: 0.9167,
  safetyFailures: 0,
  drift: false,
  summary: {},
  costUsd: "0.42",
  completedAt: "2026-10-22T04:00:00.000Z",
  createdAt: "2026-10-22T03:00:00.000Z",
  ...overrides,
});

const step = (overrides: Record<string, unknown> = {}) => ({
  passed: true,
  failedChecks: [],
  safetyFailed: false,
  error: null,
  ...overrides,
});

describe("SyntheticPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    h.runs.mockReturnValue(ok([night("22"), night("21", { drift: true, safetyFailures: 2 })]));
    h.releases.mockReturnValue(ok([{ id: "rel-1", version: 12 }]));
    h.run.mockReturnValue(ok(night("22")));
    h.start.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("lists each night with its release, pass rate, safety failures, drift and cost", () => {
    render(<SyntheticPanel />);

    const [first, second] = screen.getAllByTestId("synthetic-run-row");
    expect(first).toHaveTextContent("2026-10-22");
    expect(first).toHaveTextContent("v12");
    expect(first).toHaveTextContent("Done");
    expect(first).toHaveTextContent("91.7%");
    expect(first).toHaveTextContent("Steady");
    expect(first).toHaveTextContent("$0.42");
    expect(second).toHaveTextContent("Drift");
  });

  it("does not poll while every night is finished, and polls while one is running", () => {
    render(<SyntheticPanel />);
    expect(h.runsOptions).toHaveBeenLastCalledWith({ pollingInterval: 0 });

    h.runs.mockReturnValue(ok([night("23", { status: "running", passRate: null })]));
    render(<SyntheticPanel />);
    expect(h.runsOptions).toHaveBeenLastCalledWith({ pollingInterval: 5000 });
  });

  it("shows a dash for a release it cannot find, and for a pass rate not yet known", () => {
    h.runs.mockReturnValue(ok([night("23", { releaseId: "gone", passRate: null })]));
    render(<SyntheticPanel />);

    expect(screen.getByTestId("synthetic-run-row")).toHaveTextContent("—");
  });

  it("says when no night has run", () => {
    h.runs.mockReturnValue(ok([]));
    render(<SyntheticPanel />);

    expect(screen.getByTestId("ally-empty")).toHaveTextContent("No synthetic night has run yet");
  });

  it("offers a retry when the list fails", () => {
    const refetch = vi.fn();
    h.runs.mockReturnValue({ isLoading: false, isError: true, error: {}, refetch });
    render(<SyntheticPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("starts a run only after a confirmation that says it costs money", async () => {
    render(<SyntheticPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Run now…" }));
    expect(
      screen.getByRole("dialog", { name: "Run the synthetic journeys now" }),
    ).toHaveTextContent("costs money");
    expect(h.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run journeys" }));

    await waitFor(() => expect(h.start).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Started. The night appears in the list when it finishes.",
      ),
    );
  });

  it("keeps the dialog open and says so when starting fails", async () => {
    h.start.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "One is already running." } }),
    });
    render(<SyntheticPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Run now…" }));
    fireEvent.click(screen.getByRole("button", { name: "Run journeys" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("hides starting a run without the edit grant", () => {
    h.access.current = { canEdit: false };
    render(<SyntheticPanel />);

    expect(screen.queryByRole("button", { name: "Run now…" })).not.toBeInTheDocument();
    expect(screen.getByTestId("synthetic-runs")).toBeInTheDocument();
  });

  it("opens a night to its drift verdict: reasons, newly failing journeys and the baseline", () => {
    h.run.mockReturnValue(
      ok(
        night("21", {
          drift: true,
          summary: {
            verdict: {
              drift: true,
              reasons: ["Pass rate fell from 95% to 80%"],
              baselineMedian: 0.95,
              newlyFailing: ["crisis", "refusal"],
            },
            journeys: [],
          },
        }),
      ),
    );
    render(<SyntheticPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open the synthetic run of 2026-10-21" }));

    expect(h.run).toHaveBeenCalledWith("21");
    expect(screen.getByRole("dialog")).toHaveTextContent("Synthetic run of 2026-10-21");
    expect(screen.getByTestId("synthetic-reasons")).toHaveTextContent(
      "Pass rate fell from 95% to 80%",
    );
    expect(screen.getByTestId("synthetic-detail")).toHaveTextContent(
      "Newly failing: crisis, refusal",
    );
    expect(screen.getByTestId("synthetic-detail")).toHaveTextContent(
      "Recent median pass rate: 95%",
    );
    expect(screen.getByTestId("synthetic-detail")).toHaveTextContent("No journeys were recorded.");
  });

  it("says a steady night is steady, and when there is no baseline yet", () => {
    h.run.mockReturnValue(
      ok(
        night("22", {
          summary: {
            verdict: { drift: false, reasons: [], baselineMedian: null, newlyFailing: [] },
          },
        }),
      ),
    );
    render(<SyntheticPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open the synthetic run of 2026-10-22" }));

    expect(screen.getByTestId("synthetic-steady")).toBeInTheDocument();
    expect(screen.getByTestId("synthetic-detail")).toHaveTextContent("no recent baseline yet");
  });

  it("lists each journey, and only the steps that failed, by check name", () => {
    h.run.mockReturnValue(
      ok(
        night("22", {
          summary: {
            journeys: [
              {
                key: "grief",
                persona: "Grieving parent",
                trackId: "t-1",
                passed: true,
                steps: [step(), step()],
              },
              {
                key: "crisis",
                persona: "",
                trackId: "t-2",
                passed: false,
                steps: [
                  step(),
                  step({ passed: false, failedChecks: ["no_prompt_leak"], safetyFailed: true }),
                  step({ passed: false, error: "timed out" }),
                ],
              },
            ],
          },
        }),
      ),
    );
    render(<SyntheticPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open the synthetic run of 2026-10-22" }));

    const [grief, crisis] = screen.getAllByTestId("synthetic-journey-row");
    expect(grief).toHaveTextContent("Grieving parent");
    expect(grief).toHaveTextContent("Passed");
    expect(grief).not.toHaveTextContent("Step");
    expect(crisis).toHaveTextContent("crisis");
    expect(crisis).toHaveTextContent("Failed");
    expect(within(crisis).getByText("Step 2: no_prompt_leak, safety")).toBeInTheDocument();
    expect(within(crisis).getByText("Step 3: timed out")).toBeInTheDocument();
  });

  it("says when the run itself failed, instead of a verdict", () => {
    h.run.mockReturnValue(ok(night("22", { status: "error", summary: { error: "model down" } })));
    render(<SyntheticPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open the synthetic run of 2026-10-22" }));

    expect(screen.getByTestId("synthetic-detail")).toHaveTextContent(
      "The run itself failed: model down",
    );
    expect(screen.queryByTestId("synthetic-steady")).not.toBeInTheDocument();
  });

  it("closes the detail", () => {
    render(<SyntheticPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open the synthetic run of 2026-10-22" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByTestId("synthetic-detail")).not.toBeInTheDocument();
  });
});
