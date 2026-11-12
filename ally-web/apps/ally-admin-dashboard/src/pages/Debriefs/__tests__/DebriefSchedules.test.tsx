import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  schedules: vi.fn(),
  runs: vi.fn(),
  update: vi.fn(),
  features: [] as string[],
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
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefSchedulesQuery: () => h.schedules(),
  useGetDebriefScheduleRunsQuery: (_a: unknown, o: { skip?: boolean }) =>
    o?.skip ? { data: undefined } : h.runs(),
  useUpdateDebriefScheduleMutation: () => [h.update, { isLoading: false }],
  // The rest of the settings page, quiet.
  useGetDebriefSettingsQuery: () => ({ data: undefined }),
  useUpdateDebriefSettingsMutation: () => [vi.fn(), { isLoading: false }],
  useAcceptDebriefBaselineMutation: () => [vi.fn(), { isLoading: false }],
  useRunDebriefBaselineMutation: () => [vi.fn(), { isLoading: false }],
  useGetDebriefOverviewQuery: () => ({ data: undefined }),
  useGetDebriefTenantsQuery: () => ({ data: [] }),
  useSetDebriefTenantLiveMutation: () => [vi.fn(), { isLoading: false }],
  useSetDebriefTenantRegionMutation: () => [vi.fn(), { isLoading: false }],
  useSetDebriefTenantProvidersMutation: () => [vi.fn(), { isLoading: false }],
  useEmergencyStopDebriefTenantMutation: () => [vi.fn(), { isLoading: false }],
  useSetDebriefBudgetsMutation: () => [vi.fn(), { isLoading: false }],
  useGetDebriefMeQuery: () => ({ data: undefined }),
  useGetDebriefAutonomyQuery: () => ({ data: undefined }),
  useSetDebriefAutonomyMatrixMutation: () => [vi.fn(), { isLoading: false }],
  useSetDebriefOrgAutonomyMutation: () => [vi.fn(), { isLoading: false }],
  useGetDebriefPinnedRulesQuery: () => ({ data: { rules: [] } }),
}));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSelector: (pick: (state: unknown) => unknown) =>
    pick({ user: { permissions: ["system:access"], features: h.features } }),
}));
vi.mock("@components/context-collection-link", () => ({
  ContextCollectionLink: () => <div />,
}));

// eslint-disable-next-line import/first
import { en } from "@constants";
// eslint-disable-next-line import/first
import { MemoryRouter } from "react-router-dom";

// eslint-disable-next-line import/first
import { DebriefSettingsPage } from "../settings/DebriefSettingsPage";
// eslint-disable-next-line import/first
import { SchedulesSection } from "../settings/SchedulesSection";

const s = en.debriefs.settingsPage.schedules;

const job = (over: Record<string, unknown>) => ({
  frequency: "daily",
  time: "05:35",
  weekday: null,
  monthDay: null,
  enabled: true,
  locked: false,
  options: ["1min", "60min", "6h", "daily"],
  learningBudget: false,
  runCostUsd: null,
  nextRunAt: "2026-11-13T00:05:00Z",
  running: false,
  lastRun: null,
  ...over,
});

const VIEW = {
  timezone: "Asia/Kolkata",
  jobs: [
    job({
      key: "debrief-agent-drain",
      frequency: "5min",
      time: null,
      locked: true,
      options: ["1min", "5min", "15min"],
      nextRunAt: "2026-11-12T10:10:00Z",
      lastRun: {
        trigger: "schedule",
        startedAt: "2026-11-12T10:05:00Z",
        durationMs: 800,
        result: "ok",
        summary: "0 started",
        error: null,
      },
    }),
    job({
      key: "debrief-pm-agent-expiry",
      lastRun: {
        trigger: "schedule",
        startedAt: "2026-11-12T00:05:00Z",
        durationMs: 300,
        result: "failed",
        summary: null,
        error: "db timeout",
      },
    }),
    job({
      key: "debrief-pm-agent",
      frequency: "weekly",
      time: "07:30",
      weekday: 1,
      options: ["daily", "weekly", "2weeks"],
      learningBudget: true,
      runCostUsd: 0.84,
      nextRunAt: "2026-11-16T02:00:00Z",
    }),
  ],
};

const RUNS = {
  page: 1,
  pageSize: 20,
  total: 2,
  runs: [
    {
      id: "r2",
      key: "debrief-pm-agent",
      trigger: "config_change",
      by: { id: 3, name: "Asha" },
      startedAt: "2026-11-12T09:00:00Z",
      durationMs: null,
      result: "ok",
      summary: null,
      error: null,
      change: {
        before: { frequency: "weekly", time: "07:30", weekday: 1, monthDay: null, enabled: true },
        after: { frequency: "daily", time: "07:30", weekday: null, monthDay: null, enabled: true },
      },
    },
    {
      id: "r1",
      key: "debrief-pm-agent-expiry",
      trigger: "schedule",
      by: null,
      startedAt: "2026-11-12T00:05:00Z",
      durationMs: 1200,
      result: "ok",
      summary: "3 approvals expired",
      error: null,
      change: null,
    },
  ],
};

const resolves = (v: unknown = {}) => ({ unwrap: () => Promise.resolve(v) });

beforeEach(() => {
  vi.clearAllMocks();
  h.features = [];
  h.schedules.mockReturnValue({ data: VIEW });
  h.runs.mockReturnValue({ data: RUNS });
  h.update.mockImplementation(() => resolves());
});

const page = () =>
  render(
    <MemoryRouter>
      <DebriefSettingsPage />
    </MemoryRouter>,
  );

describe("Settings › Schedules: engineering only", () => {
  it("has no menu item or section without the debrief_schedules toggle", () => {
    page();
    expect(screen.queryByRole("link", { name: s.columns.job })).toBeNull();
    expect(screen.queryByText(en.debriefs.settingsPage.nav.schedules)).toBeNull();
    expect(screen.queryByTestId("schedules-table")).toBeNull();
  });

  it("shows the menu item and the table with it", () => {
    h.features = ["debrief_schedules"];
    page();
    expect(
      screen.getByRole("link", { name: en.debriefs.settingsPage.nav.schedules }),
    ).toHaveAttribute("href", "#schedules");
    expect(screen.getByTestId("schedules-table")).toBeInTheDocument();
  });
});

describe("Schedules table", () => {
  it("names each job, never its id; locked jobs are always on; last and next run", () => {
    render(<SchedulesSection />);
    const rows = screen.getAllByTestId("schedule-row");
    expect(rows).toHaveLength(3);
    expect(screen.queryByText(/debrief-agent-drain/)).toBeNull();
    const drain = rows[0];
    expect(within(drain).getByText(s.jobs["debrief-agent-drain"].name)).toBeInTheDocument();
    expect(within(drain).getByText(s.alwaysOn)).toBeInTheDocument();
    expect(within(drain).queryByRole("switch")).toBeNull();
    expect(within(drain).getByText(s.result.ok)).toBeInTheDocument();
    expect(within(drain).getByText(/0 started/)).toBeInTheDocument();
    const expiry = rows[1];
    expect(within(expiry).getByRole("switch")).toBeChecked();
    expect(within(expiry).getByText(s.result.failed)).toBeInTheDocument();
    expect(within(expiry).getByText(/db timeout/)).toBeInTheDocument();
    // Mon 16 Nov 02:00 UTC = 07:30 India time
    expect(within(rows[2]).getByText("Mon 07:30")).toBeInTheDocument();
    expect(within(rows[2]).getByText("16 Nov 07:30")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run now/i })).toBeNull();
  });

  it("a job that calls no model saves a frequency change at once", async () => {
    render(<SchedulesSection />);
    fireEvent.change(screen.getByLabelText(s.oftenLabel(s.jobs["debrief-pm-agent-expiry"].name)), {
      target: { value: s.frequency["1min"] },
    });
    await waitFor(() =>
      expect(h.update).toHaveBeenCalledWith({ key: "debrief-pm-agent-expiry", frequency: "1min" }),
    );
    expect(screen.queryByText(s.budgetBody)).toBeNull();
  });

  it("the PM agent's frequency asks to confirm, with the spend effect, then saves confirmed", async () => {
    render(<SchedulesSection />);
    const name = s.jobs["debrief-pm-agent"].name;
    fireEvent.change(screen.getByLabelText(s.oftenLabel(name)), {
      target: { value: s.frequency.daily },
    });
    expect(h.update).not.toHaveBeenCalled();
    expect(screen.getByText(s.budgetBody)).toBeInTheDocument();
    // 0.84 × 30/7 ≈ $3.60 a month now; 0.84 × 30 = $25.20 after
    expect(screen.getByTestId("schedule-budget-estimate").textContent).toMatch(/3\.60.*25\.20/);
    fireEvent.click(screen.getByRole("button", { name: s.budgetConfirm }));
    await waitFor(() =>
      expect(h.update).toHaveBeenCalledWith({
        key: "debrief-pm-agent",
        frequency: "daily",
        confirmBudget: true,
      }),
    );
  });

  it("switching a job off saves it", async () => {
    render(<SchedulesSection />);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    await waitFor(() =>
      expect(h.update).toHaveBeenCalledWith({ key: "debrief-pm-agent-expiry", enabled: false }),
    );
  });

  it("run history: runs and schedule changes (who, what)", () => {
    render(<SchedulesSection />);
    const details = screen.getByTestId("schedule-history") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const rows = screen.getAllByTestId("schedule-history-row");
    expect(rows[0].textContent).toContain(s.changed);
    expect(rows[0].textContent).toContain("How often: Weekly → Daily");
    expect(rows[0].textContent).toContain("by Asha");
    expect(rows[1].textContent).toContain("3 approvals expired");
    expect(rows[1].textContent).toContain(s.jobs["debrief-pm-agent-expiry"].name);
  });
});
