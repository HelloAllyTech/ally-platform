import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// See testingCharts.render.test.tsx: d3 captures requestAnimationFrame at
// import time, and its transitions reach into SVG geometry jsdom lacks.
vi.hoisted(() => {
  if (typeof window !== "undefined") {
    window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
  }
});

const useGetBugHunterOperationsMetricsQuery = vi.fn();
vi.mock("@api", () => ({
  useGetBugHunterOperationsMetricsQuery: (args: unknown) =>
    useGetBugHunterOperationsMetricsQuery(args),
}));
vi.mock("@components", () => ({ cellTypes: {} }));

import { BugHuntTrigger, BugHunterOperationsMetrics } from "@types";

import { BugHunterOperationsCards } from "../BugHunterOperationsCards";

const tokens = (input = 0, output = 0, runs = 0, costUsd = 0) => ({
  runs,
  inputTokens: input,
  outputTokens: output,
  costUsd,
});
const allTokens = () => ({
  [BugHuntTrigger.SCHEDULED]: tokens(),
  [BugHuntTrigger.MANUAL]: tokens(),
  [BugHuntTrigger.FIX_SESSION]: tokens(),
  [BugHuntTrigger.VERIFY_FIX]: tokens(),
  [BugHuntTrigger.VERIFY_FINDINGS]: tokens(),
  [BugHuntTrigger.PR_REVIEW]: tokens(),
});
const outcomes = (filed = 0, accepted = 0, declined = 0, undecided = 0) => ({
  filed,
  accepted,
  declined,
  undecided,
});

const fixture: BugHunterOperationsMetrics = {
  windowDays: 30,
  since: "2026-08-29T00:00:00.000Z",
  days: [
    {
      date: "2026-09-27",
      ...outcomes(6, 3, 2, 1),
      tokens: {
        ...allTokens(),
        [BugHuntTrigger.SCHEDULED]: tokens(1_000_000, 200_000, 2, 3.5),
        [BugHuntTrigger.FIX_SESSION]: tokens(300_000, 50_000, 1, 1.25),
      },
    },
  ],
  totals: {
    ...outcomes(6, 3, 2, 1),
    inputTokens: 1_300_000,
    outputTokens: 250_000,
    costUsd: 4.75,
    runs: 3,
  },
};

const filters = {
  query: { range: "30d" as const },
  language: "",
  onSelectLanguage: () => undefined,
};

/**
 * Mounts all seven cards with Carbon for real, data shaped as the server
 * returns it. The typechecker cannot see inside a Carbon options object, so a
 * chart can typecheck and still throw on render — this is the check for that.
 */
describe("BugHunterOperationsCards", () => {
  it("renders the two cards kept from server-shaped data and asks for the mapped day window", () => {
    useGetBugHunterOperationsMetricsQuery.mockReturnValue({
      data: fixture,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<BugHunterOperationsCards {...filters} />);

    expect(useGetBugHunterOperationsMetricsQuery).toHaveBeenCalledWith({ days: 30 });
    expect(screen.getByText("Bugs filed per day")).toBeInTheDocument();
    expect(screen.getByText("Spend over time")).toBeInTheDocument();
    expect(screen.getByText(/\$4\.75 over the window/)).toBeInTheDocument();
    // The cards pruned on 2026-10-12 stay gone.
    for (const title of [
      "Bugs filed per day, by source",
      "How hard they were to spot",
      "Who raises bugs",
      "Tokens spent per day, by trigger",
      "Code shown to the sweeps per day",
      "Tokens by model",
    ]) {
      expect(screen.queryByText(title)).not.toBeInTheDocument();
    }
    // The takeaway carries the acceptance share beside the count.
    expect(screen.getByText("6 filed · 60% of the 5 ruled on were accepted")).toBeInTheDocument();
  });

  it("shows the empty states rather than blank plots when nothing has run", () => {
    useGetBugHunterOperationsMetricsQuery.mockReturnValue({
      data: {
        ...fixture,
        days: [],
        totals: { ...outcomes(), inputTokens: 0, outputTokens: 0, costUsd: 0, runs: 0 },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<BugHunterOperationsCards {...filters} />);
    expect(screen.getAllByText("No bugs filed in this window yet.").length).toBeGreaterThan(0);
    expect(screen.getByText("No runs spent anything in this window.")).toBeInTheDocument();
  });
});
