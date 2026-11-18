import { fireEvent, render, screen, within } from "@testing-library/react";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ q: vi.fn() }));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefGuidanceMetricsQuery: (args: unknown) => h.q(args),
}));
vi.mock("@components/charts", () => ({
  LineChart: ({ data }: any) => <div data-testid="line">{data.length}</div>,
}));
vi.mock("@hooks/useColorMode", () => ({ useColorMode: () => ({ isDark: false }) }));
vi.mock("../../Analytics/chartKit", () => ({
  lineOpts: () => ({}),
  ChartCard: ({ title, empty, children }: any) => (
    <div data-testid={`chart-${title}`}>{empty ? "empty" : children}</div>
  ),
  KpiTile: ({ label, value }: any) => (
    <div data-testid={`tile-${label}`}>
      {label}: {value}
    </div>
  ),
}));

// eslint-disable-next-line import/first
import { GuidanceSection } from "../metrics/GuidanceSection";

const data = (over: Record<string, unknown> = {}) => ({
  window: { from: "2026-10-18", to: "2026-11-17", days: 30 },
  mode: "all",
  runs: { total: 40, withAgent: 10, withLookup: 38, agentOnly: 2, lookupOnly: 30, neither: 0 },
  planner: {
    decided: 40,
    chose: 10,
    skipped: 30,
    skipReasons: [{ why: "Nothing unusual in the conversation", count: 22 }],
  },
  tools: [
    {
      step: "explore",
      tool: "guidance_search",
      calls: 12,
      ok: 11,
      avgMs: 340,
      p90Ms: 800,
      avgCodes: 3.5,
    },
  ],
  entries: [
    { code: "FP-0142", title: "Naming a risk gently", kind: null, fetched: 9, given: 5, runs: 4 },
  ],
  latency: {
    lookup: { n: 38, p50Ms: 120, p90Ms: 300 },
    agent: { n: 10, p50Ms: 4200, p90Ms: 9000 },
  },
  compare: {
    withAgent: { n: 10, avgJudge: null, avgCostUsd: null },
    withoutAgent: { n: 30, avgJudge: 7.4, avgCostUsd: 0.0123 },
  },
  daily: [{ date: "2026-11-16", runs: 5, withAgent: 2, avgLookupMs: 110, avgAgentMs: null }],
  ...over,
});

beforeEach(() => {
  h.q.mockReset();
  h.q.mockReturnValue({ data: data(), isLoading: false, isError: false, refetch: vi.fn() });
});

describe("Analytics › Debriefs › Guidance", () => {
  it("renders tiles, tools, entries, comparison and skip reasons", () => {
    render(<GuidanceSection />);
    expect(screen.getByTestId("tile-Debriefs")).toHaveTextContent("40");
    expect(screen.getByTestId("tile-Agent chosen")).toHaveTextContent("25%");
    expect(screen.getByTestId("tile-Lookup time (median)")).toHaveTextContent("120 ms");
    expect(screen.getByTestId("tile-Agent time (median)")).toHaveTextContent("4,200 ms");
    expect(within(screen.getByTestId("guidance-tools")).getByText("Search")).toBeTruthy();
    const entry = screen.getByTestId("guidance-entry-FP-0142");
    expect(entry).toHaveTextContent("Naming a risk gently");
    expect(entry).toHaveTextContent("FP-0142");
    expect(screen.getByTestId("guidance-skips")).toHaveTextContent("22×");
    expect(screen.getByTestId("guidance-compare")).toHaveTextContent("about a point");
    expect(screen.getAllByTestId("line")).toHaveLength(2);
  });

  it("tolerates null scores and costs", () => {
    render(<GuidanceSection />);
    expect(screen.getByTestId("guidance-compare-with")).toHaveTextContent("—");
    expect(screen.getByTestId("guidance-compare-without")).toHaveTextContent("7.4");
    expect(screen.getByTestId("guidance-compare-without")).toHaveTextContent("$0.01");
  });

  it("says so when there are no debriefs yet", () => {
    h.q.mockReturnValue({
      data: data({
        runs: { total: 0, withAgent: 0, withLookup: 0, agentOnly: 0, lookupOnly: 0, neither: 0 },
      }),
      isLoading: false,
      isError: false,
    });
    render(<GuidanceSection />);
    expect(screen.getByTestId("guidance-empty")).toHaveTextContent(
      "No debriefs in this window yet",
    );
  });

  it("shows no share when the planner has not decided", () => {
    h.q.mockReturnValue({
      data: data({ planner: { decided: 0, chose: 0, skipped: 0, skipReasons: [] } }),
      isLoading: false,
      isError: false,
    });
    render(<GuidanceSection />);
    expect(screen.getByTestId("tile-Agent chosen")).toHaveTextContent("—");
  });

  it("asks again with the new window and mode", () => {
    render(<GuidanceSection />);
    expect(h.q).toHaveBeenLastCalledWith({ days: 30, mode: "all" });
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "Last 7 days" } });
    expect(h.q).toHaveBeenLastCalledWith({ days: 7, mode: "all" });
    fireEvent.change(screen.getByRole("combobox", { name: "Show" }), {
      target: { value: "Shadow" },
    });
    expect(h.q).toHaveBeenLastCalledWith({ days: 7, mode: "shadow" });
  });
});
